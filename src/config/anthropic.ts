// config/anthropic.ts — one shared Claude client + a text-completion helper.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { AppError } from "../utils/errors";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new AppError(503, "ai_not_configured", "ANTHROPIC_API_KEY is not set.");
  }
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function completeText(opts: {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
}): Promise<string> {
  const response = await getClient().messages.create({
    model: env.anthropicModel,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
  });
  const block = response.content[0];
  return block && block.type === "text" ? block.text : "";
}
