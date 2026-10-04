import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { pool } from "../src/config/db";
import * as gemini from "../src/config/gemini";
import { env } from "../src/config/env";
import * as mailer from "../src/services/mailer.service";
import { startApi, type Api } from "./helpers";

let api: Api;
let sent: Array<{ to: string; subject: string; text: string; replyTo?: string }> = [];

const stubMail = () => {
  mock.method(mailer, "isMailConfigured", () => true);
  mock.method(mailer, "sendMail", async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  });
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
const ingest = (siteKey: string, body: Record<string, unknown>) => api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, ...body } });
const inbound = (payload: unknown, secret = "inbound-secret") =>
  fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/inbound-email`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-inbound-secret": secret },
    body: JSON.stringify(payload),
  });

const savedDomain = env.inboundEmailDomain;
const savedSecret = env.inboundEmailSecret;

before(async () => {
  env.geminiApiKey = "test-key";
  env.inboundEmailDomain = "inbound.example.test";
  env.inboundEmailSecret = "inbound-secret";
  api = await startApi();
});
after(async () => {
  env.inboundEmailDomain = savedDomain;
  env.inboundEmailSecret = savedSecret;
  await api.close();
});
afterEach(() => {
  mock.restoreAll();
  sent = [];
});

describe("replies land in the portal", () => {
  it("sends mail with a reply address that routes the answer back into the lead's thread", async () => {
    stubMail();
    mock.method(gemini, "completeText", async () => "Thanks, we can help.");
    const { token, siteKey, email } = await api.signup("inb", { plan: "pro" });
    await ingest(siteKey, { name: "Kiran", contact: "kiran@x.co", message: "Need info please" });
    await settle();
    const auto = sent.find((m) => m.to === "kiran@x.co");
    assert.ok(auto);
    assert.match(auto.replyTo ?? "", /^reply\+[0-9a-f-]{36}\.[0-9a-f]{16}@inbound\.example\.test$/);
    assert.ok(email);

    const leadId = (await api.call("GET", "/api/leads", { token })).body.leads[0].id;
    await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: new Date(Date.now() + 3600_000).toISOString() } });

    const to = auto.replyTo!;
    const body = {
      From: "Kiran <KIRAN@x.co>",
      To: to,
      Subject: "Re: Thanks for your enquiry",
      TextBody: "Yes, 5 PM works for me.\n\nOn Sat, 3 Oct 2026 at 10:00, Clinic wrote:\n> Thanks, we can help.\n> Don't want these messages?",
      MessageID: "<abc@mail.x.co>",
    };
    sent = [];
    const res = await inbound(body);
    assert.equal(((await res.json()) as any).result, "stored");
    await settle();

    const detail = await api.call("GET", `/api/leads/${leadId}`, { token });
    const last = detail.body.messages[detail.body.messages.length - 1];
    assert.equal(last.direction, "inbound");
    assert.equal(last.channel, "email");
    assert.equal(last.body, "Yes, 5 PM works for me.");
    assert.ok(detail.body.events.some((e: any) => e.type === "customer_replied"));
    assert.ok(detail.body.followups.every((f: any) => f.status === "cancelled"));
    assert.ok(sent.some((m) => m.to === email && /replied/.test(m.subject)));

    const again = await inbound(body);
    assert.equal(((await again.json()) as any).result, "duplicate");

    const list = await api.call("GET", "/api/leads", { token });
    assert.equal(list.body.leads[0].lastMessage.direction, "inbound");
  });

  it("refuses wrong secrets, forged addresses and mail from someone else", async () => {
    stubMail();
    mock.method(gemini, "completeText", async () => "Hi.");
    const { token, siteKey } = await api.signup("inb_bad", { plan: "pro" });
    await ingest(siteKey, { contact: "real@x.co", message: "hello there" });
    await settle();
    const to = sent.find((m) => m.to === "real@x.co")!.replyTo!;
    const leadId = (await api.call("GET", "/api/leads", { token })).body.leads[0].id;

    assert.equal((await inbound({ From: "real@x.co", To: to, TextBody: "hi" }, "wrong")).status, 401);
    const forged = await inbound({ From: "real@x.co", To: to.replace(/\.[0-9a-f]{16}@/, ".0000000000000000@"), TextBody: "hi" });
    assert.equal(((await forged.json()) as any).result, "unknown_lead");
    const stranger = await inbound({ From: "stranger@evil.test", To: to, TextBody: "pay me" });
    assert.equal(((await stranger.json()) as any).result, "sender_mismatch");
    const auto = await inbound({ From: "real@x.co", To: to, Subject: "Automatic reply: away", TextBody: "I am away" });
    assert.equal(((await auto.json()) as any).result, "ignored");

    const detail = await api.call("GET", `/api/leads/${leadId}`, { token });
    assert.ok(detail.body.messages.every((m: any) => m.direction !== "inbound" || m.channel !== "email"));
  });
});

describe("lead list and forms", () => {
  it("shows the last message and the next follow-up on each lead", async () => {
    mock.method(gemini, "completeText", async () => "x");
    const { token, siteKey } = await api.signup("listinfo");
    await ingest(siteKey, { contact: "list@x.co", message: "first question" });
    const row = (await api.call("GET", "/api/leads", { token })).body.leads[0];
    assert.equal(row.lastMessage.body, "first question");
    assert.equal(row.lastMessage.direction, "inbound");
    assert.equal(row.nextFollowup.status, "pending");
  });

  it("collects the owner's custom form fields, validates them, and publishes them to the script", async () => {
    const { token, siteKey, siteId } = await api.signup("formfields");
    const saved = await api.call("PATCH", `/api/sites/${siteId}/settings`, {
      token,
      body: { settings: { leadFields: [{ name: "Service", required: true, options: ["Braces", "Whitening", "Braces"] }, { name: "Budget" }, { name: "service" }] } },
    });
    assert.deepEqual(saved.body.site.settings.leadFields, [
      { name: "Service", required: true, options: ["Braces", "Whitening"] },
      { name: "Budget", required: false, options: [] },
    ]);

    const config = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(config.body.form.fields.length, 2);

    assert.equal((await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: {} })).body.error, "missing_field");
    assert.equal((await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: { Service: "Surgery" } })).body.error, "invalid_field");
    const ok = await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: { Service: "Braces", Budget: "20000", Hacker: "x" } });
    assert.equal(ok.status, 201);
    const lead = (await api.call("GET", "/api/leads", { token })).body.leads[0];
    assert.deepEqual(lead.customFields, { Service: "Braces", Budget: "20000" });
  });

  it("stores the extra answers captured from a site's own form, minus anything sensitive", async () => {
    const { token, siteKey } = await api.signup("extras");
    const res = await ingest(siteKey, {
      contact: "own@x.co",
      message: "from my own form",
      extras: { "PHONE NUMBER": "+1 555 123 4567", Company: "NRG", password: "hunter2", "Card number": "4111", Service: "LTL" },
    });
    assert.equal(res.status, 201);
    const lead = (await api.call("GET", "/api/leads", { token })).body.leads[0];
    assert.deepEqual(lead.customFields, { "PHONE NUMBER": "+1 555 123 4567", Company: "NRG", Service: "LTL" });

    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`q${i}`, "v"]));
    await ingest(siteKey, { contact: "own2@x.co", message: "many", extras: many });
    const second = (await api.call("GET", "/api/leads", { token })).body.leads.find((l: any) => l.contact === "own2@x.co");
    assert.equal(Object.keys(second.customFields).length, 12);
  });

  it("keeps chat and blog for paying accounts only, while forms stay free", async () => {
    const { token, siteKey } = await api.signup("gate");
    const blocked = await api.call("POST", "/api/blog", { token, body: { title: "Nope", content: "x" } });
    assert.equal(blocked.status, 403);
    const config = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(config.body.blog.enabled, false);
    assert.equal(config.body.chat.enabled, false);
    assert.equal((await ingest(siteKey, { contact: "free@x.co", message: "form works on free" })).status, 201);

    await api.call("PATCH", "/api/tenant/plan", { token, body: { plan: "pro" } });
    await api.call("POST", "/api/blog", { token, body: { title: "Live", content: "x", status: "published" } });
    assert.equal((await api.call("GET", `/api/public/blog?siteKey=${siteKey}`)).body.posts.length, 1);
    await api.call("POST", "/api/billing/cancel", { token });
    assert.equal((await api.call("GET", `/api/public/blog?siteKey=${siteKey}`)).body.posts.length, 0);
    assert.equal((await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`)).body.blog.enabled, false);
  });
});

