// Gemini text generation via REST (request/response).
export class GeminiTextClient {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    // Apply user's default model directly
    this.model = model || "gemini-3.1-flash-lite-preview";
  }

  async *streamGenerateText(prompt, base64Image = null) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model,
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;

    const parts = [];
    if (base64Image) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      });
    }
    parts.push({ text: trimmed });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini streamGenerateContent failed: ${res.status} ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep last incomplete line

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          if (!dataStr || dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            const textChunk = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textChunk) {
              yield textChunk;
            }
          } catch (e) {
            console.error("Gemini SSE parse error", e, dataStr);
          }
        }
      }
    }
  }
}

