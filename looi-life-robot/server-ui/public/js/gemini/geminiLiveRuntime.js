import {
  GEMINI_LIVE_INPUT_RATE,
  GEMINI_LIVE_OUTPUT_RATE,
  buildGeminiLiveSetup,
  geminiFunctionCallToAction,
  summarizeGeminiAction
} from "./geminiLiveTools.js";

const DEFAULT_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const INPUT_BUFFER_SIZE = 2048;

export class GeminiLiveRuntime {
  constructor({
    toolExecutor,
    face,
    lifeEngine,
    eventBus,
    logger,
    getRuntimeContext,
    fetchToken,
    transportFactory,
    mediaDevices,
    audioContextFactory,
    now
  } = {}) {
    this.toolExecutor = toolExecutor;
    this.face = face;
    this.lifeEngine = lifeEngine;
    this.eventBus = eventBus;
    this.logger = logger;
    this.getRuntimeContext = getRuntimeContext;
    this.fetchToken = fetchToken ?? defaultFetchToken;
    this.transportFactory = transportFactory ?? createWebSocketTransport;
    this.mediaDevices = mediaDevices ?? globalThis.navigator?.mediaDevices ?? null;
    this.audioContextFactory = audioContextFactory ?? createBrowserAudioContext;
    this.now = now ?? (() => Date.now());
    this.statusCallbacks = new Set();
    this.transport = null;
    this.micStream = null;
    this.inputAudioContext = null;
    this.outputAudioContext = null;
    this.inputSource = null;
    this.processor = null;
    this.activeOutputSources = new Set();
    this.nextOutputTime = 0;
    this.audioStatusTimer = 0;
    this.pendingToolCalls = new Map();
    this.lastVisionContextSignature = "";
    this.lastVisionContextSentAt = 0;
    this.runToken = 0;
    this.audioDebug = {
      sentInputFrames: 0,
      sentInputBytes: 0,
      receivedMessages: 0,
      receivedAudioChunks: 0,
      receivedAudioBytes: 0,
      queuedOutputChunks: 0,
      lastInputLogAt: 0
    };
    this.status = {
      enabled: false,
      configured: false,
      running: false,
      connecting: false,
      connected: false,
      micStreaming: false,
      audioPlaying: false,
      lastInputTranscript: "",
      lastOutputTranscript: "",
      lastToolCall: "",
      lastToolResult: "",
      latencyMs: null,
      lastError: "",
      outputAudioState: "",
      lastAudioDebug: "",
      lastServerMessageDebug: "",
      lastVideoFrameAt: 0,
      sentVideoFrames: 0,
      lastVideoFrameDebug: "",
      model: "",
      voice: "",
      thinkingLevel: "",
      setupComplete: false,
      startedAt: 0,
      lastAudioAt: 0,
      lastToolCallAt: 0
    };
  }

  configure(config = {}) {
    this.status.enabled = Boolean(config.geminiLiveEnabled);
    this.status.configured = Boolean(config.geminiLiveConfigured);
    this.status.model = config.geminiLiveModel || this.status.model;
    this.status.voice = config.geminiLiveVoice || this.status.voice || "Kore";
    this.status.thinkingLevel = config.geminiLiveThinkingLevel || this.status.thinkingLevel || "minimal";
    this.emitStatus();
  }

  onStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    this.statusCallbacks.add(callback);
    callback(this.getStatus());
    return () => this.statusCallbacks.delete(callback);
  }

  getStatus() {
    return { ...this.status };
  }

  isRunning() {
    return Boolean(this.status.running || this.status.connecting || this.status.connected);
  }

  async start({
    model,
    voice,
    thinkingLevel,
    captureAudio = true
  } = {}) {
    if (this.status.running || this.status.connecting) {
      return this.getStatus();
    }

    if (this.status.enabled === false) {
      throw new Error("Gemini Live is disabled in server config.");
    }

    const runToken = ++this.runToken;
    this.patchStatus({
      running: false,
      connecting: true,
      connected: false,
      setupComplete: false,
      lastError: "",
      latencyMs: null,
      startedAt: this.now(),
      model: model || this.status.model,
      voice: voice || this.status.voice || "Kore",
      thinkingLevel: thinkingLevel || this.status.thinkingLevel || "minimal"
    });
    await this.primeOutputAudio();
    this.log("GEMINI STEP 1 token request");

    try {
      const tokenPayload = await this.fetchToken();
      if (runToken !== this.runToken) {
        return this.getStatus();
      }

      const websocketUrl =
        tokenPayload.websocketUrl ||
        `${DEFAULT_WS_BASE}?access_token=${encodeURIComponent(tokenPayload.token || tokenPayload.tokenName || "")}`;

      if (!tokenPayload.token && !tokenPayload.tokenName && !tokenPayload.websocketUrl) {
        throw new Error("Gemini token response was missing token/websocketUrl.");
      }

      this.patchStatus({
        model: tokenPayload.model || model || this.status.model,
        voice: tokenPayload.voice || voice || this.status.voice || "Kore",
        thinkingLevel:
          tokenPayload.thinkingLevel || thinkingLevel || this.status.thinkingLevel || "minimal"
      });
      this.log(`GEMINI STEP 2 websocket connect model=${this.status.model}`);
      await this.openTransport(websocketUrl, runToken);

      if (runToken !== this.runToken) {
        return this.getStatus();
      }

      this.sendJson(buildGeminiLiveSetup({
        model: this.status.model,
        voice: this.status.voice,
        thinkingLevel: this.status.thinkingLevel
      }));
      this.log("GEMINI STEP 3 setup sent with audio response + tool declarations");

      if (captureAudio) {
        await this.startMic(runToken);
      }

      this.patchStatus({
        running: true,
        connecting: false,
        connected: true
      });
      this.lifeEngine?.setListening?.(true);
      this.face?.setExpression?.("attentive", 0.9);
      return this.getStatus();
    } catch (error) {
      this.patchStatus({
        running: false,
        connecting: false,
        connected: false,
        micStreaming: false,
        lastError: error.message
      });
      this.cleanupTransport();
      this.stopMic();
      this.log(`Gemini Live start failed: ${error.message}`, "warn");
      throw error;
    }
  }

  async stop(reason = "gemini_live_stop") {
    this.runToken += 1;
    this.interruptAudio(reason);
    this.stopMic();
    this.cleanupTransport();
    this.pendingToolCalls.clear();
    this.lifeEngine?.setListening?.(false);
    this.patchStatus({
      running: false,
      connecting: false,
      connected: false,
      micStreaming: false,
      audioPlaying: false,
      setupComplete: false
    });
    this.log(`Gemini Live stopped: ${reason}`);
    return this.getStatus();
  }

  interrupt(reason = "gemini_live_interrupt") {
    this.interruptAudio(reason);
    this.pendingToolCalls.clear();
    this.patchStatus({
      audioPlaying: false,
      lastToolResult: `interrupted:${reason}`
    });
  }

  async sendText(text) {
    const cleanText = String(text ?? "").trim();
    if (!cleanText || !this.status.connected) {
      return false;
    }

    this.sendJson({
      realtimeInput: {
        text: cleanText
      }
    });
    return true;
  }

  async sendVisionContext({ force = false, reason = "" } = {}) {
    if (!this.status.connected || typeof this.getRuntimeContext !== "function") {
      return false;
    }

    const context = this.getRuntimeContext() ?? {};
    const payload = compactVisionContext(context.vision, {
      recentObjectReference: context.recentObjectReference,
      reason
    });
    const text = safeStringify(payload);
    const signature = safeStringify(stableVisionSignature(payload));

    if (!force && signature === this.lastVisionContextSignature) {
      this.log(`GEMINI vision context skipped unchanged reason=${reason || "none"}`, "debug");
      return false;
    }

    this.lastVisionContextSignature = signature;
    this.lastVisionContextSentAt = this.now();
    this.log(
      `GEMINI vision context sent reason=${reason || "none"} force=${Boolean(force)} bytes=${text.length}`,
      "debug"
    );
    return this.sendText(`<vision_context>${text}</vision_context>`);
  }

  async sendVideoFrame({
    data,
    mimeType = "image/jpeg",
    width = null,
    height = null,
    reason = "gemini_vision"
  } = {}) {
    const cleanData = stripDataUrlPrefix(data);

    if (!cleanData || !this.status.connected) {
      return false;
    }

    this.sendJson({
      realtimeInput: {
        video: {
          data: cleanData,
          mimeType
        }
      }
    });

    const sentVideoFrames = Number(this.status.sentVideoFrames || 0) + 1;
    this.patchStatus({
      lastVideoFrameAt: this.now(),
      sentVideoFrames,
      lastVideoFrameDebug: `${reason}: ${mimeType} ${width ?? "?"}x${height ?? "?"} bytes~${estimateBase64Bytes(cleanData)}`
    });
    return true;
  }

  async openTransport(url, runToken) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = globalThis.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error("Gemini Live WebSocket open timed out."));
      }, 10_000);

      this.transport = this.transportFactory({
        url,
        onOpen: () => {
          if (settled || runToken !== this.runToken) {
            return;
          }
          settled = true;
          globalThis.clearTimeout(timeout);
          this.patchStatus({
            connected: true,
            connecting: false
          });
          resolve();
        },
        onMessage: (message) => {
          this.handleTransportMessage(message).catch((error) => {
            this.patchStatus({ lastError: error.message });
            this.log(`Gemini Live message parse failed: ${error.message}`, "warn");
          });
        },
        onError: (error) => {
          const message = error?.message || error?.error?.message || "Gemini Live WebSocket error.";
          this.patchStatus({ lastError: message });
          this.log(`Gemini Live WebSocket error: ${message}`, "warn");
          if (!settled) {
            settled = true;
            globalThis.clearTimeout(timeout);
            reject(new Error(message));
          }
        },
        onClose: () => {
          this.patchStatus({
            connected: false,
            running: false,
            micStreaming: false,
            audioPlaying: false
          });
          this.lifeEngine?.setListening?.(false);
        }
      });
    });
  }

  async startMic(runToken) {
    if (!this.mediaDevices?.getUserMedia) {
      throw new Error("Browser microphone capture is unavailable.");
    }

    const stream = await this.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (runToken !== this.runToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const AudioContextCtor = this.audioContextFactory();
    if (typeof AudioContextCtor !== "function") {
      throw new Error("Web Audio is unavailable in this browser.");
    }
    const audioContext = new AudioContextCtor();
    await audioContext.resume?.();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(
      INPUT_BUFFER_SIZE,
      1,
      1
    );

    processor.onaudioprocess = (event) => {
      if (runToken !== this.runToken || !this.status.connected) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const pcm = float32ToPcm16(downsampleFloat32(input, audioContext.sampleRate, GEMINI_LIVE_INPUT_RATE));

      if (!pcm.byteLength) {
        return;
      }

      this.recordInputAudioSent({
        bytes: pcm.byteLength,
        inputRate: audioContext.sampleRate,
        outputRate: GEMINI_LIVE_INPUT_RATE,
        samples: pcm.length
      });
      this.sendJson({
        realtimeInput: {
          audio: {
            data: arrayBufferToBase64(pcm.buffer),
            mimeType: `audio/pcm;rate=${GEMINI_LIVE_INPUT_RATE}`
          }
        }
      });
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
    this.micStream = stream;
    this.inputAudioContext = audioContext;
    this.inputSource = source;
    this.processor = processor;
    this.patchStatus({ micStreaming: true });
    this.log("GEMINI STEP 4 mic streaming started");
  }

  stopMic() {
    try {
      this.processor?.disconnect?.();
      this.inputSource?.disconnect?.();
    } catch (_error) {
      // Best-effort cleanup only.
    }

    this.processor = null;
    this.inputSource = null;
    this.micStream?.getTracks?.().forEach((track) => track.stop());
    this.micStream = null;
    this.inputAudioContext?.close?.().catch?.(() => {});
    this.inputAudioContext = null;
    this.patchStatus({ micStreaming: false });
  }

  async handleTransportMessage(rawMessage) {
    const parsed = await parseTransportMessage(rawMessage);
    const message = parsed?.message ?? null;

    if (!message) {
      this.log(
        `Gemini Live unparsable websocket message kind=${parsed?.kind ?? "unknown"} size=${parsed?.size ?? "unknown"} preview=${parsed?.preview ?? ""}`,
        "warn"
      );
      return;
    }

    this.audioDebug.receivedMessages += 1;
    this.patchStatus({
      lastServerMessageDebug: summarizeServerMessage(message)
    });

    if (message.setupComplete) {
      this.patchStatus({ setupComplete: true });
      this.log("GEMINI STEP 5 setup complete");
      this.sendVisionContext({ force: true, reason: "setup_complete" }).catch((error) => {
        this.log(`Gemini vision context send failed: ${error.message}`, "warn");
      });
    }

    this.handleTranscriptions(message);

    if (message.serverContent?.interrupted) {
      this.interruptAudio("gemini_server_interrupted");
    }

    const audioChunks = extractAudioChunks(message);
    if (audioChunks.length) {
      const bytes = audioChunks.reduce((total, chunk) => total + estimateBase64Bytes(chunk.data), 0);
      this.audioDebug.receivedAudioChunks += audioChunks.length;
      this.audioDebug.receivedAudioBytes += bytes;
    }
    audioChunks.forEach((chunk) => this.enqueueOutputAudio(chunk.data, chunk.mimeType));

    const functionCalls = readFunctionCalls(message);
    const cancelledToolCallIds = readToolCallCancellationIds(message);
    this.log(`Gemini tool requests: ${summarizeToolRequests(functionCalls, cancelledToolCallIds)}`);

    if (functionCalls.length) {
      this.handleToolCalls(functionCalls).catch((error) => {
        this.patchStatus({ lastError: error.message });
        this.log(`Gemini Live tool handling failed: ${error.message}`, "warn");
      });
    }

    if (cancelledToolCallIds.length) {
      this.handleToolCallCancellation(cancelledToolCallIds).catch((error) => {
        this.patchStatus({ lastError: error.message });
        this.log(`Gemini Live tool cancellation failed: ${error.message}`, "warn");
      });
    }
  }

  handleTranscriptions(message) {
    const inputText =
      message.serverContent?.inputTranscription?.text ??
      message.inputTranscription?.text ??
      "";
    const outputText =
      message.serverContent?.outputTranscription?.text ??
      message.outputTranscription?.text ??
      "";

    if (inputText) {
      this.patchStatus({ lastInputTranscript: inputText });
      this.eventBus?.publish?.("gemini_live_input_transcript", {
        text: inputText
      }, {
        source: "gemini_live",
        priority: 1
      });
    }

    if (outputText) {
      this.patchStatus({ lastOutputTranscript: outputText });
      this.eventBus?.publish?.("gemini_live_output_transcript", {
        text: outputText
      }, {
        source: "gemini_live",
        priority: 1
      });
    }
  }

  async handleToolCalls(functionCalls = []) {
    const responses = await Promise.all(functionCalls.map((call) => this.executeToolCall(call)));
    const functionResponses = responses.map((entry) => ({
      id: entry.id,
      name: entry.name,
      response: entry.response
    }));

    this.sendJson({
      toolResponse: {
        functionResponses
      }
    });
    this.patchStatus({
      latencyMs: this.status.startedAt ? this.now() - this.status.startedAt : this.status.latencyMs
    });
  }

  async executeToolCall(call = {}) {
    const name = String(call.name ?? "unknown");
    const id = String(call.id ?? `${name}_${Date.now()}`);
    const mapped = geminiFunctionCallToAction(call);

    this.patchStatus({
      lastToolCall: `${name} ${safeStringify(call.args ?? {})}`,
      lastToolCallAt: this.now()
    });

    if (!mapped.ok) {
      this.log(`Gemini Live rejected tool ${name}: ${mapped.reason}`, "warn");
      return {
        id,
        name,
        response: {
          error: mapped.reason
        }
      };
    }

    if (!this.toolExecutor?.executeBridgeAction) {
      return {
        id,
        name,
        response: {
          error: "ToolExecutor is unavailable."
        }
      };
    }

    const action = mapped.action;
    this.pendingToolCalls.set(id, {
      name,
      action,
      startedAt: this.now()
    });

    try {
      const result = await this.toolExecutor.executeBridgeAction(action);
      const status = result?.status ?? "completed";
      const executed = result?.executed === true;
      const accepted = ["completed", "queued"].includes(status) && executed;

      this.pendingToolCalls.delete(id);
      this.patchStatus({
        lastToolResult: `${name}: ${status}`
      });

      if (!accepted) {
        this.log(
          `Gemini Live tool ${name} did not execute: status=${status} message="${result?.message ?? "no result"}"`,
          "warn"
        );
      }

      return {
        id,
        name,
        response: {
          output: {
            accepted,
            queued: false,
            status,
            executed,
            physical: Boolean(result?.physical),
            message: result?.message ?? status,
            action: summarizeGeminiAction(action),
            detail: compactToolResult(result)
          }
        }
      };
    } catch (error) {
      this.pendingToolCalls.delete(id);
      this.patchStatus({
        lastToolResult: `${name}: failed`,
        lastError: error.message
      });
      this.log(`Gemini Live tool execution failed: ${error.message}`, "warn");
      return {
        id,
        name,
        response: {
          error: error.message
        }
      };
    }
  }

  async handleToolCallCancellation(ids = []) {
    const cancelled = [];

    ids.forEach((id) => {
      const key = String(id ?? "");
      if (!key) {
        return;
      }

      const pending = this.pendingToolCalls.get(key);
      if (pending) {
        cancelled.push(pending);
        this.pendingToolCalls.delete(key);
      }
    });

    this.patchStatus({
      lastToolResult: cancelled.length
        ? `cancelled: ${cancelled.map((entry) => entry.name).join(", ")}`
        : `cancelled unknown tool calls: ${ids.join(", ")}`
    });

    if (!cancelled.length) {
      return;
    }

    this.interruptAudio("gemini_tool_call_cancelled");
    await this.toolExecutor?.emergencyStop?.("gemini_tool_call_cancelled");
    this.log(`GEMINI STEP 7 tool cancellation: ${ids.join(", ")}`, "warn");
  }

  enqueueOutputAudio(base64Data, mimeType = "") {
    if (!base64Data) {
      this.log("GEMINI AUDIO skip empty output chunk", "warn");
      return;
    }

    if (!this.ensureOutputAudioContext()) {
      this.patchStatus({ lastError: "Web Audio output is unavailable." });
      this.log("GEMINI AUDIO output unavailable: Web Audio context missing", "warn");
      return;
    }
    this.resumeOutputAudio("output_chunk");

    const rate = parseAudioRate(mimeType) || GEMINI_LIVE_OUTPUT_RATE;
    const samples = pcm16Base64ToFloat32(base64Data);

    if (!samples.length) {
      this.patchStatus({
        lastAudioDebug: `empty output chunk mime=${mimeType || "unknown"}`
      });
      this.log(`GEMINI AUDIO decoded empty output chunk mime=${mimeType || "unknown"}`, "warn");
      return;
    }

    const buffer = this.outputAudioContext.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputAudioContext.destination);

    const startAt = Math.max(
      this.outputAudioContext.currentTime + 0.01,
      this.nextOutputTime || this.outputAudioContext.currentTime
    );
    this.nextOutputTime = startAt + buffer.duration;
    this.activeOutputSources.add(source);
    source.onended = () => {
      this.activeOutputSources.delete(source);
      this.log(`GEMINI AUDIO chunk ended active=${this.activeOutputSources.size}`);
      this.refreshAudioPlayingStatus();
    };
    source.start(startAt);
    this.audioDebug.queuedOutputChunks += 1;
    this.face?.setSpeaking?.(true);
    this.lifeEngine?.setSpeaking?.(true);
    this.patchStatus({
      audioPlaying: true,
      lastAudioAt: this.now(),
      outputAudioState: this.outputAudioContext?.state ?? "",
      lastAudioDebug: `queued ${samples.length} samples @ ${rate}Hz (${Math.round(buffer.duration * 1000)}ms), context=${this.outputAudioContext?.state ?? "unknown"}`
    });
    this.log(
      `GEMINI STEP 8 audio output queued chunk=${this.audioDebug.queuedOutputChunks} samples=${samples.length} rate=${rate} duration=${Math.round(buffer.duration * 1000)}ms context=${this.outputAudioContext?.state ?? "unknown"} startAt=${startAt.toFixed?.(3) ?? startAt}`
    );

    globalThis.clearTimeout(this.audioStatusTimer);
    this.audioStatusTimer = globalThis.setTimeout(() => {
      this.refreshAudioPlayingStatus();
    }, Math.max(100, Math.ceil(buffer.duration * 1000) + 60));
  }

  recordInputAudioSent({ bytes, inputRate, outputRate, samples } = {}) {
    this.audioDebug.sentInputFrames += 1;
    this.audioDebug.sentInputBytes += Number(bytes) || 0;
    const now = this.now();

    if (
      this.audioDebug.sentInputFrames <= 5 ||
      now - this.audioDebug.lastInputLogAt > 1000
    ) {
      this.audioDebug.lastInputLogAt = now;
      this.log(
        `GEMINI TX audio frame=${this.audioDebug.sentInputFrames} bytes=${bytes} samples=${samples} inputRate=${Math.round(Number(inputRate) || 0)} outputRate=${outputRate} totalBytes=${this.audioDebug.sentInputBytes}`
      );
    }
  }

  interruptAudio(reason = "gemini_live_audio_interrupt") {
    this.activeOutputSources.forEach((source) => {
      try {
        source.stop();
      } catch (_error) {
        // Source may already have ended.
      }
    });
    this.activeOutputSources.clear();
    this.nextOutputTime = this.outputAudioContext?.currentTime ?? 0;
    this.face?.setSpeaking?.(false);
    this.lifeEngine?.setSpeaking?.(false);
    this.patchStatus({ audioPlaying: false });
    this.log(`Gemini Live audio interrupted: ${reason}`);
  }

  async primeOutputAudio() {
    if (!this.ensureOutputAudioContext()) {
      this.patchStatus({
        outputAudioState: "unavailable",
        lastAudioDebug: "Web Audio output is unavailable."
      });
      return false;
    }

    await this.resumeOutputAudio("start");
    this.playSilentUnlockBuffer();
    this.patchStatus({
      outputAudioState: this.outputAudioContext?.state ?? "",
      lastAudioDebug: `audio primed, context=${this.outputAudioContext?.state ?? "unknown"}`
    });
    return true;
  }

  ensureOutputAudioContext() {
    if (this.outputAudioContext) {
      return true;
    }

    const AudioContextCtor = this.audioContextFactory();
    if (typeof AudioContextCtor !== "function") {
      return false;
    }

    this.outputAudioContext = new AudioContextCtor();
    return true;
  }

  async resumeOutputAudio(reason = "resume") {
    if (!this.outputAudioContext?.resume) {
      return false;
    }

    try {
      await this.outputAudioContext.resume();
      this.patchStatus({
        outputAudioState: this.outputAudioContext.state ?? "",
        lastAudioDebug: `audio resume ok (${reason}), context=${this.outputAudioContext.state ?? "unknown"}`
      });
      return true;
    } catch (error) {
      this.patchStatus({
        outputAudioState: this.outputAudioContext.state ?? "",
        lastAudioDebug: `audio resume failed (${reason}): ${error.message}`,
        lastError: error.message
      });
      this.log(`Gemini Live audio resume failed: ${error.message}`, "warn");
      return false;
    }
  }

  playSilentUnlockBuffer() {
    if (!this.outputAudioContext?.createBuffer || !this.outputAudioContext?.createBufferSource) {
      return;
    }

    try {
      const buffer = this.outputAudioContext.createBuffer(1, 1, this.outputAudioContext.sampleRate || GEMINI_LIVE_OUTPUT_RATE);
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.outputAudioContext.destination);
      source.start(0);
    } catch (_error) {
      // Unlock is best-effort only; real audio playback will report failures.
    }
  }

  refreshAudioPlayingStatus() {
    const playing = this.activeOutputSources.size > 0;
    this.patchStatus({
      audioPlaying: playing,
      outputAudioState: this.outputAudioContext?.state ?? this.status.outputAudioState
    });
    if (!playing) {
      this.face?.setSpeaking?.(false);
      this.lifeEngine?.setSpeaking?.(false);
    }
  }

  sendJson(payload) {
    if (!this.transport?.send) {
      throw new Error("Gemini Live transport is not connected.");
    }

    this.transport.send(JSON.stringify(payload));
  }

  cleanupTransport() {
    const transport = this.transport;
    this.transport = null;

    try {
      transport?.close?.();
    } catch (_error) {
      // Best-effort cleanup only.
    }
  }

  patchStatus(partial = {}) {
    this.status = {
      ...this.status,
      ...partial
    };
    this.emitStatus();
  }

  emitStatus() {
    const snapshot = this.getStatus();
    this.statusCallbacks.forEach((callback) => callback(snapshot));
  }

  log(message, level = "info") {
    if (typeof this.logger === "function") {
      this.logger(message, level);
    }
  }
}

