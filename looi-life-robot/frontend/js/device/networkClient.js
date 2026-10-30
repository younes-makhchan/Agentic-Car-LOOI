// Stream to the browser while the bridge is still downloading from GitHub.
export async function readFirmwareResponse(response,expected,onProgress=()=>{}){
 const reader=response.body?.getReader();if(!reader){const bytes=await response.arrayBuffer();if(bytes.byteLength!==expected)throw Error('Firmware size mismatch');onProgress(1);return bytes;}
 const chunks=[];let received=0;onProgress(0);
 try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>expected||received>3145728)throw Error('Firmware exceeds expected size');chunks.push(value);onProgress(received/expected);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}
 if(received!==expected)throw Error('Firmware download interrupted');
 const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes.buffer;
}
import {sha256} from './sha256.js';
import {verifyFirmware,savePreparedFirmware,loadPreparedFirmware,preparedAllowed} from './firmwareCache.js';
export class DeviceNetworkClient {
  constructor({onLost=()=>{}}={}){this.session='';this.client='';this.info={};this.onLost=onLost;this.poll=null;this.busy=false;this.epoch=0;this.controlToken=0;this.motionEpoch=0;}
  async bridge(path,{body,bytes,headers={},onProgress}={}){
    if(bytes&&onProgress&&globalThis.XMLHttpRequest)return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();xhr.open('POST','/api/device'+path);xhr.timeout=180000;
      for(const [key,value] of Object.entries({'X-Looi-Bridge':'1','X-Looi-Session':this.session,...headers}))xhr.setRequestHeader(key,value);
      xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
      xhr.onerror=()=>reject(Error('Firmware upload connection failed'));xhr.ontimeout=()=>reject(Error('Firmware upload timed out'));
      xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw Error(result.message||'Upload failed');resolve(result);}catch(e){reject(e);}};xhr.send(bytes);
    });
    const response=await fetch('/api/device'+path,{cache:'no-store',method:body||bytes?'POST':'GET',headers:{'X-Looi-Bridge':'1','X-Looi-Session':this.session,...(body?{'Content-Type':'application/json'}:{}),...headers},body:bytes??(body?JSON.stringify(body):undefined)});
    const result=await response.json();if(!response.ok)throw Error(result.message||'Device bridge unavailable');return result;
  }
  async connect(host,password){const r=await this.bridge('/connect',{body:{host,password}});this.session=r.session;this.client=r.client;this.info=r.info;if(r.info.hardware_profile?.board)localStorage.setItem('looi.board',r.info.hardware_profile.board);this.startPolling();return r.info;}
  startPolling(){clearInterval(this.poll);this.poll=setInterval(async()=>{if(this.busy)return;this.busy=true;const epoch=this.epoch;try{if(this.info.control_owner==='http:'+this.client&&this.controlToken){const renewing=this.controlToken;try{await this.command({type:'control_renew'});}catch{if(this.controlToken===renewing)this.controlToken=0;}}this.info=await this.bridge('/status');}catch(e){if(epoch===this.epoch){this.close();this.onLost(e);}}finally{this.busy=false;}},250);}
  async rawCommand(payload){const result=await this.bridge('/command',{body:payload});if(result.type==='error'||result.accepted===false)throw Error(result.message||'Device rejected command');return result;}
  async command(payload){
    const type=payload.type;
    if(type==='stop'){this.motionEpoch++;this.controlToken=0;return this.rawCommand(payload);}
    const epoch=this.motionEpoch;
    if(type==='motion'&&!this.controlToken){const claim=await this.rawCommand({type:'control_acquire'});if(epoch!==this.motionEpoch)throw Error('Command cancelled');this.controlToken=claim.control_token;}
    const result=await this.rawCommand({...payload,control_token:this.controlToken});
    if(epoch!==this.motionEpoch)throw Error('Command cancelled');
    if(type==='control_acquire')this.controlToken=result.control_token;
    if(['calibration_set','wifi_configure','wifi_forget','ota_start','control_release','firmware_check','firmware_install','hardware_set'].includes(type))this.controlToken=0;
    return result;
  }
  async disconnect(){try{if(this.session)await this.bridge('/disconnect',{body:{}});}finally{this.close();}}
  close(){this.epoch++;this.motionEpoch++;this.controlToken=0;clearInterval(this.poll);this.session='';}
  async upload(file,expected,closeHotspot=true,onProgress){if(!file.name.endsWith('.bin')||file.size<32||file.size>3145728)throw Error('Select an application .bin (maximum 3 MB)');const bytes=await file.arrayBuffer(),digest=sha256(bytes);if(this.info.hardware_protocol===1){const p=this.info.hardware_profile?.board,partition=this.info.partition,marker=new TextEncoder().encode(`LOOI_HW_V1|${p}|1|${partition}|END`),data=new Uint8Array(bytes);let found=false;outer:for(let i=0;i<=data.length-marker.length;i++){for(let j=0;j<marker.length;j++)if(data[i+j]!==marker[j])continue outer;found=true;break;}if(!found)throw Error('Incompatible hardware firmware / 固件与接线配置协议或板型不兼容');}if(expected&&digest!==expected.toLowerCase())throw Error('Firmware checksum mismatch');await this.command({type:'ota_start',close_ap_after_update:closeHotspot});clearInterval(this.poll);try{const r=await this.bridge('/upload',{bytes,onProgress,headers:{'Content-Type':'application/octet-stream','X-Firmware-SHA256':digest}});this.close();return r;}catch(e){this.startPolling();throw e;}}
  async release(includePreview=false){const board=this.info.hardware_profile?.board||localStorage.getItem('looi.board')||'n16r8';return this.bridge('/release?board='+encodeURIComponent(board)+'&channel='+(includePreview?'preview':'stable'));}
  async prepare(release,onProgress){const response=await fetch('/api/device/release/binary?board='+encodeURIComponent(release.board||'n16r8')+'&channel='+encodeURIComponent(release.channel||'stable'),{headers:{'X-Looi-Bridge':'1'}});if(!response.ok)throw Error((await response.json()).message||'Download failed');const bytes=await readFirmwareResponse(response,release.size,onProgress);verifyFirmware(bytes,release);await savePreparedFirmware(release,bytes);return release;}
  async installPrepared(closeHotspot=true,includePreview=false,onProgress){const cached=await loadPreparedFirmware();if(!cached)throw Error('Download firmware before joining the ESP hotspot');if(!preparedAllowed(cached.release,includePreview))throw Error('Enable preview updates to install this saved preview / 请先开启预览版更新');verifyFirmware(cached.bytes,cached.release);return this.upload(new File([cached.bytes],'looi-s3.bin'),cached.release.sha256,closeHotspot,onProgress);}

}
