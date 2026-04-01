import { OverlayApp } from "./overlay-ui.js";
import { invoke } from "https://esm.sh/@tauri-apps/api/core";

async function bootstrap() {
  const keys = await invoke("get_api_keys").catch(() => ({}));
  let apiKey = keys.gemini || window.localStorage.getItem("gemini_api_key") || "";
  
  if (!apiKey) {
    apiKey = window.prompt("Enter Gemini API key:") || "";
  }
  if (!apiKey) {
    // user cancelled
    return;
  }
  window.localStorage.setItem("gemini_api_key", apiKey);

  const app = new OverlayApp();
  app.envKeys = keys;
  await app.initWithApiKey(apiKey);
}

bootstrap();