export function downsampleFloat32(input, inputRate, outputRate) {
  if (!input?.length || inputRate <= 0 || outputRate <= 0) {
    return new Float32Array();
  }

  if (inputRate === outputRate) {
    return new Float32Array(input);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    let count = 0;

    for (let cursor = start; cursor < end; cursor += 1) {
      sum += input[cursor];
      count += 1;
    }

    output[index] = count ? sum / count : input[start] ?? 0;
  }

  return output;
}

export function float32ToPcm16(input) {
  const output = new Int16Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] || 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export function pcm16Base64ToFloat32(base64) {
  const bytes = base64ToUint8Array(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return samples;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return globalThis.btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function defaultFetchToken() {
  const response = await fetch("/api/gemini-live/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Gemini Live token HTTP ${response.status}`);
  }

  return payload;
}

function createWebSocketTransport({ url, onOpen, onMessage, onError, onClose }) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", onOpen);
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);

  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    get readyState() {
      return socket.readyState;
    }
  };
}

function createBrowserAudioContext() {
  return globalThis.AudioContext || globalThis.webkitAudioContext;
}

function parseJsonText(text) {
  try {
    return {
      message: JSON.parse(text),
      preview: text.slice(0, 300)
    };
  } catch (_error) {
    return {
      message: null,
      preview: text.slice(0, 300)
    };
  }
}

