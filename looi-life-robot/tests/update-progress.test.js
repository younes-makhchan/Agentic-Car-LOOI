import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceUpdateSession} from '../frontend/js/device/updateSession.js';
import {readFirmwareResponse} from '../frontend/js/device/networkClient.js';
import {defaultMotorWiring,needsMotorWiring} from '../frontend/js/device/updatePolicy.js';
globalThis.localStorage={getItem:()=>null,setItem(){}};
test('firmware check is read-only and compares installed version',async()=>{
 const calls=[],robot={isConnected:()=>true,request:async p=>{calls.push(p);return {firmware_version:'2.2.2'};}};
 const s=new DeviceUpdateSession(robot);s.downloader.release=async()=>({version:'2.3.0'});
 await s.checkUpdates();assert.equal(s.hasUpdate,true);assert.deepEqual(calls.map(p=>p.type),['device_status']);assert.equal(s.phase,'idle');
 s.downloader.release=async()=>({version:'2.1.0'});await s.checkUpdates();assert.equal(s.hasUpdate,false);assert.match(s.message,/Already up to date/);
});
test('progress reports streamed bytes and rejects interrupted/oversized data',async()=>{
 const values=[],response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(6));c.close();}}));
 assert.equal((await readFirmwareResponse(response,10,x=>values.push(x))).byteLength,10);assert.deepEqual(values,[0,0.4,1]);
 await assert.rejects(readFirmwareResponse(new Response(new Uint8Array(2)),3),/interrupted/);
 await assert.rejects(readFirmwareResponse(new Response(new Uint8Array(4)),3),/expected size/);
});
test('late transfer callback cannot overwrite restart stage',()=>{
 const s=new DeviceUpdateSession({});const update=s.transfer('Downloading');update(0.5);assert.equal(s.progress,0.5);
 s.stage('Restarting');update(0.9);assert.equal(s.progress,null);assert.equal(s.progressLabel,'Restarting');
});
test('wiring recovery never replaces configured profile',()=>{
 const info={hardware_configured:false,hardware_profile:{board:'n16r8'}};assert.equal(needsMotorWiring(info),true);assert.equal(defaultMotorWiring(info).pins.ena,17);
 assert.equal(defaultMotorWiring({...info,hardware_configured:true}),null);assert.equal(needsMotorWiring({}),false);assert.equal(defaultMotorWiring({...info,hardware_profile:{board:'unknown'}}),null);
});
