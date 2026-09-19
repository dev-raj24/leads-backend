// services/chat.service.ts — the portal's AI co-pilot.
import { completeText, type ChatTurn } from "../config/anthropic";

const SYSTEM_PROMPT =
  "You are an AI co-pilot for a lead generation and CRM application called Leadworks. " +
  "You help users manage leads, draft replies, and summarize data. " +
  "Be concise, helpful, and professional. Use emojis sparingly.";

export async function reply(messages: ChatTurn[]): Promise<string> {
  const text = await completeText({ system: SYSTEM_PROMPT, messages, maxTokens: 1024 });
  return text || "Sorry, I couldn't process that.";
}