async function parseTransportMessage(rawMessage) {
  const data = rawMessage?.data ?? rawMessage;

  if (typeof data === "string") {
    return {
      ...parseJsonText(data),
      kind: "string",
      size: data.length
    };
  }

  if (data instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(new Uint8Array(data));
    return {
      ...parseJsonText(text),
      kind: "arraybuffer",
      size: data.byteLength
    };
  }

  if (ArrayBuffer.isView(data)) {
    const text = new TextDecoder().decode(data);
    return {
      ...parseJsonText(text),
      kind: "typedarray",
      size: data.byteLength
    };
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    const text = await data.text();
    return {
      ...parseJsonText(text),
      kind: "messageevent.blob",
      size: data.size
    };
  }

  if (data && typeof data === "object") {
    return {
      message: data,
      kind: "object",
      size: null,
      preview: Object.prototype.toString.call(data)
    };
  }

  return {
    message: null,
    kind: typeof data,
    size: null,
    preview: ""
  };
}

function extractAudioChunks(message = {}) {
  const chunks = [];
  const parts = [
    ...(message.serverContent?.modelTurn?.parts ?? []),
    ...(message.modelTurn?.parts ?? [])
  ];

  parts.forEach((part) => {
    const inlineData = part.inlineData ?? part.inline_data;

    if (!inlineData?.data) {
      return;
    }

    const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? "";
    if (!/audio\/pcm/i.test(mimeType)) {
      return;
    }

    chunks.push({
      data: inlineData.data,
      mimeType
    });
  });

  if (message.data && typeof message.data === "string") {
    chunks.push({
      data: message.data,
      mimeType: `audio/pcm;rate=${GEMINI_LIVE_OUTPUT_RATE}`
    });
  }

  return chunks;
}

