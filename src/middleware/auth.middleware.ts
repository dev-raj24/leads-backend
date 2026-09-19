// middleware/auth.middleware.ts — verifies the JWT issued at login/signup
// and attaches { tenantId, userId } to the request. Every route that reads
// or writes tenant data (leads, sites, offers, ...) sits behind this, so
// controllers can rely on `req.tenantId` being set.

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

interface TokenPayload {
  tenantId: string;
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return res.status(401).json({ error: "missing_token" });

  try {
    const payload = jwt.verify(token, env.jwtSecret) as Partial<TokenPayload>;
    if (!payload.tenantId || !payload.userId) {
      return res.status(401).json({ error: "invalid_token" });
    }
    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
