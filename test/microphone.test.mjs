import test from 'node:test';
import assert from 'node:assert/strict';
import {MicrophoneResampler, MicrophoneQueue} from '../public/wasm/microphone.js';
import {Esp32C3I2S} from '../public/wasm/i2s.js';

test('48 kHz microphone retains every fractional frame across worklet packets',()=>{
  const resampler=new MicrophoneResampler();
  let bytes=0;
  for(let i=0;i<375;i++) bytes+=resampler.convert(new Float32Array(128).fill(.5),48000,16000,1).length;
  assert.equal(bytes,32000);
});
for(const targetRate of [16000,44100,96000]) test(`fragmented microphone equals continuous input at ${targetRate} Hz`,()=>{
  const samples=Float32Array.from({length:2048},(_,i)=>Math.sin(i/31));
  const expected=new MicrophoneResampler().convert(samples,48000,targetRate,2);
  const resampler=new MicrophoneResampler(), packets=[];
  for(let i=0;i<samples.length;i+=128) packets.push(...resampler.convert(samples.subarray(i,i+128),48000,targetRate,2));
  assert.deepEqual(Uint8Array.from(packets),expected);
});
test('bounded queue retains newest samples in order across wrapping and overflow',()=>{
  const queue=new MicrophoneQueue(4);
  queue.push(Uint8Array.of(1,2,3)); assert.equal(queue.shift(),1);
  queue.push(Uint8Array.of(4,5,6));
  assert.deepEqual(Array.from({length:4},()=>queue.shift()),[3,4,5,6]);
  queue.push(Uint8Array.of(1,2,3,4,5,6));
  assert.deepEqual(Array.from({length:5},()=>queue.shift()),[3,4,5,6,0]);
});
test('microphone uses RX format and supplies nonzero PCM to firmware DMA',()=>{
  const audio=new Esp32C3I2S({}, {__wbg_ptr:0},0);
  audio._i2sRegister=()=>4;
  audio._format=direction=>{assert.equal(direction,'rx');return {sampleRate:16000,bits:16,channels:1};};
  audio.pushMicrophone(new Float32Array(480).fill(.5),48000);
  assert.equal(audio.microphone.length,320);
  audio._channelBase=()=>0;
  audio._memory=()=>({getUint32:()=>3});
  audio._currentDescriptor=()=>100;
  audio._readDescriptor=()=>({fields:{owner:true,size:320},buffer:200,next:500,word:0x80000140});
  const output=[];
  audio._writeGuest8=(address,value)=>output.push(value);
  audio._writeGuest32=()=>{};
  let completed=false; audio._completeDma=()=>{completed=true;};
  assert.equal(audio._pumpRx(0),320);
  assert.equal(new DataView(Uint8Array.from(output).buffer).getInt16(0,true),16384);
  assert.equal(audio.micStats.deliveredBytes,320);
  assert.equal(audio.nextRx[0],500); assert.ok(completed);
});
test('inactive firmware recording never accumulates microphone backlog',()=>{
 const audio=new Esp32C3I2S({}, {__wbg_ptr:0},0); audio._i2sRegister=()=>0;
 audio.pushMicrophone(new Float32Array(480),48000);
 assert.equal(audio.microphone.length,0); assert.equal(audio.micStats.capturedFrames,480);
});
