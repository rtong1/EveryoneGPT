class VoiceInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const frame = inputs[0]?.[0];
    if (!frame) return true;
    for (let i = 0; i < frame.length; i++) {
      this.buffer[this.offset++] = frame[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-input', VoiceInput);
