const INPUT_BUFFER_SIZE = 2048;
const TARGET_SAMPLE_RATE = 16000;
const WAKE_COOLDOWN_MS = 1800;
const CONNECT_TIMEOUT_MS = 2500;

export class OpenWakeWordWakeDetector {
  constructor({
    wsUrl,
    fallbackDetector = null,
    onWakePhrase,
    onStatus,
    logger,
    mediaDevices,
    audioContextFactory,
    now
  } = {}) {
    this.wsUrl = wsUrl;
    this.fallbackDetector = fallbackDetector;
    this.onWakePhrase = onWakePhrase;
    this.onStatus = onStatus;
    this.logger = logger;
    this.mediaDevices = mediaDevices ?? globalThis.navigator?.mediaDevices ?? null;
    this.audioContextFactory = audioContextFactory ?? getAudioContextCtor;
    this.now = now ?? (() => Date.now());
    this.wanted = false;
    this.listening = false;
    this.fallbackActive = false;
    this.websocket = null;
    this.micStream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.connectTimer = 0;
    this.lastDetectionAt = 0;
    this.lastError = "";
    this.lastWake = null;
  }

  isSupported() {
    return Boolean(this.wsUrl && this.mediaDevices?.getUserMedia && this.audioContextFactory());
  }

  getStatus() {
    const fallbackStatus = this.fallbackDetector?.getStatus?.() ?? null;
    return {
      supported: this.isSupported() || Boolean(fallbackStatus?.supported),
      provider: this.fallbackActive ? "web_speech" : "openwakeword",
      wanted: this.wanted,
      listening: this.listening || Boolean(fallbackStatus?.listening),
      fallbackActive: this.fallbackActive,
      lastTranscript: fallbackStatus?.lastTranscript ?? "",
      lastError: this.lastError || fallbackStatus?.lastError || "",
      lastWake: this.lastWake
    };
  }

  start(reason = "wake_detector_start") {
    this.wanted = true;
    this.lastError = "";
    this.emitStatus();

    if (!this.isSupported()) {
      this.startFallback("openwakeword_unsupported");
      return this.fallbackDetector?.getStatus?.().supported !== false;
    }

    this.startOpenWakeWord(reason).catch((error) => {
      this.lastError = error.message;
      this.log(`openWakeWord wake detector unavailable: ${error.message}`, "warn");
      this.stopOpenWakeWord("openwakeword_start_failed");
      if (this.wanted) {
        this.startFallback("openwakeword_start_failed");
      }
    });
    return true;
  }

  stop(reason = "wake_detector_stop") {
    this.wanted = false;
    this.stopOpenWakeWord(reason);
    this.stopFallback(reason);
    this.emitStatus();
  }

  async startOpenWakeWord(reason = "openwakeword_start") {
    this.stopFallback("openwakeword_primary_start");
    this.stopOpenWakeWord("openwakeword_restart");

    const websocket = await this.openWebSocket();
    if (!this.wanted || websocket !== this.websocket) {
      websocket.close();
      return;
    }

    await this.startMic(websocket);
    this.listening = true;
    this.fallbackActive = false;
    this.log(`openWakeWord wake detector listening (${reason}).`);
    this.emitStatus();
  }

  openWebSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const websocket = new WebSocket(this.wsUrl);
      websocket.binaryType = "arraybuffer";
      this.websocket = websocket;