describe("account security", () => {
  it("locks a login after repeated wrong passwords, even for the right one", async () => {
    const { email } = await api.signup("lock");
    for (let i = 0; i < 8; i++) {
      const res = await api.call("POST", "/api/auth/login", { body: { email, password: "wrong-password-" + i } });
      assert.equal(res.status, 401);
    }
    const locked = await api.call("POST", "/api/auth/login", { body: { email, password: "secret123" } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error, "too_many_attempts");
  });

  it("signs old sessions out when the password changes or on 'log out everywhere'", async () => {
    const { token, email } = await api.signup("revoke");
    const second = (await api.call("POST", "/api/auth/login", { body: { email, password: "secret123" } })).body.token;
    assert.equal((await api.call("GET", "/api/auth/me", { token: second })).status, 200);

    const out = await api.call("POST", "/api/auth/logout-all", { token });
    assert.equal(out.status, 200);
    assert.equal((await api.call("GET", "/api/auth/me", { token: second })).status, 401);
    assert.equal((await api.call("GET", "/api/auth/me", { token })).status, 401);
    assert.equal((await api.call("GET", "/api/auth/me", { token: out.body.token })).status, 200);

    const changed = await api.call("PATCH", "/api/auth/password", { token: out.body.token, body: { currentPassword: "secret123", newPassword: "a-much-better-pass-9" } });
    assert.equal(changed.status, 200);
    assert.equal((await api.call("GET", "/api/auth/me", { token: out.body.token })).status, 401);
    assert.equal((await api.call("GET", "/api/auth/me", { token: changed.body.token })).status, 200);
  });

  it("rejects obvious passwords and passwords built from the email", async () => {
    const email = `weak_${Date.now()}@example.test`;
    for (const password of ["password123", "11111111", `${email.split("@")[0]}99`]) {
      const res = await api.call("POST", "/api/auth/signup", { body: { businessName: "Weak", email, password } });
      assert.equal(res.body.error, "weak_password", password);
    }
  });

  it("caps public request bodies and never lets the browser cache API answers", async () => {
    const { siteKey } = await api.signup("caps");
    const big = await ingest(siteKey, { contact: "big@x.co", message: "x".repeat(40_000) });
    assert.equal(big.status, 413);
    const res = await fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("keeps every table tenant-isolated for the new lead data", async () => {
    const a = await api.signup("iso_a");
    const b = await api.signup("iso_b");
    await ingest(a.siteKey, { contact: "iso@x.co", message: "secret enquiry" });
    const id = (await api.call("GET", "/api/leads", { token: a.token })).body.leads[0].id;
    assert.equal((await api.call("GET", `/api/leads/${id}`, { token: b.token })).status, 404);
    assert.equal((await api.call("GET", "/api/leads", { token: b.token })).body.leads.length, 0);
    assert.ok(pool);
  });
});
