// config/gemini.ts — one shared Gemini text-completion helper (REST, no SDK needed).
import { env } from "./env";
import { AppError } from "../utils/errors";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
}

export async function completeText(opts: {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
}): Promise<string> {
  if (!env.geminiApiKey) {
    throw new AppError(503, "ai_not_configured", "GEMINI_API_KEY is not set.");
  }

  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    // thinkingBudget: 0 — these are short, latency-sensitive replies; thinking tokens
    // would otherwise eat the whole maxOutputTokens budget before any visible text comes out.
    generationConfig: { maxOutputTokens: opts.maxTokens, thinkingConfig: { thinkingBudget: 0 } },
  };

  const response = await fetch(`${API_BASE}/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  }).catch((err) => {
    console.error("[gemini]", err instanceof Error ? err.message : err);
    throw new AppError(502, "ai_unavailable");
  });

  if (!response.ok) {
    console.error("[gemini]", response.status, await response.text().catch(() => ""));
    throw new AppError(502, "ai_unavailable");
  }

  const data = (await response.json()) as GeminiResponse;
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");

  // This model's "thinking" tokens count against maxOutputTokens even with thinkingBudget: 0,
  // and the spend is unpredictable — if the budget ran out before the reply finished, the text
  // (if any) is a mid-sentence cut-off. Never send that to a customer; fail like the AI was down.
  if (candidate?.finishReason === "MAX_TOKENS") {
    console.error("[gemini] hit MAX_TOKENS before finishing — reply would be cut off");
    throw new AppError(502, "ai_unavailable");
  }

  return text;
}