function summarizeServerMessage(message = {}) {
  const parts = [
    ...(message.serverContent?.modelTurn?.parts ?? []),
    ...(message.modelTurn?.parts ?? [])
  ];
  const audioCount = parts.filter((part) => {
    const inlineData = part.inlineData ?? part.inline_data;
    const mimeType = inlineData?.mimeType ?? inlineData?.mime_type ?? "";
    return inlineData?.data && /audio\/pcm/i.test(mimeType);
  }).length;
  const textCount = parts.filter((part) => typeof part.text === "string" && part.text.trim()).length;
  const toolCount = readFunctionCalls(message).length;
  const cancelCount = readToolCallCancellationIds(message).length;
  const labels = [];

  if (message.setupComplete) labels.push("setupComplete");
  if (message.serverContent?.inputTranscription?.text || message.inputTranscription?.text) labels.push("inputTranscript");
  if (message.serverContent?.outputTranscription?.text || message.outputTranscription?.text) labels.push("outputTranscript");
  if (audioCount) labels.push(`audio:${audioCount}`);
  if (textCount) labels.push(`text:${textCount}`);
  if (toolCount) labels.push(`tool:${toolCount}`);
  if (cancelCount) labels.push(`cancel:${cancelCount}`);
  if (message.serverContent?.interrupted) labels.push("interrupted");
  if (!labels.length) labels.push(Object.keys(message).slice(0, 4).join(",") || "unknown");

  return labels.join(" | ");
}

