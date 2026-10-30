export function preparedAllowed(release,includePreview=false){const channel=release?.channel??'stable';return channel==='stable'||channel==='preview'&&includePreview;}
import {sha256} from './sha256.js';
export function verifyFirmware(bytes,release){
 if(!['stable','preview'].includes(release?.channel??'stable'))throw Error('Unknown firmware update channel');
 if(release?.chip!=='ESP32-S3'||!(release?.partition==='app3M_fat9M_16MB'&&(!release.board||release.board==='n16r8')||release?.partition==='looi_8m'&&release.board==='n8r8')||!Number.isInteger(release.size)||release.size<32||release.size>3145728||!/^[0-9a-f]{64}$/i.test(release.sha256??''))throw Error('Incompatible release manifest');
 if(bytes.byteLength!==release.size||new Uint8Array(bytes)[0]!==0xe9)throw Error('Firmware size or image is invalid');
 if(sha256(bytes)!==release.sha256.toLowerCase())throw Error('Firmware checksum mismatch');
}
async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('looi-firmware',1);r.onupgradeneeded=()=>r.result.createObjectStore('packages');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function savePreparedFirmware(release,bytes){
 verifyFirmware(bytes,release);const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('packages','readwrite');tx.objectStore('packages').put({release,bytes},'ready');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error??Error('Firmware cache unavailable'));});}finally{db.close();}
}
export async function loadPreparedFirmware(){
 const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('packages','readonly');const r=tx.objectStore('packages').get('ready');r.onsuccess=()=>{try{if(r.result)verifyFirmware(r.result.bytes,r.result.release);resolve(r.result??null);}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}finally{db.close();}
}
