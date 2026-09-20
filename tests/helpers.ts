import type { AddressInfo } from "net";
import type { Server } from "http";
import { app } from "../src/app";
import { pool } from "../src/config/db";

export interface Api {
  call: (method: string, path: string, options?: { token?: string; body?: unknown; headers?: Record<string, string> }) => Promise<{ status: number; body: any }>;
  signup: (label?: string) => Promise<{ token: string; siteKey: string; siteId: string; email: string }>;
  close: () => Promise<void>;
}

export async function startApi(): Promise<Api> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  (globalThis as any).__apiPort = port;
  const base = `http://127.0.0.1:${port}`;

  const call: Api["call"] = async (method, path, options = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  };

  const signup: Api["signup"] = async (label = "t") => {
    const email = `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.test`;
    const res = await call("POST", "/api/auth/signup", {
      body: { businessName: `Biz ${label}`, email, password: "secret123", servicesInfo: "Dental care" },
    });
    return { token: res.body.token, siteKey: res.body.site.apiKey, siteId: res.body.site.id, email };
  };

  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool?.end();
  };

  return { call, signup, close };
}
