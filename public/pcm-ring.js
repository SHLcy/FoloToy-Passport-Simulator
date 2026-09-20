// Audio-thread PCM queue. Preserve fractional resampling position across packets;
// packet boundaries and main-thread painting must not interrupt the audio clock.
export class PcmRing {
  constructor(outputRate, capacity = 262144) {
    this.outputRate = outputRate;
    this.capacity = capacity;
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
    this.reset();
  }
  reset() {
    this.read = 0; this.write = 0; this.phase = 0;
    this.inputRate = 0; this.buffering = true;
    this.targetMs = 80; this.underruns = 0; this.overruns = 0;
    this.fade = 0; this.lastLeft = 0; this.lastRight = 0;
    this.inputFrames = 0; this.outputFrames = 0;
  }
  push(packet) {
    if (packet.bits !== 16 || ![1,2].includes(packet.channels) ||
        !Number.isFinite(packet.sampleRate) || packet.sampleRate < 1000 || packet.sampleRate > 384000) return;
    if (this.inputRate && this.inputRate !== packet.sampleRate) this.reset();
    this.inputRate = packet.sampleRate;
    const bytes = packet.bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = Math.floor(bytes.byteLength / (packet.channels * 2));
    const gain = Math.max(0, Math.min(1, (packet.volume ?? 100) / 100)) / 32768;
    // Bound latency after suspension. Ordinary bursts stay contiguous.
    if (this.write - this.read + frames >= this.capacity) {
      this.read = this.write; this.phase = 0; this.buffering = true;
      this.overruns++;
    }
    const start = Math.max(0, frames - this.capacity + 1);
    for (let i = start; i < frames; i++) {
      const index = this.write++ % this.capacity;
      const offset = i * packet.channels * 2;
      this.left[index] = view.getInt16(offset, true) * gain;
      this.right[index] = packet.channels === 1 ? this.left[index] : view.getInt16(offset + 2, true) * gain;
    }
    this.inputFrames += frames;
  }
  render(left, right) {
    left.fill(0); right.fill(0);
    if (!this.inputRate) return;
    const queued = this.write - this.read;
    if (this.buffering) {
      if (queued < this.inputRate * this.targetMs / 1000) return;
      this.buffering = false;
      this.fade = 32;
    }
    const step = this.inputRate / this.outputRate;
    for (let i = 0; i < left.length; i++) {
      const offset = Math.floor(this.phase);
      if (this.read + offset + 1 >= this.write) {
        // Fade the last sample instead of creating a sharp click at a gap.
        for (let j = i; j < Math.min(i + 32, left.length); j++) {
          const gain = 1 - (j - i + 1) / 32;
          left[j] = this.lastLeft * gain; right[j] = this.lastRight * gain;
        }
        this.buffering = true; this.underruns++;
        this.targetMs = Math.min(180, this.targetMs + 20);
        break;
      }
      const a = (this.read + offset) % this.capacity, b = (a + 1) % this.capacity;
      const fraction = this.phase - offset;
      const gain = this.fade > 0 ? (32 - --this.fade) / 32 : 1;
      left[i] = (this.left[a] + (this.left[b] - this.left[a]) * fraction) * gain;
      right[i] = (this.right[a] + (this.right[b] - this.right[a]) * fraction) * gain;
      this.lastLeft = left[i]; this.lastRight = right[i];
      this.phase += step;
      this.outputFrames++;
    }
    const consumed = Math.floor(this.phase);
    this.read += consumed; this.phase -= consumed;
  }
  status() {
    return { bufferedMs: this.inputRate ? (this.write - this.read) * 1000 / this.inputRate : 0,
      buffering: this.buffering, underruns: this.underruns, overruns: this.overruns,
      inputRate: this.inputRate, inputFrames: this.inputFrames, outputFrames: this.outputFrames };
  }
}
