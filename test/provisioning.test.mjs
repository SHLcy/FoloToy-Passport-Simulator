import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256,supportsVirtualProvisioning,provisionXiaozhi,NVS_LENGTH} from '../public/provisioning.js';
test('unrecognized firmware cannot receive XiaoZhi settings',async()=>{
 const bytes=new Uint8Array(7616373).fill(255);
 assert.equal(await supportsVirtualProvisioning(bytes),false);
 await assert.rejects(provisionXiaozhi(bytes,new Uint8Array(NVS_LENGTH)),/尚未适配/);
 assert.ok(bytes.every(x=>x===255));
});
test('provisioning image contains only the documented virtual Wi-Fi credentials',async()=>{
 const bytes=await readFile(new URL('../public/assets/provisioning/xiaozhi-wifi.nvs',import.meta.url));
 assert.equal(bytes.length,NVS_LENGTH);
 assert.equal(await sha256(bytes),'94e4ae871cd6b2b94aae77e677cf4bc46da38f76a8e557ebf0a9bc44de6221db');
 assert.ok(bytes.includes(Buffer.from('Emulator Host Bridge\0')));
 assert.ok(bytes.subarray(4096).every(x=>x===255));
});
