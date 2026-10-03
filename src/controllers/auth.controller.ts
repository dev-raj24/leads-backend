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

  const { user, site, tenant } = await authService.signup({
    businessName: businessName.trim(),
    email: email.trim().toLowerCase(),
    password,
    servicesInfo: limitLength(optionalString(servicesInfo), 5000, "services_info_too_long"),
  });
  res.status(201).json({ token: issueToken(user), user, site, tenant });
});

/** POST /api/auth/login — { email, password } */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!isNonEmptyString(email) || !isNonEmptyString(password)) throw badRequest("missing_credentials");
  if (email.length > 254 || password.length > 72) throw badRequest("invalid_credentials");

  const { user, tenant } = await authService.login({ email: email.trim().toLowerCase(), password });
  res.json({ token: issueToken(user), user, tenant });
});

/** POST /api/auth/forgot-password — { email } — always 200, never reveals whether the email exists. */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (!isNonEmptyString(email) || email.length > 254 || !EMAIL_RE.test(email.trim())) throw badRequest("invalid_email");

  await authService.requestPasswordReset(email.trim().toLowerCase());
  res.json({ ok: true });
});

/** POST /api/auth/reset-password — { token, password } */
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body ?? {};
  if (!isNonEmptyString(token)) throw badRequest("missing_token");
  if (typeof password !== "string" || password.length < 8 || password.length > 72) throw badRequest("weak_password");

  await authService.resetPassword(token, password);
  res.json({ ok: true });
});

/** PATCH /api/auth/password — { currentPassword, newPassword } (signed in) */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!isNonEmptyString(currentPassword)) throw badRequest("missing_current_password");
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 72) throw badRequest("weak_password");

  await authService.changePassword(req.userId!, currentPassword, newPassword);
  res.json({ ok: true });
});

/** PATCH /api/auth/email — { newEmail, currentPassword } (signed in) */
export const changeEmail = asyncHandler(async (req: Request, res: Response) => {
  const { newEmail, currentPassword } = req.body ?? {};
  if (!isNonEmptyString(newEmail) || newEmail.length > 254 || !EMAIL_RE.test(newEmail.trim())) throw badRequest("invalid_email");
  if (!isNonEmptyString(currentPassword)) throw badRequest("missing_current_password");

  const user = await authService.changeEmail(req.userId!, newEmail.trim().toLowerCase(), currentPassword);
  res.json({ user });
});

/** POST /api/auth/verify-email — { token } */
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body ?? {};
  if (!isNonEmptyString(token)) throw badRequest("missing_token");
  res.json({ user: await authService.verifyEmail(token) });
});

/** POST /api/auth/resend-verification (signed in) */
export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  await authService.resendVerification(req.userId!);
  res.json({ ok: true });
});

/** GET /api/auth/me (signed in) */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const found = await authService.getUser(req.userId!);
  if (!found) return res.status(401).json({ error: "invalid_token" });
  res.json(found);
});
