# Cluely Clone - AI Assistant 🚀

A powerful, frameless, native desktop overlay application that provides real-time AI assistance during interviews or meetings. It uses Deepgram for lightning-fast speech-to-text transcription (capturing both your Microphone and loopback System Audio) and Google's Gemini API for streaming, context-aware generative AI responses.

## ✨ Features
* **Native System Capture**: Hooks directly into Windows WASAPI via Rust to capture system audio cleanly without third-party drivers or loopback cable hacks.
* **Instant Screenshots**: Built-in 5-line Rust module to capture your active screen natively using Windows `.NET Graphics` API, dropping it right into your Gemini Prompt.
* **Resume & JD Context**: Dynamically injects your local Resume file and target Job Description directly into the AI's system prompt to perfectly align the generated answers.
* **Markdown Streaming Chat**: Gemini responses stream natively into the DOM character-by-character, automatically formatting into headers, lists, and scrollable code blocks.
* **Frameless Globals**: Fully draggable, transparent UI overlay that can be toggled via `Ctrl+B` / `Cmd+B` globally across any app.

## 🛠 Prerequisites
* [Node.js](https://nodejs.org/en) installed.
* [Rust](https://rustup.rs/) installed.
* API Keys for **Deepgram** and **Gemini**.

## 🚀 Getting Started
1. **Clone the repository.**
2. **Install dependencies:**
   Because this project uses Tauri heavily hooked into Rust, please install the backend Tauri CLI explicitly:
   ```bash
   cargo install tauri-cli
   npm install
   ```
3. **Configure your paths:**
   Open `ui/prompt_config.js` and specify your absolute file paths:
   ```javascript
   export const RESUME_PATH = "C:/Users/.../resume.txt";
   export const JD_PATH = "C:/Users/.../job_description.txt";
   ```
4. **Run the application:**
   ```bash
   cargo tauri dev
   ```

## 🛂 Usage
1. Click the **Mic** and **System** toggle buttons to start transcribing Meeting audio. (It will prompt you for your Deepgram key upon first try).
2. Type your question into the input bar and click **Send**. (It will prompt for your Gemini key).
3. If you need to hide the UI quickly, hit `Ctrl + B` globally on your keyboard to instantly toggle visibility!
