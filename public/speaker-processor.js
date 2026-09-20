import { PcmRing } from './pcm-ring.js';
class PassportSpeaker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new PcmRing(sampleRate);
    this.reportFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') this.queue.reset();
      else this.queue.push(data);
    };
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    this.queue.render(left, right);
    this.reportFrames += left.length;
    if (this.reportFrames >= sampleRate) {
      this.reportFrames = 0;
      this.port.postMessage(this.queue.status());
    }
    return true;
  }
}
registerProcessor('passport-speaker', PassportSpeaker);
