// middleware/error.middleware.ts — the ONE place errors become HTTP responses.

import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/errors";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

// Express identifies error middleware by its 4-argument signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    // Only infrastructure problems (5xx) carry a human-readable detail.
    return res.status(err.status).json(err.status >= 500 ? { error: err.code, detail: err.message } : { error: err.code });
  }
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid_json" });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({ error: "internal_error" });
}
