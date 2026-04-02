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
   ```bash
   npm install
   ```
3. **Configuration:**
   - **API Keys**: Copy `.env.example` to `.env` and fill in your keys. This securely auto-loads them into the app.
   - **AI Context**: Open `ui/prompt_config.js` and specify your absolute context files:
     ```javascript
     export const RESUME_PATH = "C:/Users/.../resume.txt";
     export const JD_PATH = "C:/Users/.../job_description.txt";
     ```
4. **Run the application:**
   ```bash
   npm run dev
   ```

## 🛂 Usage
1. Click the **Mic** and **System** toggle buttons to start transcribing Meeting audio. (If not found in `.env`, it prompts for your Deepgram key upon first try).
2. Type your question into the input bar and click **Send**. (If not found in `.env`, it prompts for your Gemini key).
3. If you need to hide the UI quickly, hit `Ctrl + B` globally on your keyboard to instantly toggle visibility!

## 🐳 Dockerized Build

If you prefer to compile the application without installing Rust and Node natively on your machine, a self-contained Docker pipeline is included.

```bash
# Build the Rust/Node container image locally
docker-compose build

# Run the container to seamlessly cross-compile the native Tauri bundle.
# The resulting executables will automatically appear in your local `src-tauri/target/release` directory!
docker-compose run builder
```
