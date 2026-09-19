import type { Request, Response } from "express";
import * as chatService from "../services/chat.service";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString } from "../utils/validate";

const MAX_TURNS = 30;

/** POST /api/chat — { messages: [{ role, content }] } -> { reply } */
export const chatWithAgent = asyncHandler(async (req: Request, res: Response) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) throw badRequest("missing_messages");

  const turns = messages
    .filter((m) => isNonEmptyString(m?.content))
    .slice(-MAX_TURNS)
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: String(m.content),
    }));
  if (turns.length === 0) throw badRequest("missing_messages");

  res.json({ reply: await chatService.reply(turns) });
});
