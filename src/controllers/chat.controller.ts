import type { Request, Response } from "express";
import * as aiService from "../services/ai.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

const MAX_TURNS = 30;
const MAX_MESSAGE_CHARS = 4000;

/** POST /api/chat — { messages: [{ role, content }] } -> { reply } */
export const chatWithAgent = asyncHandler(async (req: Request, res: Response) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) throw badRequest("missing_messages");

  const turns = messages
    .filter((m) => isNonEmptyString(m?.content) && m.content.length <= MAX_MESSAGE_CHARS)
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content),
    }));
  if (turns.length === 0) throw badRequest("missing_messages");

  res.json({ reply: await aiService.chat(req.tenantId!, turns) });
});
