import test from 'node:test';
import assert from 'node:assert/strict';
import {compareReleaseVersions,selectRelease} from '../backend/lib/device/bridge.js';
const manifest=version=>({version,chip:'ESP32-S3',partition:'app3M_fat9M_16MB',board:'n16r8',size:32,sha256:'a'.repeat(64),url:'https://github.com/xlle-er/LOOI-DF26-Firmware/releases/download/v'+version+'/looi-s3.bin'});
test('2.2.0 compared with 2.1.0',()=>assert.equal(Math.sign(compareReleaseVersions('2.2.0','2.1.0')),1));
test('2.10.0 compared with 2.9.9',()=>assert.equal(Math.sign(compareReleaseVersions('2.10.0','2.9.9')),1));
test('2.2.0 compared with 2.2.0',()=>assert.equal(Math.sign(compareReleaseVersions('2.2.0','2.2.0')),0));
test('2.3.0-beta.2 compared with 2.3.0-beta.10',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0-beta.2','2.3.0-beta.10')),-1));
test('2.3.0 compared with 2.3.0-rc.1',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0','2.3.0-rc.1')),1));
test('2.3.0-beta compared with 2.3.0-alpha',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0-beta','2.3.0-alpha')),1));
test('2.3.0+old compared with 2.3.0+new',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0+old','2.3.0+new')),0));
test('v2.2.0 compared with 2.2.0',()=>assert.equal(Math.sign(compareReleaseVersions('v2.2.0','2.2.0')),0));
test('2.3.0-beta compared with 2.2.9',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0-beta','2.2.9')),1));
test('2.3.0-1 compared with 2.3.0-alpha',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0-1','2.3.0-alpha')),-1));
test('2.3.0-beta compared with 2.3.0-beta.1',()=>assert.equal(Math.sign(compareReleaseVersions('2.3.0-beta','2.3.0-beta.1')),-1));

test('preview opt-in prefers higher stable and stable on ties',async()=>{
 for(const preview of ['2.1.0','2.2.0','2.2.0-rc.1']){
 const selected=await selectRelease('n16r8','preview',async url=>manifest(url.includes('/preview/')?preview:'2.2.0'));
 assert.equal(selected.channel,'stable');assert.equal(selected.version,'2.2.0');
 }
});
test('newer preview remains available',async()=>{
 const selected=await selectRelease('n16r8','preview',async url=>manifest(url.includes('/preview/')?'2.3.0-beta.1':'2.2.0'));
 assert.equal(selected.channel,'preview');
});
test('one unavailable feed does not block the valid candidate',async()=>{
 for(const unavailable of ['latest','preview']){
 const selected=await selectRelease('n16r8','preview',async url=>{if(url.includes('/'+unavailable+'/'))throw Error('offline');return manifest('2.2.0');});
 assert.equal(selected.channel,unavailable==='latest'?'preview':'stable');
 }
 await assert.rejects(selectRelease('n16r8','preview',async()=>{throw Error('offline');}));
});
test('stable mode never checks preview',async()=>{
 await selectRelease('n16r8','stable',async url=>{assert.ok(url.includes('/latest/'));return manifest('2.2.0');});
});