      this.connectTimer = globalThis.setTimeout?.(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`openWakeWord connect timed out at ${this.wsUrl}`));
      }, CONNECT_TIMEOUT_MS) ?? 0;

      websocket.onopen = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.clearConnectTimer();
        resolve(websocket);
      };

      websocket.onmessage = (event) => {
        this.handleWebSocketMessage(event.data);
      };

      websocket.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.clearConnectTimer();
        reject(new Error(`openWakeWord WebSocket error at ${this.wsUrl}`));
      };

      websocket.onclose = () => {
        if (this.websocket === websocket) {
          this.websocket = null;
        }
        this.stopMic();
        this.listening = false;
        this.emitStatus();
        if (this.wanted && !this.fallbackActive) {
          this.startFallback("openwakeword_closed");
        }
      };
    });
  }

  async startMic(websocket) {
    const stream = await this.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (!this.wanted || websocket !== this.websocket) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const AudioContextCtor = this.audioContextFactory();
    const audioContext = new AudioContextCtor();
    await audioContext.resume?.();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(INPUT_BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
      if (!this.wanted || websocket.readyState !== WebSocket.OPEN) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm = float32ToPcm16(downsampleFloat32(input, audioContext.sampleRate, TARGET_SAMPLE_RATE));
      if (pcm.byteLength) {
        websocket.send(pcm.buffer);
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    this.micStream = stream;
    this.audioContext = audioContext;
    this.source = source;
    this.processor = processor;
  }

  handleWebSocketMessage(data) {
    const payload = parseJsonMessage(data);
    if (!payload) {
      return;
    }

    if (payload.type === "ready") {
      this.log(
        `openWakeWord ready models=${formatModels(payload.models)} threshold=${payload.threshold ?? "?"}`,
        "debug"
      );
      return;
    }

    if (payload.type !== "wake") {
      return;
    }

    const now = this.now();
    if (now - this.lastDetectionAt < WAKE_COOLDOWN_MS) {
      return;
    }

    this.lastDetectionAt = now;
    this.lastWake = {
      model: payload.model ?? "unknown",
      score: payload.score ?? null,
      at: now
    };
    this.emitStatus();
    this.onWakePhrase?.({
      phrase: `openwakeword:${payload.model ?? "wake"}`,
      transcript: "",
      commandText: "",
      provider: "openwakeword",
      score: payload.score ?? null
    });
  }

  startFallback(reason = "openwakeword_fallback") {
    if (!this.fallbackDetector?.start) {
      this.emitStatus();
      return false;
    }

    this.stopOpenWakeWord(reason);
    this.fallbackActive = true;
    const started = this.fallbackDetector.start(reason);
    this.emitStatus();
    return started;
  }

  stopFallback(reason = "stop_fallback") {
    this.fallbackActive = false;
    this.fallbackDetector?.stop?.(reason);
  }

  stopOpenWakeWord(reason = "openwakeword_stop") {
    this.clearConnectTimer();
    this.stopMic();

    const websocket = this.websocket;
    this.websocket = null;
    if (websocket && websocket.readyState <= WebSocket.OPEN) {
      try {
        websocket.close(1000, reason);
      } catch (_error) {
        // Best-effort cleanup only.
      }
    }

    this.listening = false;
  }

  stopMic() {
    try {
      this.processor?.disconnect?.();
      this.source?.disconnect?.();
    } catch (_error) {
      // Best-effort cleanup only.
    }

    this.processor = null;
    this.source = null;
    this.micStream?.getTracks?.().forEach((track) => track.stop());
    this.micStream = null;
    this.audioContext?.close?.().catch?.(() => {});
    this.audioContext = null;
  }

  clearConnectTimer() {
    if (!this.connectTimer) {
      return;
    }

    globalThis.clearTimeout?.(this.connectTimer);
    this.connectTimer = 0;
  }

  emitStatus() {
    this.onStatus?.(this.getStatus());
  }

  log(message, level = "info") {
    this.logger?.(message, level);
  }
}

function parseJsonMessage(data) {
  try {
    return JSON.parse(String(data ?? ""));
  } catch (_error) {
    return null;
  }
}

function formatModels(models) {
  return Array.isArray(models) ? models.join(",") : String(models ?? "unknown");
}

function getAudioContextCtor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function downsampleFloat32(input, inputRate, outputRate) {
  if (!input?.length || !inputRate || inputRate === outputRate) {
    return input ? new Float32Array(input) : new Float32Array();
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex];
      count += 1;
    }

    output[index] = count > 0 ? sum / count : 0;
  }

  return output;
}

function float32ToPcm16(float32) {
  const output = new Int16Array(float32?.length ?? 0);
  for (let index = 0; index < output.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(float32[index]) || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}
