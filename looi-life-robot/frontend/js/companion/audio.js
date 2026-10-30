export class SharedMicrophone {
  constructor() {
    this.listeners = new Set();
    this.generation = 0;
    this.context = null;
    this.stream = null;
    this.pending = null;
    this.paused = false;
    this.onFailure = () => {};
  }
  unlock() {
    if (!this.context || this.context.state === "closed") {
      const C = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!C) throw Error("Web Audio unavailable / 浏览器不支持音频");
      this.context = new C();
    }
    return this.context.resume();
  }
  async start() {
    if (this.stream) return;
    if (this.pending) {
      if (this.pendingGeneration === this.generation) return this.pending;
      await this.pending.catch(() => {});
      return this.start();
    }
    const token = this.generation;
    this.pendingGeneration = token;
    this.pending = (async () => {
      await this.unlock();
      const context = this.context;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (token !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      try {
        await context.audioWorklet.addModule(
          new URL("./pcm-worklet.js", import.meta.url),
        );
        if (token !== this.generation) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.stream = stream;
        this.source = context.createMediaStreamSource(stream);
        this.node = new AudioWorkletNode(context, "looi-pcm16");
        this.node.port.onmessage = ({ data }) => {
          if (token !== this.generation || this.paused) return;
          for (const listener of this.listeners) listener(data);
        };
        this.source.connect(this.node);
        this.node.connect(context.destination);
        for (const track of stream.getTracks())
          track.onended = () => {
            if (token === this.generation) {
              this.stop();
              this.onFailure("Microphone interrupted / 麦克风采集中断");
            }
          };
        context.onstatechange = () => {
          if (token === this.generation && context.state === "interrupted") {
            this.stop();
            this.onFailure("Audio interrupted / 音频被系统中断");
          }
        };
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  stop() {
    this.generation++;
    this.node?.disconnect();
    this.source?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.node = null;
    this.source = null;
    const c = this.context;
    this.context = null;
    c?.close().catch(() => {});
  }
}
export function pcm16(samples) {
  const b = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++)
    b[i] = Math.round(
      Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 32768 : 32767),
    );
  return b;
}
