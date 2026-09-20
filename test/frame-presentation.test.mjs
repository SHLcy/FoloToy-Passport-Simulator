import test from 'node:test';
import assert from 'node:assert/strict';
import { QemuRuntime } from '../public/runtime.js';
test('frames are presented at animation frames and stale workers cannot draw after reload', async () => {
  const originals = { Worker: globalThis.Worker, fetch: globalThis.fetch, requestAnimationFrame: globalThis.requestAnimationFrame };
  const scheduled = [], workers = [];
  class Worker extends EventTarget {
    sent = [];
    constructor() { super(); workers.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() {}
    frame() { const event = new Event('message'); event.data = { type: 'frame', pixels: new Uint8ClampedArray(4), width: 1, height: 1 }; this.dispatchEvent(event); }
  }
  globalThis.Worker = Worker;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ worker: '/test-worker' }) });
  globalThis.requestAnimationFrame = fn => scheduled.push(fn);
  try {
    const runtime = new QemuRuntime(), presented = [];
    runtime.addEventListener('frame', e => presented.push(e.detail));
    await runtime.loadFirmware(new ArrayBuffer(4));
    workers[0].frame();
    assert.equal(presented.length,0);
    scheduled.shift()();
    assert.equal(presented.length,1);
    assert.equal(workers[0].sent.at(-1).type,'frame-presented');
    workers[0].frame();
    await runtime.loadFirmware(new ArrayBuffer(4));
    scheduled.shift()();
    assert.equal(presented.length,1);
    assert.notEqual(workers[1].sent.at(-1).type,'frame-presented');
  } finally { Object.assign(globalThis, originals); }
});
