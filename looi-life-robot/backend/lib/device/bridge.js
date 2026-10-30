import {compareReleaseVersions} from '../../../frontend/js/device/updatePolicy.js';
export {compareReleaseVersions};
import express from 'express';
import {randomUUID} from 'node:crypto';
import dgram from 'node:dgram';

export function localHost(value='') {
  const host=String(value).trim().replace(/^http:\/\//,'').replace(/\/$/,'');
  const p=host.split('.');
  if(p.length!==4||p.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255)||!(+p[0]===10||+p[0]===192&&+p[1]===168||+p[0]===172&&+p[1]>=16&&+p[1]<=31))throw Error('Enter a private LAN IPv4 address');
  return p.map(Number).join('.');
}
export const RELEASE_MANIFEST='https://github.com/xlle-er/LOOI-DF26-Firmware/releases/latest/download/looi-s3-manifest.json';
export function validRelease(m){if(m?.chip!=='ESP32-S3'||!(m?.partition==='app3M_fat9M_16MB'&&(!m.board||m.board==='n16r8')||m?.partition==='looi_8m'&&m.board==='n8r8')||!Number.isInteger(m.size)||m.size<32||m.size>3145728||!/^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(m.version)||!/^[0-9a-f]{64}$/i.test(m.sha256)||!m.url?.startsWith('https://github.com/xlle-er/LOOI-DF26-Firmware/releases/'))throw Error('Incompatible release manifest');return m;}
export function manifestForBoard(board='n16r8',channel='stable'){
 if(!['n16r8','n8r8'].includes(board))throw Error('Unsupported hardware board');
 if(!['stable','preview'].includes(channel))throw Error('Unsupported update channel');
 const url=board==='n8r8'?RELEASE_MANIFEST.replace('looi-s3-manifest','looi-s3-n8r8-manifest'):RELEASE_MANIFEST;
 return channel==='preview'?url.replace('/latest/download/','/download/preview/'):url;
}
// Opening preview updates includes both feeds; only a higher version beats stable.
export async function selectRelease(board='n16r8',channel='stable',fetchManifest=async url=>validRelease(JSON.parse((await releaseFetch(url,8192)).toString()))){
 const stableURL=manifestForBoard(board,'stable');manifestForBoard(board,channel);
 const load=async(url,channel)=>({...validRelease(await fetchManifest(url)),channel});
 if(channel==='stable')return load(stableURL,'stable');
 const [stable,preview]=await Promise.allSettled([load(stableURL,'stable'),load(manifestForBoard(board,'preview'),'preview')]);
 if(preview.status==='fulfilled'&&(stable.status==='rejected'||compareReleaseVersions(preview.value.version,stable.value.version)>0))return preview.value;
 if(stable.status==='fulfilled')return stable.value;
 throw stable.reason;
}
async function releaseFetch(url,limit,onChunk){
  for(let i=0;i<6;i++){
    const u=new URL(url);if(u.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('Untrusted release redirect');
    const r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(20000)});
    if([301,302,307,308].includes(r.status)){url=new URL(r.headers.get('location'),u).href;await r.body?.cancel();continue;}
    if(!r.ok)throw Error(`Release unavailable: HTTP ${r.status}`);
    let size=0;const chunks=[];for await(const part of r.body){size+=part.length;if(size>limit)throw Error('Release exceeds size limit');chunks.push(part);if(onChunk)await onChunk(part);}return Buffer.concat(chunks);
  }throw Error('Too many redirects');
}
export function createDeviceBridge(){
  const router=express.Router(),sessions=new Map();
  router.use((req,res,next)=>{try{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))throw Error('Device bridge is available only on localhost');
    if(req.get('X-Looi-Bridge')!=='1')throw Error('Bridge header required');
    if(req.get('Origin')&&!['localhost','127.0.0.1','[::1]'].includes(new URL(req.get('Origin')).hostname))throw Error('Local origin required');
    res.set('Cache-Control','no-store');next();
  }catch(e){res.status(403).json({message:e.message});}});
  router.use(express.json({limit:'16kb'}));
  const safe=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(res.headersSent)res.destroy(e);else{res.removeHeader('Content-Length');res.status(502).json({message:e.message});}}};
  async function device(s,path,options={}){
    const headers={Authorization:'Basic '+Buffer.from(`admin:${s.password}`).toString('base64'),'X-Looi-Client':s.client,'X-OTA-Token':s.token??'',...options.headers};
    const r=await fetch(`http://${s.host}${path}`,{...options,headers,redirect:'error',signal:AbortSignal.timeout(path==='/update'?180000:15000)});
    const result=await r.json();if(!r.ok)throw Error(result.message||`Device HTTP ${r.status}`);return result;
  }
  function session(req){const key=req.get('X-Looi-Session'),s=sessions.get(key);if(!s||Date.now()-s.used>30*60*1000){sessions.delete(key);throw Error('Device session expired; reconnect');}s.used=Date.now();return s;}
  router.post('/connect',safe(async(req,res)=>{const host=localHost(req.body.host),password=String(req.body.password??'');const s={host,password,client:randomUUID(),used:Date.now()};const info=await device(s,'/api/status');if(info.chip!=='ESP32-S3')throw Error('Unsupported device');s.token=info.csrf_token;const key=randomUUID();if(sessions.size>100)sessions.clear();sessions.set(key,s);res.json({session:key,client:s.client,info});}));
  router.get('/status',safe(async(req,res)=>{const s=session(req),info=await device(s,'/api/status');s.token=info.csrf_token;res.json(info);}));
  router.post('/command',safe(async(req,res)=>{const s=session(req);res.json(await device(s,'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.body)}));}));
  router.post('/disconnect',safe(async(req,res)=>{const s=session(req);await device(s,'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'control_release'})});sessions.delete(req.get('X-Looi-Session'));res.json({accepted:true});}));
  router.post('/upload',express.raw({type:'application/octet-stream',limit:3145728}),safe(async(req,res)=>{
    const s=session(req),bytes=req.body;if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes[0]!==0xe9)throw Error('Select an application .bin');
    const form=new FormData();form.append('firmware',new Blob([bytes]),'looi-s3.bin');
    res.json(await device(s,'/update',{method:'POST',body:form,headers:{'X-Firmware-Size':String(bytes.length),'X-Firmware-SHA256':req.get('X-Firmware-SHA256')??''}}));
  }));
  router.get('/release',safe(async(req,res)=>res.json(await selectRelease(req.query.board,req.query.channel))));
  router.get('/release/binary',safe(async(req,res)=>{const m=await selectRelease(req.query.board,req.query.channel);res.set('X-Firmware-SHA256',m.sha256).set('Content-Length',String(m.size)).type('application/octet-stream');await releaseFetch(m.url,m.size,chunk=>res.write(chunk));res.end();}));
  router.get('/discover',safe(async(_req,res)=>res.json(await discoverDevices())));
  return router;
}
export function discoverDevices(timeout=1800){return new Promise(resolve=>{
 const socket=dgram.createSocket({type:'udp4',reuseAddr:true}),addresses=new Map(),services=new Map();let finished=false;
 const done=()=>{if(finished)return;finished=true;clearTimeout(timer);try{socket.close();}catch{}resolve([...services].map(([name,target])=>({name,host:addresses.get(target)})).filter(d=>d.host));};const timer=setTimeout(done,timeout);
 const readName=(b,offset,seen=new Set())=>{let parts=[],next=offset;for(let i=0;i<64;i++){if(offset>=b.length||seen.has(offset))throw Error('Invalid mDNS');seen.add(offset);const n=b[offset++];if(!n){next=Math.max(next,offset);break;}if((n&192)===192){if(offset>=b.length)throw Error('Invalid pointer');const ptr=((n&63)<<8)|b[offset++];parts.push(readName(b,ptr,seen).name);next=Math.max(next,offset);break;}if(n>63||offset+n>b.length)throw Error('Invalid name');parts.push(b.subarray(offset,offset+n).toString());offset+=n;next=offset;}return{name:parts.join('.'),next};};
 socket.on('error',done);socket.on('message',b=>{try{if(b.length<12)return;let p=12;for(let i=0;i<b.readUInt16BE(4);i++)p=readName(b,p).next+4;const count=b.readUInt16BE(6)+b.readUInt16BE(8)+b.readUInt16BE(10);for(let i=0;i<count;i++){const n=readName(b,p);p=n.next;const type=b.readUInt16BE(p),len=b.readUInt16BE(p+8),start=p+10;p=start+len;if(p>b.length)break;if(type===1&&len===4){const ip=[...b.subarray(start,p)].join('.');try{addresses.set(n.name,localHost(ip));}catch{}}else if(type===33&&len>=7&&n.name.endsWith('._looi._tcp.local'))services.set(n.name.replace('._looi._tcp.local',''),readName(b,start+6).name);}}catch{}});
 socket.bind(0,()=>{const labels='_looi._tcp.local'.split('.'),name=Buffer.concat([...labels.map(s=>Buffer.concat([Buffer.from([s.length]),Buffer.from(s)])),Buffer.from([0])]);const header=Buffer.alloc(12);header.writeUInt16BE(1,4);const tail=Buffer.from([0,12,128,1]);socket.send(Buffer.concat([header,name,tail]),5353,'224.0.0.251');});
 });}
