export function resampleMono(input, sourceRate, targetRate) {
  if (sourceRate === targetRate) return new Float32Array(input);
  const outputLength = Math.max(1, Math.floor(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
}

export function floatToPcm16(input, channels) {
  const output = new Uint8Array(input.length * channels * 2);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const value of input) {
    const sample = Math.max(-1, Math.min(1, value));
    const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16(offset, pcm, true);
      offset += 2;
    }
  }
  return output;
}

export class BrowserAudio extends EventTarget {
  #context = null;
  #gain = null;
  #speaker = null;
  #outputReady = null;
  #nextPlaybackTime = 0;
  #sources = new Set();
  #microphoneStream = null;
  #microphoneNode = null;
  #microphoneSource = null;
  #microphoneSink = null;
  #microphoneBytes = new Uint8Array();
  #sendMicrophone;
  #format = { sampleRate: 16000, bits: 16, channels: 1 };

  constructor(sendMicrophone) {
    super();
    this.#sendMicrophone = sendMicrophone;
  }

  configure(format) {
    if (format.bits !== 16 || ![1, 2].includes(format.channels)) return;
    this.#format = {
      sampleRate: format.sampleRate,
      bits: format.bits,
      channels: format.channels,
    };
  }

  async enableOutput() {
    if (!this.#context) {
      this.#context = new AudioContext({ latencyHint: "interactive" });
      this.#gain = this.#context.createGain();
      this.#gain.connect(this.#context.destination);
    }
    await this.#context.resume();
    if (!this.#outputReady) {
      this.#outputReady = this.#initializeSpeaker();
    }
    await this.#outputReady;
    this.dispatchEvent(new CustomEvent("output", { detail: true }));
  }

  async #initializeSpeaker() {
    if (!this.#context.audioWorklet || typeof AudioWorkletNode === "undefined") return;
    try {
      await this.#context.audioWorklet.addModule("/speaker-processor.js");
      this.#speaker = new AudioWorkletNode(this.#context, "passport-speaker", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.#speaker.connect(this.#gain);
      this.#speaker.port.onmessage = ({ data }) => {
        this.dispatchEvent(new CustomEvent("status", { detail: data }));
      };
    } catch (error) {
      // Keep playback available on browsers without AudioWorklet support.
      console.warn("AudioWorklet unavailable; using scheduled audio buffers", error);
    }
  }

  play(packet) {
    if (packet.bits !== 16 || ![1, 2].includes(packet.channels)) return;
    const bytes = packet.bytes instanceof Uint8Array ? packet.bytes : new Uint8Array(packet.bytes);
    if (!this.#context || this.#context.state !== "running") {
      return;
    }
    if (this.#speaker) {
      this.#speaker.port.postMessage({ ...packet, bytes }, [bytes.buffer]);
      return;
    }
    const frames = Math.floor(bytes.byteLength / (packet.channels * 2));
    if (!frames) return;
    const buffer = this.#context.createBuffer(
      packet.channels,
      frames,
      packet.sampleRate,
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let channel = 0; channel < packet.channels; channel += 1) {
      const output = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame += 1) {
        const offset = (frame * packet.channels + channel) * 2;
        output[frame] = view.getInt16(offset, true) / 32768;
      }
    }

    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    const packetGain = this.#context.createGain();
    packetGain.gain.value = Math.max(0, Math.min(1, (packet.volume ?? 100) / 100));
    source.connect(packetGain);
    packetGain.connect(this.#gain);
    this.#sources.add(source);
    source.addEventListener("ended", () => {
      this.#sources.delete(source);
      source.disconnect();
      packetGain.disconnect();
    }, { once: true });
    if (this.#nextPlaybackTime - this.#context.currentTime > 1) {
      for (const queued of this.#sources) {
        if (queued !== source) queued.stop();
      }
      this.#nextPlaybackTime = 0;
    }

    // Buffer scheduler jitter once, then preserve a contiguous PCM timeline.
    const start = this.#nextPlaybackTime > this.#context.currentTime
      ? this.#nextPlaybackTime : this.#context.currentTime + 0.06;
    source.start(start);
    this.#nextPlaybackTime = start + buffer.duration;
  }

  reset() {
    this.#speaker?.port.postMessage({ type: "reset" });
    for (const source of this.#sources) source.stop();
    this.#sources.clear();
    this.#nextPlaybackTime = 0;
    this.#microphoneBytes = new Uint8Array();
  }

  async startMicrophone() {
    await this.enableOutput();
    if (this.#microphoneStream) return;
    await this.#context.audioWorklet.addModule("/mic-processor.js");
    this.#microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    try {
      const source = this.#microphoneSource = this.#context.createMediaStreamSource(this.#microphoneStream);
      this.#microphoneNode = new AudioWorkletNode(this.#context, "passport-mic");
      this.#microphoneSink = this.#context.createGain();
      this.#microphoneSink.gain.value = 0;
      this.#microphoneNode.port.onmessage = (event) => this.#handleMicrophone(event.data);
      source.connect(this.#microphoneNode);
      this.#microphoneNode.connect(this.#microphoneSink);
      this.#microphoneSink.connect(this.#context.destination);
      this.dispatchEvent(new CustomEvent("microphone", { detail: true }));
    } catch (error) {
      this.stopMicrophone();
      throw error;
    }
  }

  stopMicrophone() {
    this.#microphoneSource?.disconnect();
    this.#microphoneSource = null;
    this.#microphoneNode?.disconnect();
    this.#microphoneSink?.disconnect();
    for (const track of this.#microphoneStream?.getTracks() || []) track.stop();
    this.#microphoneNode = null;
    this.#microphoneSink = null;
    this.#microphoneStream = null;
    this.#microphoneBytes = new Uint8Array();
    this.dispatchEvent(new CustomEvent("microphone", { detail: false }));
  }

  get microphoneActive() {
    return Boolean(this.#microphoneStream);
  }

  #handleMicrophone(samples) {
    if (!this.#microphoneStream) return;
    // RX format belongs to the virtual microphone, not the speaker's TX format.
    this.#sendMicrophone(samples instanceof Float32Array ? samples : new Float32Array(samples), this.#context.sampleRate);
  }
}
