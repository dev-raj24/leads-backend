import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { AppError } from "../utils/errors";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json(err.status >= 500 ? { error: err.code, detail: err.message } : { error: err.code });
  }
  if (err instanceof MulterError) {
    const tooLarge = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "file_too_large" : "invalid_upload" });
  }
  const type = (err as { type?: string })?.type;
  if (type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json" });
  if (type === "entity.too.large") return res.status(413).json({ error: "payload_too_large" });

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({ error: "internal_error" });
}
