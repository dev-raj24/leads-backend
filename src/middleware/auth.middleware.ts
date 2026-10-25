// middleware/auth.middleware.ts — verifies the JWT issued at login/signup,
// checks it has not been revoked, and attaches { tenantId, userId } to the request.
// Every route that reads or writes tenant data sits behind this, so
// controllers can rely on `req.tenantId` being set.

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { currentTokenVersion } from "../services/session.service";

interface TokenPayload {
  tenantId: string;
  userId: string;
  tv?: number;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return res.status(401).json({ error: "missing_token" });

  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as Partial<TokenPayload>;
    if (!payload.tenantId || !payload.userId) {
      return res.status(401).json({ error: "invalid_token" });
    }
    const live = await currentTokenVersion(payload.userId, payload.tenantId);
    if (live === null || live !== (payload.tv ?? 0)) return res.status(401).json({ error: "invalid_token" });

    req.tenantId = payload.tenantId;
    req.userId = payload.userId;
    return next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err instanceof jwt.NotBeforeError) {
      return res.status(401).json({ error: "invalid_token" });
    }
    return next(err);
  }
}
