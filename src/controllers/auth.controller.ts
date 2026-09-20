// controllers/auth.controller.ts — req/res + input validation only.
// Rule: NO SQL here. Calls services and shapes the JWT response.

import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import * as authService from "../services/auth.service";
import type { AuthUser } from "../types";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest } from "../utils/errors";
import { isNonEmptyString, limitLength, optionalString } from "../utils/validate";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function issueToken(user: AuthUser): string {
  return jwt.sign({ tenantId: user.tenantId, userId: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

/** POST /api/auth/signup — { businessName, email, password, servicesInfo? } */
export const signup = asyncHandler(async (req: Request, res: Response) => {
  const { businessName, email, password, servicesInfo } = req.body ?? {};

  if (!isNonEmptyString(businessName)) throw badRequest("missing_business_name");
  limitLength(businessName, 120, "business_name_too_long");
  if (!isNonEmptyString(email) || email.length > 254 || !EMAIL_RE.test(email.trim())) throw badRequest("invalid_email");
  if (typeof password !== "string" || password.length < 8 || password.length > 72) throw badRequest("weak_password");

  const { user, site } = await authService.signup({
    businessName: businessName.trim(),
    email: email.trim().toLowerCase(),
    password,
    servicesInfo: limitLength(optionalString(servicesInfo), 5000, "services_info_too_long"),
  });
  res.status(201).json({ token: issueToken(user), user, site });
});

/** POST /api/auth/login — { email, password } */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) throw badRequest("missing_credentials");
  if (email.length > 254 || password.length > 72) throw badRequest("invalid_credentials");

  const user = await authService.login({ email: email.trim().toLowerCase(), password });
  res.json({ token: issueToken(user), user });
});
