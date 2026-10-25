// utils/asyncHandler.ts — Express 4 doesn't catch rejected promises, so every
// async controller is wrapped once here and errors flow to error.middleware.

import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncController = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncController): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
