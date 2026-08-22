import { Request, Response } from "express";
import Anthropic from "@anthropic-ai/sdk";

export const chatWithAgent = async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || "dummy", // defaults to process.env.ANTHROPIC_API_KEY
    });

   
    const systemPrompt = `You are an AI co-pilot for a lead generation and CRM application called Leadworks. 
You help users manage leads, draft replies, and summarize data.
Be concise, helpful, and professional. Use emojis sparingly.`;

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "Sorry, I couldn't process that.";

    res.json({ reply });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to process chat message" });
  }
};
