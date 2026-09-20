// Keep the fractional source position across worklet packets (48 kHz -> 16 kHz
// is not an integer number of samples per 128-frame browser render quantum).
export class MicrophoneResampler {
  constructor() { this.reset(); }
  reset() { this.position = 0; this.previous = 0; this.hasPrevious = false; }
  convert(samples, sourceRate, targetRate, channels) {
    if (!samples.length) return new Uint8Array();
    const step = sourceRate / targetRate;
    const output = [];
    let position = this.position;
    while (position <= samples.length - 1) {
      const left = Math.floor(position), fraction = position - left;
      if (left < 0 && !this.hasPrevious) { position += step; continue; }
      const a = left < 0 ? this.previous : samples[left];
      const b = fraction === 0 ? a : samples[left + 1];
      const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
      output.push(sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767));
      position += step;
    }
    this.position = position - samples.length;
    this.previous = samples.at(-1); this.hasPrevious = true;
    const bytes = new Uint8Array(output.length * channels * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < output.length; i++) for (let c = 0; c < channels; c++) view.setInt16((i * channels + c) * 2, output[i], true);
    return bytes;
  }
}

export class MicrophoneQueue {
  constructor(capacity = 16000) { this.bytes = new Uint8Array(capacity); this.head = 0; this.length = 0; }
  push(bytes) {
    if (bytes.length >= this.bytes.length) {
      this.bytes.set(bytes.subarray(bytes.length - this.bytes.length));
      this.head = 0; this.length = this.bytes.length; return;
    }
    const drop = Math.max(0, this.length + bytes.length - this.bytes.length);
    this.head = (this.head + drop) % this.bytes.length; this.length -= drop;
    const tail = (this.head + this.length) % this.bytes.length;
    const first = Math.min(bytes.length, this.bytes.length - tail);
    this.bytes.set(bytes.subarray(0, first), tail);
    this.bytes.set(bytes.subarray(first), 0);
    this.length += bytes.length;
  }
  shift() {
    if (!this.length) return 0;
    const value = this.bytes[this.head];
    this.head = (this.head + 1) % this.bytes.length; this.length--;
    return value;
  }
}
