import { GoogleGenAI, Modality } from "https://esm.sh/@google/genai";

// Gemini Live wrapper with correct message formats and streaming support.
export class GeminiLiveClient {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    // Accept either "gemini-..." or "models/gemini-..." from the UI.
    this.model = String(model || "").replace(/^models\//, "");

    this.listeners = new Set();
    this.session = null;
    this.inputActive = false;
    this._msgCount = 0;
  }

  on(fn) {
    this.listeners.add(fn);
  }

  off(fn) {
    this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // ignore listener errors
      }
    }
  }

  async connect() {
    if (this.session) return;
    if (!this.apiKey) throw new Error("Missing Gemini API key");
    if (!this.model) throw new Error("Missing Gemini model id");

    console.log("[Gemini] connect(): model=", this.model);
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const config = {
      // We want text responses streamed back as tokens.
      responseModalities: [Modality.TEXT],
      // Turn on transcription of the user's audio input.
      inputAudioTranscription: {},
      // We'll control start/end ourselves to avoid VAD delays/hangs.
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: true,
        },
      },
    };

    this.session = await ai.live.connect({
      model: this.model,
      config,
      callbacks: {
        onopen: () => console.debug("[Gemini] onopen()"),
        onmessage: (message) => this.handleMessage(message),
        onerror: (e) => this.emit({ type: "error", error: e }),
        onclose: () => {
          this.session = null;
          this.inputActive = false;
        },
      },
    });

    console.log("[Gemini] connect(): session established");
  }

  startInputAudio() {
    if (!this.session || this.inputActive) return;
    this.session.sendRealtimeInput({ activityStart: {} });
    this.inputActive = true;
  }

  sendAudioChunk(pcm16Buffer) {
    if (!this.session || !this.inputActive) return;
    if (!pcm16Buffer || !pcm16Buffer.byteLength) return;

    const base64 = bufferToBase64(new Uint8Array(pcm16Buffer));
    this.session.sendRealtimeInput({
      audio: {
        data: base64,
        mimeType: "audio/pcm;rate=16000",
      },
    });
  }

  endInputAudio() {
    if (!this.session || !this.inputActive) return;
    this.session.sendRealtimeInput({ activityEnd: {} });
    this.inputActive = false;
  }

  sendTextPrompt(text) {
    if (!this.session) return;
    const trimmed = String(text || "").trim();
    if (!trimmed) return;

    console.log("[Gemini] sendTextPrompt(): sending", trimmed.slice(0, 120));

    // Mark the turn complete so the model produces an answer immediately.
    this.session.sendClientContent({
      turns: [
        {
          role: "user",
          parts: [{ text: trimmed }],
        },
      ],
      turnComplete: true,
    });
  }

  close() {
    try {
      this.session?.close();
    } catch {
      // ignore
    }
    this.session = null;
    this.inputActive = false;
  }

  handleMessage(message) {
    this._msgCount += 1;
    const serverContent = message?.serverContent;

    if (this._msgCount <= 30) {
      try {
        const inputText = serverContent?.inputTranscription?.text;
        const parts = serverContent?.modelTurn?.parts;
        const firstPartTexts = Array.isArray(parts)
          ? parts
              .map((p) => (typeof p?.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("")
              .slice(0, 120)
          : "";

        console.debug("[Gemini] msg", {
          n: this._msgCount,
          serverContentKeys: serverContent ? Object.keys(serverContent) : [],
          inputTranscription: typeof inputText === "string" ? inputText.slice(0, 80) : undefined,
          modelTurnTextPrefix: firstPartTexts || undefined,
          turnComplete: serverContent?.turnComplete,
        });
      } catch {
        // ignore logging failures
      }
    }

    // Live input transcription (speech-to-text from your audio input).
    const t = serverContent?.inputTranscription?.text;
    if (typeof t === "string" && t.trim()) {
      this.emit({ type: "transcription", text: t });
    }

    // Streamed model text tokens.
    const parts = serverContent?.modelTurn?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (typeof p?.text === "string" && p.text) {
          this.emit({ type: "response_delta", text: p.text });
        }
      }
    }

    if (serverContent?.turnComplete) {
      this.emit({ type: "response_done" });
    }
  }
}

function bufferToBase64(buf) {
  let binary = "";
  for (let i = 0; i < buf.length; i += 1) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

