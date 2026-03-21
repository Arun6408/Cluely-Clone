// Deepgram streaming STT (microphone -> transcript).
//
// Auth note:
// Browsers cannot set custom Authorization headers on WebSocket.
// Deepgram supports token auth via WebSocket subprotocol:
//   Sec-WebSocket-Protocol: token, <API_KEY>
export class DeepgramMicTranscriber {
  constructor(opts) {
    this.deepgramKey = opts?.deepgramKey || "";
    this.language = opts?.language || "en";
    this.model = opts?.model || "nova-2";

    this.ws = null;
    this.audioCtx = null;
    this.processor = null;
    this.source = null;
    this.running = false;
    this.lastFinal = "";
    this.keepAliveTimer = null;

    // callbacks
    this.onTranscription = opts?.onTranscription || (() => {});
    this.onError = opts?.onError || (() => {});
  }

  async start() {
    if (this.running) return;
    if (!this.deepgramKey) throw new Error("Missing Deepgram API key");

    const url =
      `wss://api.deepgram.com/v1/listen?` +
      `encoding=linear16&sample_rate=16000&` +
      `language=${encodeURIComponent(this.language)}&` +
      `interim_results=true&punctuate=true&` +
      `model=${encodeURIComponent(this.model)}`;

    console.log("[Deepgram] connecting...");

    // Subprotocol token, then API key.
    this.ws = new WebSocket(url, ["token", this.deepgramKey]);

    await new Promise((resolve, reject) => {
      const ws = this.ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Deepgram streaming returns type: "Results"
        const alt = msg?.channel?.alternatives?.[0];
        const transcript = alt?.transcript;
        const isFinal = !!msg?.is_final;
        if (typeof transcript !== "string") return;
        const text = transcript.trim();
        if (!text) return;

        if (isFinal) {
          if (text !== this.lastFinal) {
            this.lastFinal = text;
            console.log("[Deepgram] final:", text);
            this.onTranscription({ type: "final", text });
          }
        } else {
          // Avoid spamming console too much
          // console.debug("[Deepgram] interim:", text);
          this.onTranscription({ type: "interim", text });
        }
      } catch (err) {
        // ignore parse errors but log once
        console.debug("[Deepgram] parse error", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[Deepgram] socket closed");
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.running = false;
    };

    this.ws.onerror = (e) => {
      console.error("[Deepgram] socket error", e);
      this.onError(e);
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });

    // Capture and resample to 16kHz PCM16.
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({});
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
    const inputRate = this.audioCtx.sampleRate || 48000;

    console.debug("[Deepgram] audioCtx.sampleRate=", inputRate);

    this.processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const resampled = resampleFloat32(input, inputRate, 16000);
      const pcm16 = floatTo16BitPCM(resampled);
      this.ws.send(pcm16.buffer);
    };

    // Silence the audio output; we only need the microphone input stream.
    const silentGain = this.audioCtx.createGain();
    silentGain.gain.value = 0;
    this.processor.connect(silentGain);
    silentGain.connect(this.audioCtx.destination);

    this.source.connect(this.processor);

    // Deepgram will close the socket if neither audio nor KeepAlive is received
    // in ~10 seconds. Send KeepAlive every 3 seconds.
    this.keepAliveTimer = setInterval(() => {
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        // ignore
      }
    }, 3000);

    this.running = true;
    console.log("[Deepgram] started.");
  }

  stop() {
    if (!this.running) return;
    console.log("[Deepgram] stopping...");
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.audioCtx?.close();
    } catch {
      // ignore
    }

    this.processor = null;
    this.source = null;
    this.audioCtx = null;
    this.running = false;
    this.lastFinal = "";
  }
}

// Deepgram streaming STT for externally provided PCM16 audio chunks.
// Intended for system/meeting audio coming from the Rust layer.
export class DeepgramPcmTranscriber {
  constructor(opts) {
    this.deepgramKey = opts?.deepgramKey || "";
    this.language = opts?.language || "en";
    this.model = opts?.model || "nova-2";
    this.sampleRate = opts?.sampleRate || 16000;

    this.ws = null;
    this.keepAliveTimer = null;
    this.running = false;

    this.lastFinal = "";
    this.onTranscription = opts?.onTranscription || (() => {});
    this.onError = opts?.onError || (() => {});
  }

  async start() {
    if (this.running) return;
    if (!this.deepgramKey) throw new Error("Missing Deepgram API key");

    const url =
      `wss://api.deepgram.com/v1/listen?` +
      `encoding=linear16&sample_rate=${this.sampleRate}&` +
      `channels=1&` +
      `language=${encodeURIComponent(this.language)}&` +
      `interim_results=true&punctuate=true&` +
      `model=${encodeURIComponent(this.model)}`;

    console.log("[DeepgramPcm] connecting...");
    this.ws = new WebSocket(url, ["token", this.deepgramKey]);

    await new Promise((resolve, reject) => {
      const ws = this.ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const alt = msg?.channel?.alternatives?.[0];
        const transcript = alt?.transcript;
        const isFinal = !!msg?.is_final;
        if (typeof transcript !== "string") return;

        const text = transcript.trim();
        if (!text) return;

        if (isFinal) {
          if (text !== this.lastFinal) {
            this.lastFinal = text;
            this.onTranscription({ type: "final", text });
          }
        } else {
          this.onTranscription({ type: "interim", text });
        }
      } catch (err) {
        console.debug("[DeepgramPcm] parse error", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[DeepgramPcm] socket closed");
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      this.running = false;
    };

    this.ws.onerror = (e) => {
      console.error("[DeepgramPcm] socket error", e);
      this.onError(e);
    };

    // KeepAlive every 3 seconds (prevents 10s silence close).
    this.keepAliveTimer = setInterval(() => {
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {
        // ignore
      }
    }, 3000);

    this.running = true;
    console.log("[DeepgramPcm] started.");
  }

  pushAudioChunk(pcm16ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!pcm16ArrayBuffer || pcm16ArrayBuffer.byteLength === 0) return;
    // Must be raw linear16 PCM bytes.
    this.ws.send(pcm16ArrayBuffer);
  }

  stop() {
    if (!this.running) return;
    console.log("[DeepgramPcm] stopping...");

    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;

    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    this.running = false;
    this.lastFinal = "";
  }
}

function floatTo16BitPCM(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    let s = input[i];
    if (s < -1) s = -1;
    if (s > 1) s = 1;
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function resampleFloat32(input, fromRate, toRate) {
  if (!input || input.length === 0) return input;
  if (!fromRate || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const newLength = Math.round(input.length / ratio);
  if (newLength <= 1) return input.slice(0, newLength);

  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < input.length; j += 1) {
      sum += input[j];
      count += 1;
    }
    result[i] = count ? sum / count : 0;
  }
  return result;
}