function readFunctionCalls(message = {}) {
  const calls = message.toolCall?.functionCalls
    ?? message.tool_call?.function_calls
    ?? message.toolCall?.function_calls
    ?? message.tool_call?.functionCalls
    ?? [];

  return Array.isArray(calls) ? calls : [];
}

function readToolCallCancellationIds(message = {}) {
  const cancellation = message.toolCallCancellation ?? message.tool_call_cancellation;
  const ids = cancellation?.ids ?? cancellation?.functionCallIds ?? cancellation?.function_call_ids ?? [];

  return Array.isArray(ids)
    ? ids.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];
}

function summarizeToolRequests(functionCalls = [], cancelledIds = []) {
  const calls = Array.isArray(functionCalls) ? functionCalls : [];
  const parts = calls.map((call) => {
    const name = String(call?.name ?? "unknown").trim() || "unknown";
    const args = shortText(safeStringify(call?.args ?? {}), 220);
    return `${name}(${args})`;
  });

  if (Array.isArray(cancelledIds) && cancelledIds.length) {
    parts.push(`cancelled:${cancelledIds.join(",")}`);
  }

  return parts.length ? parts.join(" | ") : "none";
}

function compactToolResult(result = null) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const route = result.detail?.route ?? null;
  const routeResult = route?.result ?? null;

  return {
    actionId: result.actionId ?? null,
    type: result.type ?? null,
    status: result.status ?? null,
    executed: Boolean(result.executed),
    physical: Boolean(result.physical),
    routeStatus: route?.status ?? null,
    macro: route?.macro ?? result.detail?.macro ?? null,
    partial: Boolean(routeResult?.partial ?? result.detail?.partial),
    skippedFrames: Array.isArray(routeResult?.skippedFrames)
      ? routeResult.skippedFrames.slice(0, 8)
      : undefined,
    scenario: result.detail?.scenario ?? null,
    scenarioMovement: result.detail?.scenarioMovement ?? undefined
  };
}

