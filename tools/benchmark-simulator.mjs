// Run before/after with the same firmware and machine. No browser or device needed.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initSync, WasmEmulator } from '../public/wasm/pkg/esp_emu.js';
import { AiPassportBoard } from '../public/wasm/ai-passport-board.js';
import { ST7789 } from '../public/wasm/st7789.js';

const firmware = await readFile(process.argv[2] || new URL('../public/assets/firmware/folotoy-demo.bin', import.meta.url));
const wasm = initSync({ module: await readFile(new URL('../public/wasm/pkg/esp_emu_bg.wasm', import.meta.url)) });
const emulator = new WasmEmulator('esp32c3');
emulator.load_default_rom();
emulator.set_boot_from_rom(true);
emulator.set_wifi_config('Emulator Host Bridge', '');
emulator.load_firmware(firmware);
let frames = 0, audioBytes = 0, coreMs = 0, boardMs = 0, audioMs = 0;
const board = new AiPassportBoard(wasm, { emulator, onFrame() { frames++; }, onAudio(p) { audioBytes += p.bytes.length; } });
board.releaseButtons();
const start = performance.now();
while (emulator.cycles() < 800_000_000) {
  const a = performance.now();
  emulator.run_batch(50_000);
  const b = performance.now();
  board.drain();
  const c = performance.now();
  // A deterministic DMA clock makes the framebuffer/hash comparable across runs.
  board.pumpAudio(emulator.cycles() / 160_000);
  const d = performance.now();
  coreMs += b - a; boardMs += c - b; audioMs += d - c;
}
const emulationMs = performance.now() - start;
const screenHash = createHash('sha256').update(board.display.framebuffer).digest('hex');
const display = new ST7789();
display.processTransaction({ dc: 0, bytes: [0x2c] });
const pixels = new Uint8Array(240 * 320 * 2);
for (let i = 0; i < pixels.length; i++) pixels[i] = i * 17;
const drawStart = performance.now();
for (let i = 0; i < 300; i++) {
  display.processTransaction({ dc: 1, bytes: pixels });
  display.consumeDirtyRegion();
}
console.log(JSON.stringify({ firmwareSha: createHash('sha256').update(firmware).digest('hex'), emulationMs, coreMs, boardMs, audioMs, frames, audioBytes, screenHash, dropped: board.droppedEvents(), display300FramesMs: performance.now() - drawStart }, null, 2));
