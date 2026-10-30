import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {sha256} from '../frontend/js/device/sha256.js';
import {localHost,validRelease,createDeviceBridge} from '../backend/lib/device/bridge.js';
import {DeviceNetworkClient} from '../frontend/js/device/networkClient.js';
import {DEVICE_COMMANDS} from '../frontend/js/device/commands.js';
import {IDLE_SCENARIOS,sanitizeIdleScenarios} from '../frontend/js/idle/idleScenarioCatalog.js';
import express from '../backend/node_modules/express/index.js';

test('SHA-256 works in HTTP panels without SubtleCrypto',()=>{for(const bytes of [Buffer.alloc(0),Buffer.from('abc'),randomBytes(1204896)])assert.equal(sha256(bytes),createHash('sha256').update(bytes).digest('hex'));});
test('device destinations accept RFC1918 only',()=>{for(const h of ['10.0.0.1','192.168.4.1','172.16.0.2','172.31.255.1'])assert.equal(localHost(h),h);for(const h of ['127.0.0.1','169.254.169.254','8.8.8.8','172.32.1.1','10.0.0.1:99','user@10.0.0.1','10.0.0.1/path','10.0.0.1?x','0x7f000001'])assert.throws(()=>localHost(h));});
test('release validation rejects legacy chip, wrong partition and untrusted URLs',()=>{const m={version:'2.0.0',chip:'ESP32-S3',partition:'app3M_fat9M_16MB',size:100,sha256:'a'.repeat(64),url:'https://github.com/xlle-er/LOOI-DF26-Firmware/releases/download/v2.0.0/looi-s3.bin'};assert.equal(validRelease(m),m);for(const bad of [{chip:'ESP32'},{partition:'no_ota'},{size:4000000},{url:'http://example.com/f.bin'},{sha256:'bad'}])assert.throws(()=>validRelease({...m,...bad}));});
test('removed actuator is absent from command catalog and idle scenes',()=>{assert(!DEVICE_COMMANDS.includes('head_pitch'));for(const s of IDLE_SCENARIOS)assert(s.steps.every(x=>['move','stop','pause'].includes(x.kind)));const migrated=sanitizeIdleScenarios([{id:'old',steps:[{kind:'head_pitch'}]},{id:'mixed',steps:[{kind:'head_pitch'},{kind:'move',left:0.2,right:0.2}]}]);assert.deepEqual(migrated.map(s=>s.id),['mixed']);assert.equal(migrated[0].steps.length,1);});
test('Wi-Fi commands attach control tokens, stop invalidates old acquisition',async()=>{
 const client=new DeviceNetworkClient();client.client='one';let generation=0;let delayed;const sent=[];
 client.bridge=async(_path,{body})=>{sent.push(body);if(body.type==='control_acquire')return {type:'ack',control_token:++generation};return {type:'ack',accepted:true};};
 await client.command({type:'motion'});assert.equal(sent[1].control_token,1);await client.command({type:'stop'});await client.command({type:'motion'});assert.equal(sent.at(-1).control_token,2);
 await client.command({type:'stop'});client.bridge=async(_p,{body})=>body.type==='control_acquire'?new Promise(r=>{delayed=r;}):({accepted:true});const pending=client.command({type:'motion'});await Promise.resolve();await client.command({type:'stop'});delayed({control_token:3});await assert.rejects(pending,/cancelled/);
});
test('bridge refuses cross-site requests and requires custom header',async()=>{
 const app=express();app.use('/api/device',createDeviceBridge());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/device/status`;
 try{assert.equal((await fetch(url)).status,403);assert.equal((await fetch(url,{headers:{'X-Looi-Bridge':'1',Origin:'https://untrusted.example'}})).status,403);assert.equal((await fetch(url,{headers:{'X-Looi-Bridge':'1'}})).status,502);}finally{server.close();}
});

test('saved custom scenes preserve facial steps and remove empty scenes',async()=>{const {cleanStoredScenes,migrateStoredScenes}=await import('../frontend/js/device/scenarioMigration.js');const data=[{id:'old',steps:[{kind:'obsolete'}]},{id:'mixed',steps:[{kind:'obsolete'},{kind:'expression',expression:'happy'},{kind:'move'}]}];assert.deepEqual(cleanStoredScenes(data).map(x=>x.id),['mixed']);const map=new Map([['looi.customScenarios.v1',JSON.stringify(data)],['looi.providers.v1','unchanged']]);const storage={get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};migrateStoredScenes(storage);assert.equal(JSON.parse(map.get('looi.customScenarios.v1'))[0].steps.length,2);assert.equal(map.get('looi.providers.v1'),'unchanged');});

test('offline package validation rejects corruption and incompatible metadata',async()=>{
 const {verifyFirmware}=await import('../frontend/js/device/firmwareCache.js');const bytes=new Uint8Array(64);bytes[0]=0xe9;
 const m={chip:'ESP32-S3',partition:'app3M_fat9M_16MB',size:64,sha256:'27585a5e85e1a2afcb9718bcfd03a0fd8822b4cfdfd06862e3a2c0cfd1c092eb'};
 assert.doesNotThrow(()=>verifyFirmware(bytes.buffer,m));
 const corrupt=bytes.slice();corrupt[3]=1;assert.throws(()=>verifyFirmware(corrupt.buffer,m),/checksum/);
 assert.throws(()=>verifyFirmware(bytes.buffer,{...m,size:65}),/size/);
 assert.throws(()=>verifyFirmware(bytes.buffer,{...m,chip:'ESP32'}),/Incompatible/);
});

test('8MB OTA uses its own feed and cannot be mislabeled as 16MB',async()=>{
 const {manifestForBoard}=await import('../backend/lib/device/bridge.js');
 assert.match(manifestForBoard('n8r8'),/looi-s3-n8r8-manifest.json$/);assert.match(manifestForBoard('n16r8'),/looi-s3-manifest.json$/);assert.throws(()=>manifestForBoard('unknown'));
 const bytes=new Uint8Array(64);bytes[0]=0xe9;
 const m={version:'2.1.0',board:'n8r8',chip:'ESP32-S3',partition:'looi_8m',size:64,sha256:sha256(bytes),url:'https://github.com/xlle-er/LOOI-DF26-Firmware/releases/download/v2.1.0/looi-s3-n8r8.bin'};
 assert.equal(validRelease(m),m);assert.throws(()=>validRelease({...m,board:'n16r8'}));
 const {verifyFirmware}=await import('../frontend/js/device/firmwareCache.js');assert.doesNotThrow(()=>verifyFirmware(bytes.buffer,m));assert.throws(()=>verifyFirmware(bytes.buffer,{...m,board:'n16r8'}));
});
test('new hardware refuses old local images before entering OTA',async()=>{
 const client=new DeviceNetworkClient();client.info={hardware_protocol:1,hardware_profile:{board:'n8r8'},partition:'looi_8m'};let called=false;client.command=async()=>{called=true;};
 await assert.rejects(client.upload(new File([new Uint8Array(64)],'old.bin')),/Incompatible hardware/);assert.equal(called,false);
});

test('preview update channel is explicit and default feed stays stable',async()=>{
 const {manifestForBoard}=await import('../backend/lib/device/bridge.js');
 assert.match(manifestForBoard('n16r8'),/releases\/latest\/download\/looi-s3-manifest.json$/);
 assert.match(manifestForBoard('n16r8','preview'),/releases\/download\/preview\/looi-s3-manifest.json$/);
 assert.match(manifestForBoard('n8r8','preview'),/looi-s3-n8r8-manifest.json$/);
 assert.throws(()=>manifestForBoard('n16r8','unknown'));
 const {preparedAllowed}=await import('../frontend/js/device/firmwareCache.js');
 assert(preparedAllowed({}));assert(!preparedAllowed({channel:'preview'}));assert(preparedAllowed({channel:'preview'},true));assert(!preparedAllowed({channel:'unknown'},true));
 const oldStorage=globalThis.localStorage;globalThis.localStorage={getItem:()=>null};
 try {const n=new DeviceNetworkClient();let last='';n.bridge=async path=>{last=path;return {};};await n.release();assert.match(last,/channel=stable$/);await n.release(true);assert.match(last,/channel=preview$/);}finally{globalThis.localStorage=oldStorage;}
});