function parseAudioRate(mimeType = "") {
  const match = /rate=(\d+)/i.exec(String(mimeType));
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function estimateBase64Bytes(base64 = "") {
  const value = String(base64 || "");
  if (!value) {
    return 0;
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function stripDataUrlPrefix(value) {
  const text = String(value ?? "");
  const commaIndex = text.indexOf(",");
  return text.startsWith("data:") && commaIndex >= 0 ? text.slice(commaIndex + 1) : text;
}

function compactVisionContext(vision = {}, { recentObjectReference = null, reason = "" } = {}) {
  const objects = Array.isArray(vision?.objects)
    ? vision.objects.slice(0, 12).map((object) => ({
        label: shortText(object.label, 80),
        visible: Boolean(object.visible),
        confidence: finiteOrNull(object.confidence),
        position: shortText(object.position, 40),
        distance: shortText(object.distance, 40),
        trackId: shortText(object.trackId, 80),
        lastSeenMs: finiteOrNull(object.lastSeenMs)
      }))
    : [];
  const followScenarioActive = Boolean(
    vision?.scenario?.active &&
    vision?.scenario?.type === "follow_object" &&
    vision?.scenario?.state !== "idle" &&
    vision?.scenario?.state !== "not_found"
  );
  const useMediaPipeObjects = Boolean(followScenarioActive || vision?.activeTarget);

  return {
    mode: useMediaPipeObjects ? "mediapipe_follow" : "gemini_live_video",
    reason: shortText(reason, 80),
    visibleLabels: useMediaPipeObjects ? shortText(vision?.visibleLabels, 240) : "",
    objects: useMediaPipeObjects ? objects : [],
    activeTarget: useMediaPipeObjects && vision?.activeTarget
      ? {
          label: shortText(vision.activeTarget.label, 80),
          visible: Boolean(vision.activeTarget.visible),
          position: shortText(vision.activeTarget.position, 40),
          distance: shortText(vision.activeTarget.distance, 40),
          trackId: shortText(vision.activeTarget.trackId, 80),
          lostForMs: finiteOrNull(vision.activeTarget.lostForMs)
      }
      : null,
    scenario: vision?.scenario
      ? {
          active: Boolean(vision.scenario.active),
          type: shortText(vision.scenario.type, 80),
          targetLabel: shortText(vision.scenario.targetLabel, 80),
          state: shortText(vision.scenario.state, 80),
          reason: shortText(vision.scenario.reason, 120)
        }
      : null,
    detectorRunning: useMediaPipeObjects ? Boolean(vision?.detectorRunning) : false,
    cameraRunning: Boolean(vision?.cameraRunning),
    currentCameraFacingMode: shortText(vision?.currentCameraFacingMode, 40),
    lastDetectionAgeMs: useMediaPipeObjects ? finiteOrNull(vision?.lastDetectionAgeMs) : null,
    recentObjectReference: recentObjectReference
      ? {
          label: shortText(recentObjectReference.label, 80),
          trackId: shortText(recentObjectReference.trackId, 80),
          lastMentionedByUserAt: shortText(recentObjectReference.lastMentionedByUserAt, 80),
          lastSeenAt: finiteOrNull(recentObjectReference.lastSeenAt)
        }
      : null
  };
}

function stableVisionSignature(payload = {}) {
  return {
    mode: payload.mode,
    visibleLabels: payload.visibleLabels,
    objects: Array.isArray(payload.objects)
      ? payload.objects
          .map((object) => ({
            label: object.label,
            visible: Boolean(object.visible),
            position: object.position,
            distance: object.distance
          }))
          .sort(compareVisionSignatureObjects)
      : [],
    activeTarget: payload.activeTarget
      ? {
          label: payload.activeTarget.label,
          visible: Boolean(payload.activeTarget.visible),
          position: payload.activeTarget.position,
          distance: payload.activeTarget.distance
        }
      : null,
    scenario: payload.scenario
      ? {
          active: Boolean(payload.scenario.active),
          type: payload.scenario.type,
          targetLabel: payload.scenario.targetLabel,
          state: payload.scenario.state
        }
      : null,
    detectorRunning: payload.detectorRunning,
    cameraRunning: payload.cameraRunning,
    currentCameraFacingMode: payload.currentCameraFacingMode,
    recentObjectReference: payload.recentObjectReference
      ? {
          label: payload.recentObjectReference.label
        }
      : null
  };
}

function compareVisionSignatureObjects(a, b) {
  return [
    String(a.label ?? "").localeCompare(String(b.label ?? "")),
    String(a.position ?? "").localeCompare(String(b.position ?? "")),
    String(a.distance ?? "").localeCompare(String(b.distance ?? "")),
    Number(a.visible) - Number(b.visible)
  ].find((value) => value !== 0) ?? 0;
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function shortText(value, max = 120) {
  return String(value ?? "").slice(0, max);
}
