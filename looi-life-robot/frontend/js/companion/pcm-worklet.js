class PCM16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.count = 0;
    this.sum = 0;
    this.frame = [];
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      this.sum += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame.push(Math.max(-1, Math.min(1, this.sum / this.count)));
        this.sum = 0;
        this.count = 0;
        if (this.frame.length === 1600) {
          const values = Float32Array.from(this.frame);
          this.port.postMessage(values, [values.buffer]);
          this.frame = [];
        }
      }
    }
    return true;
  }
}
registerProcessor("looi-pcm16", PCM16Capture);
