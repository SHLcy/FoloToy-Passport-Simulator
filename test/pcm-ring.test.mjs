import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmRing } from '../public/pcm-ring.js';
const packet = (count, sampleRate = 48000, channels = 1, volume = 100) => {
  const samples = new Int16Array(count * channels);
  for (let i = 0; i < count; i++) { samples[i * channels] = 16384; if (channels === 2) samples[i * 2 + 1] = -8192; }
  return { bits: 16, channels, sampleRate, volume, bytes: new Uint8Array(samples.buffer) };
};
test('PCM queue absorbs bursty packet arrival without breaking the audio timeline', () => {
  const ring = new PcmRing(48000), left = new Float32Array(128), right = new Float32Array(128);
  ring.push(packet(4800));
  for (let block = 0; block < 750; block++) { // two seconds, packets arrive every 40 ms
    if (block % 15 === 0) ring.push(packet(1920));
    ring.render(left,right);
    if (block) assert.ok(left.every(v => v === .5));
    assert.deepEqual(left,right);
  }
  assert.equal(ring.underruns,0);
  assert.equal(ring.outputFrames,96000);
});
test('stereo resampling preserves volume and sample position across packet boundaries', () => {
  const ring = new PcmRing(48000), l = new Float32Array(128), r = new Float32Array(128);
  for (let i=0;i<10;i++) ring.push(packet(441,44100,2,50));
  for (let i=0;i<30;i++) ring.render(l,r);
  assert.ok(l.every(v => Math.abs(v-.25)<1e-6));
  assert.ok(r.every(v => Math.abs(v+.125)<1e-6));
  assert.ok(Math.abs(ring.read - 3528)<2);
});
test('starvation re-buffers once; reset and format changes discard stale audio', () => {
  const ring = new PcmRing(48000), l = new Float32Array(128), r = new Float32Array(128);
  ring.push(packet(4800));
  for (let i=0;i<100;i++) ring.render(l,r);
  assert.equal(ring.underruns,1); assert.ok(ring.buffering);
  assert.ok(l.every(v=>v===0));
  ring.push(packet(6000)); ring.render(l,r); assert.equal(ring.buffering,false);
  ring.reset(); ring.render(l,r); assert.ok(l.every(v=>v===0));
  ring.push(packet(3000,16000)); ring.push(packet(4410,44100));
  assert.equal(ring.inputFrames,4410); assert.equal(ring.inputRate,44100);
});
test('overload is bounded and cannot overwrite unread ring data', () => {
  const ring = new PcmRing(48000,8192);
  ring.push(packet(6000)); ring.push(packet(12000));
  assert.equal(ring.overruns,1); assert.ok(ring.write-ring.read<8192);
});
test('producer bursts cannot accumulate seconds of playback latency', () => {
  const ring = new PcmRing(48000), l = new Float32Array(128), r = new Float32Array(128);
  ring.push(packet(48000 * 3));
  assert.ok(ring.status().bufferedMs <= 160);
  ring.render(l, r);
  assert.equal(ring.buffering, false);
  assert.ok(l.some(value => value !== 0));
});
