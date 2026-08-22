// controllers/auth.controller.ts — req/res + input validation only.
// Rule: NO SQL here. Calls services and shapes the JWT response.

import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { DatabaseNotConfiguredError } from "../config/db";
import * as authService from "../services/auth.service";
import { EmailInUseError, InvalidCredentialsError } from "../services/auth.service";
import type { AuthUser } from "../types";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function issueToken(user: AuthUser): string {
  return jwt.sign({ tenantId: user.tenantId, userId: user.id }, env.jwtSecret, {
    expiresIn: "30d",
  });
}

/** POST /api/auth/signup — { businessName, email, password, servicesInfo? } */
export async function signup(req: Request, res: Response) {
  const body = req.body ?? {};
  const { businessName, email, password, servicesInfo } = body;

  if (!isNonEmptyString(businessName)) {
    return res.status(400).json({ error: "missing_business_name" });
  }
  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: "missing_email" });
  }
  if (!isNonEmptyString(password) || password.length < 6) {
    return res.status(400).json({ error: "weak_password" });
  }

  try {
    const { user, site } = await authService.signup({
      businessName,
      email,
      password,
      servicesInfo: isNonEmptyString(servicesInfo) ? servicesInfo : undefined,
    });
    const token = issueToken(user);
    return res.status(201).json({ token, user, site });
  } catch (err) {
    return handleError(res, err, "auth.controller.signup");
  }
}

/** POST /api/auth/login — { email, password } */
export async function login(req: Request, res: Response) {
  const body = req.body ?? {};
  const { email, password } = body;

  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  try {
    const user = await authService.login({ email, password });
    const token = issueToken(user);
    return res.json({ token, user });
  } catch (err) {
    return handleError(res, err, "auth.controller.login");
  }
}

function handleError(res: Response, err: unknown, where: string) {
  if (err instanceof EmailInUseError) {
    return res.status(409).json({ error: "email_in_use" });
  }
  if (err instanceof InvalidCredentialsError) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  if (err instanceof DatabaseNotConfiguredError) {
    return res.status(503).json({ error: "database_not_configured", detail: err.message });
  }
  console.error(`[${where}]`, err);
  return res.status(500).json({ error: "internal_error" });
}
