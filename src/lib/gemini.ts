import { env } from "../config/env.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callGeminiWithFallback(promptText: string): Promise<string> {
  const modelsToTry = [
    env.GEMINI_MODEL
  ].filter(Boolean) as string[];

  let lastError = "";
  const maxRetries = 6;
  const initialDelayMs = 60000;

  for (const model of modelsToTry) {
    const cleanModelName = model.includes("/") ? model : `models/${model}`;
    const endpoint = `https://generativelanguage.googleapis.com/v1/${cleanModelName}:generateContent`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`🤖 [Gemini Client] Attempting generation with model: "${cleanModelName}" (Attempt ${attempt}/${maxRetries})...`);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-goog-api-key": env.GEMINI_API_KEY ?? ""
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptText }] }]
          })
        });

        if (response.ok) {
          const body = (await response.json()) as any;
          const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            console.log(`   ✅ Success! Model "${cleanModelName}" responded successfully.`);
            return text;
          }
        }

        const errText = await response.text();
        console.warn(`   ⚠️ Model "${cleanModelName}" failed with status ${response.status} on attempt ${attempt}:`, errText);
        lastError = `Status ${response.status}: ${errText}`;

        // Retry only on transient errors: 503 (unavailable), 429 (rate limit), or other 5xx issues
        const isTransient = response.status === 503 || response.status === 429 || (response.status >= 500 && response.status < 600);
        if (!isTransient) {
          // Break immediately on permanent errors (e.g. 400 Bad Request, 403 Invalid API Key)
          break;
        }
      } catch (err: any) {
        console.warn(`   ⚠️ Model "${cleanModelName}" threw network error on attempt ${attempt}:`, err.message || err);
        lastError = err.message || err;
      }

      if (attempt < maxRetries) {
        // Calculate delay: initialDelay * 2^(attempt-1) + up to 500ms of randomized jitter
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500;
        const totalDelay = delay + jitter;

        console.warn(`   ⏳ [Transient Error] Backing off for ${(totalDelay / 1000).toFixed(2)}s before next retry...`);
        await sleep(totalDelay);
      }
    }

    // Small delay before trying fallback model if multiple models were listed
    await sleep(500);
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}
