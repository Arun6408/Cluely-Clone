export class MicTranscriber {
  constructor(liveClient) {
    this.live = liveClient;
    this.audioCtx = null;
    this.processor = null;
    this.source = null;
    this.running = false;
    this._chunkCount = 0;
    this._inputSampleRate = 0;
  }

  async start() {
    if (this.running) return;

    console.log("[Mic] start()");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    this._inputSampleRate = this.audioCtx.sampleRate || 16000;
    console.debug("[Mic] audioCtx.sampleRate=", this._inputSampleRate);
    this.source = this.audioCtx.createMediaStreamSource(stream);
    // Lower buffer size reduces transcription latency.
    this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(
        resampleFloat32(input, this._inputSampleRate, 16000),
      );
      this._chunkCount += 1;
      if (this._chunkCount % 40 === 0) {
        console.debug("[Mic] chunks sent:", this._chunkCount);
      }
      this.live.sendAudioChunk(pcm16.buffer);
    };

    this.source.connect(this.processor);
    // Connect to a silent gain node to keep the audio graph alive
    // without playing anything (prevents feedback/echo loops).
    const silentGain = this.audioCtx.createGain();
    silentGain.gain.value = 0;
    this.processor.connect(silentGain);
    silentGain.connect(this.audioCtx.destination);

    // Tell Gemini that speech is starting; transcription should update live.
    this.live.startInputAudio();

    this.running = true;
  }

  stop() {
    if (!this.running) return;
    console.log("[Mic] stop()");
    if (this.processor) this.processor.disconnect();
    if (this.source) this.source.disconnect();
    if (this.audioCtx) this.audioCtx.close();
    this.processor = null;
    this.source = null;
    this.audioCtx = null;
    this.running = false;
    this._chunkCount = 0;
    this.live.endInputAudio();
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

  const sampleRateRatio = fromRate / toRate;
  const newLength = Math.round(input.length / sampleRateRatio);
  if (newLength <= 1) return input.slice(0, newLength);

  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * sampleRateRatio);
    const end = Math.floor((i + 1) * sampleRateRatio);
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

