import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import { createLimiter } from "../src/middleware/rateLimit.middleware";
import { startApi, type Api } from "./helpers";

let api: Api;

before(async () => {
  api = await startApi();
});

after(async () => {
  await api.close();
});

describe("rate limiting", () => {
  it("answers 429 once the window budget is spent", async () => {
    const app = express();
    app.use(createLimiter({ windowMs: 60_000, max: 3 }));
    app.get("/", (_req, res) => res.json({ ok: true }));
    const server = await new Promise<import("http").Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await fetch(url)).status);
    server.close();

    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
  });
});

describe("transport and headers", () => {
  it("sends security headers and hides the framework", async () => {
    const res = await fetch(`http://127.0.0.1:${(await portOf())}/health`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });

  it("only allows configured origins on private routes, any origin on public ones", async () => {
    const evil = { origin: "https://evil.example" };
    const priv = await api.call("GET", "/api/sites/me", { headers: evil });
    assert.equal(priv.status, 401);

    const port = await portOf();
    const privRes = await fetch(`http://127.0.0.1:${port}/api/sites/me`, { headers: evil });
    assert.equal(privRes.headers.get("access-control-allow-origin"), null);

    const pubRes = await fetch(`http://127.0.0.1:${port}/api/public/widget-config?siteKey=x`, { headers: evil });
    assert.equal(pubRes.headers.get("access-control-allow-origin"), "*");
  });
});

describe("auth hardening", () => {
  it("requires passwords of at least 8 characters", async () => {
    const res = await api.call("POST", "/api/auth/signup", { body: { businessName: "X", email: "pw@example.test", password: "1234567" } });
    assert.equal(res.body.error, "weak_password");
  });

  it("issues tokens that expire", async () => {
    const { token } = await api.signup("jwt");
    const payload = jwt.decode(token) as { iat: number; exp: number };
    assert.equal(payload.exp - payload.iat, 7 * 24 * 3600);
  });

  it("does not reveal whether an email exists", async () => {
    const { email } = await api.signup("enum");
    const wrongPassword = await api.call("POST", "/api/auth/login", { body: { email, password: "definitely-wrong" } });
    const unknownUser = await api.call("POST", "/api/auth/login", { body: { email: "ghost@example.test", password: "definitely-wrong" } });
    assert.deepEqual(wrongPassword.body, unknownUser.body);
    assert.equal(wrongPassword.status, unknownUser.status);
  });
});

describe("input limits", () => {
  it("rejects oversize ingest fields and silently drops honeypot posts", async () => {
    const { siteKey, token } = await api.signup("limits");

    const long = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "c".repeat(200) } });
    assert.equal(long.body.error, "contact_too_long");
    const msg = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "c", message: "m".repeat(2001) } });
    assert.equal(msg.body.error, "message_too_long");

    const bot = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "bot@x.co", website: "http://spam.example" } });
    assert.equal(bot.status, 201);
    const leads = await api.call("GET", "/api/leads", { token });
    assert.equal(leads.body.leads.length, 0);
  });

  it("caps bulk imports, blog posts and site settings", async () => {
    const { token, siteId } = await api.signup("caps");

    const rows = Array.from({ length: 1001 }, (_, i) => ({ contact: `c${i}` }));
    const bulk = await api.call("POST", "/api/leads/bulk", { token, body: { leads: rows } });
    assert.equal(bulk.body.error, "too_many_rows");

    const post = await api.call("POST", "/api/blog", { token, body: { title: "t", content: "x".repeat(100_001) } });
    assert.equal(post.body.error, "content_too_long");

    const settings = await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { blob: "x".repeat(20_000) } } });
    assert.equal(settings.body.error, "settings_too_large");

    const offer = await api.call("POST", "/api/offers", { token, body: { title: "x".repeat(201) } });
    assert.equal(offer.body.error, "title_too_long");
  });

  it("rejects oversize and non-xlsx uploads", async () => {
    const { token } = await api.signup("upload");
    const port = await portOf();

    const send = async (name: string, size: number) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(size)]), name);
      return fetch(`http://127.0.0.1:${port}/api/leads/upload-preview`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    };

    const big = await send("leads.xlsx", 6 * 1024 * 1024);
    assert.equal(big.status, 413);
    const wrongType = await send("leads.csv", 10);
    assert.equal(wrongType.status, 400);
  });
});

async function portOf(): Promise<number> {
  const res = await api.call("GET", "/health");
  assert.equal(res.status, 200);
  return (globalThis as any).__apiPort;
}
