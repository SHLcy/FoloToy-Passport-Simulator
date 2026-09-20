import test from 'node:test';
import assert from 'node:assert/strict';
import { ST7789 } from '../public/wasm/st7789.js';

const command = (display, bytes) => display.processTransaction({ dc: 0, bytes });
const data = (display, bytes) => display.processTransaction({ dc: 1, bytes });
test('all RGB565 colors retain exact channels with both byte orders and BGR/inversion', () => {
  for (const byteOrder of ['big', 'little']) for (const bgr of [false, true]) for (const inverted of [false, true]) {
    const display = new ST7789({ width: 256, height: 256, byteOrder });
    command(display, [0x36]); data(display, [bgr ? 8 : 0]);
    if (inverted) command(display, [0x21]);
    command(display, [0x2c]);
    const bytes = new Uint8Array(65536 * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 65536; i++) view.setUint16(i * 2, i, byteOrder === 'little');
    // Split in the middle of pixels and rows, as real SPI/DMA transfers do.
    for (let i = 0; i < bytes.length; i += 333) data(display, bytes.subarray(i, i + 333));
    for (let i = 0; i < 65536; i++) {
      let r = Math.round((i >>> 11) * 255 / 31), g = Math.round(((i >>> 5) & 63) * 255 / 63), b = Math.round((i & 31) * 255 / 31);
      if (bgr) [r, b] = [b, r];
      if (inverted) [r, g, b] = [255 - r, 255 - g, 255 - b];
      assert.deepEqual([...display.framebuffer.subarray(i * 4, i * 4 + 4)], [r,g,b,255]);
    }
  }
});
test('rotation/mirroring and repeated writes preserve pixels without redundant refreshes', () => {
  for (const madctl of [0,32,64,96,128,160,192,224]) {
    const display = new ST7789({ width: 4, height: 4 });
    command(display, [0x36]); data(display, [madctl]); command(display, [0x2c]);
    const bytes = Uint8Array.of(0xf8,0,0x07,0xe0,0,0x1f);
    data(display, bytes);
    for (let x = 0; x < 3; x++) {
      let px = x, py = 0;
      if (madctl & 64) px = 3 - px;
      if (madctl & 128) py = 3 - py;
      if (madctl & 32) [px,py] = [py,px];
      const rgba = [0,0,0,255]; rgba[x] = 255;
      assert.deepEqual([...display.framebuffer.subarray((py*4+px)*4,(py*4+px)*4+4)], rgba);
    }
    assert.ok(display.consumeDirtyRegion());
    command(display, [0x2c]); data(display, bytes);
    assert.equal(display.consumeDirtyRegion(), null);
  }
});
