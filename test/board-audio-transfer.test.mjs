import assert from "node:assert/strict";
import test from "node:test";

import { AiPassportBoard } from "../public/wasm/ai-passport-board.js";

test("audio drained from WebAssembly memory can be transferred by the worker", () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const wasmBytes = new Uint8Array(memory.buffer, 32, 4);
  wasmBytes.set([1, 2, 3, 4]);
  const board = Object.create(AiPassportBoard.prototype);
  board.bridge = { drain: () => [{ type: "audio", bytes: wasmBytes }] };
  board.audio = { handleRegisterWrite() {} };
  board.gpio = { write() {} };
  board.onUnknownEvent = () => {};
  board.onAudio = (packet) => {
    assert.notEqual(packet.bytes.buffer, memory.buffer);
    const transferred = structuredClone(packet.bytes, {
      transfer: [packet.bytes.buffer],
    });
    assert.deepEqual([...transferred], [1, 2, 3, 4]);
  };

  board.drain({ flushFrame: false });
  assert.equal(memory.buffer.byteLength, 64 * 1024);
  assert.deepEqual([...wasmBytes], [1, 2, 3, 4]);
});
