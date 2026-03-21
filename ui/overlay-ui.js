import { GeminiTextClient } from "./gemini_text_client.js";
import { AI_INSTRUCTION, RESUME_PATH, JD_PATH, RESUME_PROMPT, JD_PROMPT } from "./prompt_config.js";
import {
  DeepgramMicTranscriber,
  DeepgramPcmTranscriber,
} from "./deepgram_stt_client.js";
import { listen } from "https://esm.sh/@tauri-apps/api/event";
import { invoke } from "https://esm.sh/@tauri-apps/api/core";

const MIC_ON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10m0 0a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v6a4 4 0 0 0 4 4zm0 0v4m0 0h-4m4 0h4"/></svg>`;
const MIC_OFF_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>`;

const SYSTEM_ON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
const SYSTEM_OFF_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export class OverlayApp {
  constructor() {
    this.gemini = null;
    this.transcriber = null; // Deepgram Mic
    this.systemTranscriber = null; // Deepgram System Audio
    this.micActive = false;
    this.systemActive = false;
    this.lastPromptEditAt = 0;
    this.chatMessages = [];
    this.userEditingPrompt = false;
    this.ignoreDeepgramUpdates = false;

    this.responseEl = document.getElementById("response");
    this.statusEl = document.getElementById("status");
    this.promptEl = document.getElementById("prompt");
    this.micBtn = document.getElementById("mic-btn");
    this.systemBtn = document.getElementById("system-btn");
    this.sendBtn = document.getElementById("send-btn");
    this.header = document.getElementById("header");

    this.transcriptionLogEl = document.getElementById("transcription-log");
    this.tabTranscriptionBtn = document.getElementById("tab-btn-transcription");
    this.tabAskAiBtn = document.getElementById("tab-btn-ask-ai");
    this.tabContentTranscription = document.getElementById("tab-content-transcription");
    this.tabContentAskAi = document.getElementById("tab-content-ask-ai");
    this.modelSelectBtn = document.getElementById("model-select-btn");
    this.modelSelectMenu = document.getElementById("model-select-menu");

    this.transcriptionHistory = [];
    this.currentScreenshot = null;
    
    document.getElementById("remove-attachment-btn")?.addEventListener("click", () => {
        this.currentScreenshot = null;
        document.getElementById("attachment-preview").style.display = "none";
        this.modelSelectMenu?.querySelectorAll(".dropdown-item").forEach(item => item.classList.remove("disabled"));
    });

    // Custom dropdown logic
    if (this.modelSelectBtn && this.modelSelectMenu) {
      this.modelSelectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.modelSelectMenu.classList.toggle("show");
      });

      document.addEventListener("click", (e) => {
        if (!this.modelSelectMenu.contains(e.target) && e.target !== this.modelSelectBtn) {
          this.modelSelectMenu.classList.remove("show");
        }
      });

      this.modelSelectMenu.querySelectorAll(".dropdown-item").forEach(item => {
        item.addEventListener("click", (e) => {
          const val = e.target.getAttribute("data-val");
          const text = e.target.textContent;
          this.modelSelectBtn.textContent = text + " ▼";
          this.modelSelectMenu.classList.remove("show");
          
          this.modelSelectMenu.querySelectorAll(".dropdown-item").forEach(i => i.classList.remove("selected"));
          e.target.classList.add("selected");

          if (this.gemini) {
            this.gemini.model = val;
          }
        });
      });
    }

    this.promptEl.addEventListener("focus", () => {
      this.userEditingPrompt = true;
    });
    this.promptEl.addEventListener("blur", () => {
      this.userEditingPrompt = false;
    });
    this.promptEl.addEventListener("keydown", () => {
      this.userEditingPrompt = true;
      this.lastPromptEditAt = Date.now();
    });

    this.header.addEventListener("mousedown", (e) => {
      // Allow clicking buttons inside the header region
      if (e.target.closest('button')) return;
      // For frameless windows we need to start dragging manually.
      e.preventDefault();
      invoke("drag_window").catch(() => {});
    });

    this.sendBtn.addEventListener("click", () => {
      console.log("[UI] Send clicked");
      this.sendPrompt();
    });
    this.micBtn.addEventListener("click", () => {
      console.log("[UI] Mic clicked");
      this.toggleMic();
    });

    this.systemBtn?.addEventListener("click", () => {
      console.log("[UI] System clicked");
      this.toggleSystem();
    });

    this.tabTranscriptionBtn?.addEventListener("click", () => this.switchTab("transcription"));
    this.tabAskAiBtn?.addEventListener("click", () => this.switchTab("ask-ai"));

    document.querySelectorAll(".quick-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const action = e.target.getAttribute("data-action");
        if (action === "what-next") {
          this.switchTab("ask-ai");
          this.promptEl.value = "Based on the conversation, what should I say next?";
          this.sendPrompt();
        } else if (action === "summarize") {
          this.switchTab("ask-ai");
          this.promptEl.value = "Please summarize the meeting so far.";
          this.sendPrompt();
        } else if (action === "screenshot") {
          this.takeScreenshot();
        }
      });
    });

    // Basic meeting audio sanity check:
    // if meeting audio is playing, Rust loopback capture should produce non-zero frames/sec.
    listen("system-audio-debug", (event) => {
      const payload = event?.payload || event;
      console.log("[SystemAudioDebug]", payload);
      if (payload?.frames) {
        this.setStatus(
          `System capturing audio • frames/sec: ${payload.frames} • packets/sec: ${payload.packets}`,
        );
      }
    }).catch((e) => console.error("[UI] listen(system-audio-debug) failed:", e));

    listen("system-audio-data", async (event) => {
      if (!this.systemActive) return;
      const payload = event?.payload || event;
      if (!payload || !payload.data_b64) return;

      // Initialize system transcriber lazily on first chunk
      if (!this.systemTranscriber) {
        const deepgramKey = window.localStorage.getItem("deepgram_api_key") || "";
        if (!deepgramKey) return; // Silent fail if no key provided.
        this.systemTranscriber = new DeepgramPcmTranscriber({
            deepgramKey,
            sampleRate: payload.sample_rate || 48000,
            onTranscription: ({ type, text }) => {
                if (type === "interim" && !this.systemActive) return;
                this.updateTranscription(text, type === "final", "Others");
            },
            onError: (e) => {
                console.error("[SystemTranscriber Error]", e);
                this.setStatus("System transcriber error");
            }
        });
        await this.systemTranscriber.start();
      }

      // decode base64
      const binaryString = atob(payload.data_b64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.systemTranscriber.pushAudioChunk(bytes.buffer);

    }).catch((e) => console.error("[UI] listen(system-audio-data) failed:", e));

    this.promptEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendPrompt();
      }
      // Track typing for system-audio overwrite guard.
      this.lastPromptEditAt = Date.now();
    });

    window.addEventListener("message", (ev) => {
      if (ev.data === "toggle_visibility") {
        console.log("[UI] hotkey toggle_visibility");
        this.toggleVisibility();
      } else if (ev.data === "send_prompt") {
        console.log("[UI] hotkey send_prompt");
        this.sendPrompt();
      }
    });
  }

  async initWithApiKey(
    apiKey,
    model = "gemini-3.1-flash-lite-preview",
  ) {
    console.log("[UI] initWithApiKey(): creating Gemini text client");
    this.gemini = new GeminiTextClient(apiKey, model);

    // Deepgram API key is only required if user enables microphone/system transcription.
    let deepgramKey = window.localStorage.getItem("deepgram_api_key") || "";

    this.setStatus("Auto-starting capture streams...");
    try {
      if (!this.systemActive) await this.toggleSystem();
    } catch (e) {
      console.error("[UI] auto toggleSystem failed", e);
    }

    if (deepgramKey) {
      // Auto-start Mic recording
      try {
        if (!this.micActive) await this.toggleMic();
      } catch (e) {
        console.error("[UI] auto toggleMic failed", e);
      }
    } else {
      this.setStatus("Ready • Meeting audio capture • Mic disabled (no Deepgram key)");
    }
  }

  renderChat() {
    this.responseEl.innerHTML = this.chatMessages.map(m => `
      <div class="chat-msg ${m.role === 'user' ? 'user' : 'others'}">
        <div style="width: 100%; overflow-x: auto;">
          ${m.role === 'user' ? m.text : window.marked.parse(m.text || "...")}
        </div>
      </div>
    `).join("");
    this.responseEl.scrollTop = this.responseEl.scrollHeight;
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  async sendPrompt() {
    if (!this.gemini) return;
    const text = this.promptEl.value.trim();
    if (!text) return;

    this.ignoreDeepgramUpdates = true;

    // Stop mic while generating response to avoid repeated calls from interim results.
    if (this.micActive && this.transcriber) {
      this.transcriber.stop();
      this.micActive = false;
      this.micBtn.innerHTML = MIC_OFF_SVG;
    }

    this.setStatus("Thinking...");

    console.log("[UI] sendPrompt(): sending to Gemini, len=", text.length);

    // Switch to Ask AI tab automatically
    this.switchTab("ask-ai");

    try {

      // Add user message to history and clear input immediately.
      this.chatMessages.push({ role: "user", text });
      this.renderChat();
      this.promptEl.value = "";
      // Make it easy to continue typing.
      this.promptEl.focus();

      const promptForModel = await this.buildGeminiPrompt();
      
      this.chatMessages.push({ role: "assistant", text: "" });
      const assistantMsgIndex = this.chatMessages.length - 1;
      this.renderChat();

      const stream = this.gemini.streamGenerateText(promptForModel, this.currentScreenshot);
      for await (const chunk of stream) {
          this.chatMessages[assistantMsgIndex].text += chunk;
          this.renderChat();
      }
      
      this.currentScreenshot = null;
      document.getElementById("attachment-preview").style.display = "none";
      this.setStatus("Done");

      // Re-enable models
      this.modelSelectMenu?.querySelectorAll(".dropdown-item").forEach(item => {
          item.classList.remove("disabled");
      });

      // Re-focus after DOM updates
      queueMicrotask(() => {
        try {
          this.promptEl.focus();
          this.promptEl.select();
        } catch {
          // ignore
        }
      });
    } catch (e) {
      console.error("[UI] Gemini error:", e);
      this.setStatus("Error: " + String(e?.message || e));
    } finally {
      this.ignoreDeepgramUpdates = false;
    }
  }

  async buildGeminiPrompt() {
    let resumeContext = "";
    if (RESUME_PATH) {
      try {
        const text = await invoke("read_file_content", { path: RESUME_PATH });
        if (text) resumeContext = `\n${RESUME_PROMPT}\n${text}\n`;
      } catch(e) { console.error("[UI] Failed to read resume:", e); }
    }
    
    let jdContext = "";
    if (JD_PATH) {
      try {
        const text = await invoke("read_file_content", { path: JD_PATH });
        if (text) jdContext = `\n${JD_PROMPT}\n${text}\n`;
      } catch(e) { console.error("[UI] Failed to read JD:", e); }
    }

    const history = this.chatMessages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
      .join("\n");

    const meetingContext = this.transcriptionHistory.length > 0 
      ? `\n\nLive Meeting Transcription Context:\n${this.transcriptionHistory.map(t => `${t.speaker}: ${t.text}`).join("\n")}`
      : "";

    return `${AI_INSTRUCTION}${jdContext}${resumeContext}${meetingContext}\n\nChat so far:\n${history}\n\nAssistant:`;
  }

  updateTranscription(text, isFinal, speaker) {
    // Skip interim rendering altogether so "ghost" text doesn't get stuck at the bottom.
    if (!isFinal) return;

    this.transcriptionHistory.push({ speaker, text });
    this.renderTranscription();
  }

  renderTranscription() {
    const textHtml = this.transcriptionHistory.map(t => `
      <div class="chat-msg ${t.speaker === 'User' ? 'user' : 'others'}">
        <div>${t.text}</div>
      </div>
    `).join("");

    this.transcriptionLogEl.innerHTML = textHtml;
    // Autoscroll
    this.transcriptionLogEl.scrollTop = this.transcriptionLogEl.scrollHeight;
  }

  async takeScreenshot() {
    try {
      this.setStatus("Taking screenshot...");
      const b64 = await invoke("take_screenshot");
      this.currentScreenshot = b64;
      
      const imgEl = document.getElementById("attachment-img");
      if (imgEl) {
          imgEl.src = "data:image/jpeg;base64," + b64;
          document.getElementById("attachment-preview").style.display = "flex";
      }

      this.setStatus("Screenshot added!");
      
      // Disable non-vision models
      this.modelSelectMenu?.querySelectorAll(".dropdown-item").forEach(item => {
          if (item.getAttribute("data-vision") === "false") {
              item.classList.add("disabled");
              if (item.classList.contains("selected")) {
                  item.classList.remove("selected");
                  const flashItem = document.querySelector('.dropdown-item[data-val="gemini-3-flash-preview"]');
                  if (flashItem) {
                      flashItem.classList.add("selected");
                      this.modelSelectBtn.textContent = flashItem.textContent + " ▼";
                      if (this.gemini) this.gemini.model = "gemini-3-flash-preview";
                  }
              }
          }
      });
    } catch (e) {
      console.error(e);
      this.setStatus("Screenshot failed: " + e);
    }
  }

  switchTab(tabId) {
    this.tabTranscriptionBtn?.classList.toggle("active", tabId === "transcription");
    this.tabContentTranscription?.classList.toggle("active", tabId === "transcription");
    
    this.tabAskAiBtn?.classList.toggle("active", tabId === "ask-ai");
    this.tabContentAskAi?.classList.toggle("active", tabId === "ask-ai");
  }

  async toggleMic() {
    if (!this.transcriber) {
      let deepgramKey = window.localStorage.getItem("deepgram_api_key") || "";
      if (!deepgramKey) {
        deepgramKey =
          window.prompt("Enter Deepgram API key (mic transcription)") || "";
        if (deepgramKey)
          window.localStorage.setItem("deepgram_api_key", deepgramKey);
      }
      if (!deepgramKey) return;

      this.transcriber = new DeepgramMicTranscriber({
        deepgramKey,
        language: "en",
        model: "nova-2",
        onTranscription: ({ type, text }) => {
          if (type === "interim" && !this.micActive) return;
          this.updateTranscription(text, type === "final", "User");
        },
        onError: (e) => {
          console.error("[Deepgram]", e);
          this.setStatus("Deepgram error (see console)");
        },
      });
    }

    if (this.micActive) {
      this.transcriber.stop();
      this.micActive = false;
      this.micBtn.innerHTML = MIC_OFF_SVG;
      this.setStatus("Mic off");
    } else {
      await this.transcriber.start();
      this.micActive = true;
      this.micBtn.innerHTML = MIC_ON_SVG;
      this.setStatus("Listening...");
    }
  }

  async toggleSystem() {
    if (this.systemActive) {
      try {
        await invoke("stop_system_audio_capture");
      } catch (e) {
        console.error("[UI] stop_system_audio_capture failed", e);
      }
      if (this.systemTranscriber) {
        this.systemTranscriber.stop();
        this.systemTranscriber = null;
      }
      this.systemActive = false;
      if (this.systemBtn) this.systemBtn.innerHTML = SYSTEM_OFF_SVG;
      this.setStatus("System off");
      return;
    }
    try {
      await invoke("start_system_audio_capture");
      this.systemActive = true;
      if (this.systemBtn) this.systemBtn.innerHTML = SYSTEM_ON_SVG;
      this.setStatus("System capturing meeting audio...");
      console.log("[UI] system-audio capture started");
    } catch (e) {
      console.error("[UI] start_system_audio_capture failed", e);
      this.setStatus("System start failed (see console)");
      this.systemActive = false;
    }
  }

  async toggleVisibility() {
    await invoke("toggle_overlay_visibility");
  }
}

