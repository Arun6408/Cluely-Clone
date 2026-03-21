import { OverlayApp } from "./overlay-ui.js";

async function bootstrap() {
  let apiKey = window.localStorage.getItem("gemini_api_key") || "";
  if (!apiKey) {
    apiKey = window.prompt("Enter Gemini API key:") || "";
  }
  if (!apiKey) {
    // user cancelled
    return;
  }
  window.localStorage.setItem("gemini_api_key", apiKey);

  const app = new OverlayApp();
  await app.initWithApiKey(apiKey);
}

bootstrap();

