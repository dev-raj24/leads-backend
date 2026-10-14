import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { pool } from "../src/config/db";
import * as gemini from "../src/config/gemini";
import { env } from "../src/config/env";
import { sendHeadsUps } from "../src/services/followup-heads-up.service";
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

describe("heads-up, chat email, data rights, hosted form", () => {
  it("warns the owner before an automatic follow-up and lets them stop it from the email", async () => {
    stubMail();
    mock.method(gemini, "completeText", async () => "Hi.");
    const { token, siteKey, siteId, email } = await api.signup("headsup", { plan: "pro" });
    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { autofollow: true } } });
    await ingest(siteKey, { contact: "wait@x.co", message: "hello there" });
    await settle();
    const leadId = (await api.call("GET", "/api/leads", { token })).body.leads[0].id;
    const created = await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: new Date(Date.now() + 30 * 60_000).toISOString() } });
    sent = [];

    await sendHeadsUps();
    const warning = sent.find((m) => m.to === email && /goes out soon/.test(m.subject));
    assert.ok(warning);
    const link = new URL(warning.text.match(/https?:\/\/\S+followup-skip\S+/)![0]);
    const url = new URL(`${link.pathname}${link.search}`, `http://127.0.0.1:${(globalThis as any).__apiPort}`);

    sent = [];
    await sendHeadsUps();
    assert.equal(sent.filter((m) => /goes out soon/.test(m.subject)).length, 0);

    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url.toString().replace(/.$/, "x"))).status, 400);
    assert.equal((await fetch(url, { method: "POST" })).status, 200);
    const after = await api.call("GET", `/api/leads/${leadId}`, { token });
    assert.equal(after.body.followups.find((f: any) => f.id === created.body.followup.id).status, "cancelled");
  });


  it("exports and erases one person's data and stops further automatic email to them", async () => {
    stubMail();
    mock.method(gemini, "completeText", async () => "Hi.");
    const { token, siteKey } = await api.signup("erase", { plan: "pro" });
    await ingest(siteKey, { name: "Dev", contact: "erase.me@x.co", message: "please help" });
    await settle();
    const other = await api.signup("erase_other");

    const exported = await api.call("GET", "/api/customers/erase.me@x.co/export", { token });
    assert.equal(exported.status, 200);
    assert.equal(exported.body.leads.length, 1);
    assert.ok(exported.body.messages.length >= 1);
    assert.equal((await api.call("GET", "/api/customers/erase.me@x.co/export", { token: other.token })).status, 404);
    assert.equal((await api.call("DELETE", "/api/customers/erase.me@x.co", { token: other.token })).status, 404);

    const erased = await api.call("DELETE", "/api/customers/erase.me@x.co", { token });
    assert.equal(erased.body.removed, 1);
    assert.equal((await api.call("GET", "/api/leads", { token })).body.leads.length, 0);
    assert.equal((await api.call("GET", "/api/customers/erase.me@x.co/export", { token })).status, 404);

    sent = [];
    await ingest(siteKey, { contact: "erase.me@x.co", message: "back again" });
    await settle();
    assert.equal(sent.filter((m) => m.to === "erase.me@x.co").length, 0);
  });

});

describe("blog SEO and public pages", () => {
  it("drafts SEO fields with the post and trims them to search-friendly lengths", async () => {
    mock.method(gemini, "completeText", async () =>
      JSON.stringify({ title: "Braces aftercare", excerpt: "Short.", content: "## Day one\n\nRest.", metaTitle: "x".repeat(90), metaDescription: "y".repeat(300) })
    );
    const { token } = await api.signup("seodraft", { plan: "pro" });
    const res = await api.call("POST", "/api/blog/generate", { token, body: { topic: "Braces aftercare" } });
    assert.ok(res.body.draft.metaTitle.length <= 60);
    assert.ok(res.body.draft.metaDescription.length <= 160);
    mock.restoreAll();
    mock.method(gemini, "completeText", async () => JSON.stringify({ title: "Plain", content: "Body" }));
    const plain = await api.call("POST", "/api/blog/generate", { token, body: { topic: "Plain" } });
    assert.equal(plain.body.draft.metaTitle, "Plain");
  });

  it("serves published posts on public pages with SEO fields, and hides drafts and non-Pro blogs", async () => {
    const { token, siteId } = await api.signup("seopages", { plan: "pro" });
    const slug = (await api.call("GET", "/api/sites/me", { token })).body.site.publicSlug as string;
    assert.match(slug, /^biz-seopages-[0-9a-f]{4}$/);

    await api.call("POST", "/api/blog", { token, body: { title: "Draft", content: "hidden", status: "draft" } });
    const custom = await api.call("POST", "/api/blog", {
      token,
      body: { title: "Root canal cost", content: "Long body text.\n\n## Costs\n\nMore.", excerpt: "What it costs.", status: "published", metaTitle: "Root canal cost in Indore", metaDescription: "A clear price guide." },
    });
    const bare = await api.call("POST", "/api/blog", { token, body: { title: "Whitening tips", content: "Whiten safely at home with these steps.", status: "published" } });
    assert.equal(custom.status, 201);
    assert.equal(bare.status, 201);

    const index = await api.call("GET", `/api/public/blog-site/${slug}`);
    assert.equal(index.body.site.businessName, "Biz seopages");
    assert.deepEqual(index.body.site.posts.map((p: any) => p.title).sort(), ["Root canal cost", "Whitening tips"]);

    const one = await api.call("GET", `/api/public/blog-site/${slug}/root-canal-cost`);
    assert.equal(one.body.post.seoTitle, "Root canal cost in Indore");
    assert.equal(one.body.post.seoDescription, "A clear price guide.");
    const fallback = await api.call("GET", `/api/public/blog-site/${slug}/whitening-tips`);
    assert.equal(fallback.body.post.seoTitle, "Whitening tips");
    assert.match(fallback.body.post.seoDescription, /^Whiten safely at home/);
    assert.equal((await api.call("GET", `/api/public/blog-site/${slug}/draft`)).status, 404);
    assert.equal((await api.call("GET", `/api/public/blog-site/nope-0000`)).status, 404);

    const edited = await api.call("PATCH", `/api/blog/${custom.body.post.id}`, { token, body: { metaTitle: "New SEO title" } });
    assert.equal(edited.body.post.metaTitle, "New SEO title");
    assert.equal((await api.call("POST", "/api/blog", { token, body: { title: "t", content: "c", metaTitle: "x".repeat(71) } })).body.error, "meta_title_too_long");

    await api.call("POST", "/api/billing/cancel", { token });
    assert.equal((await api.call("GET", `/api/public/blog-site/${slug}`)).status, 404);
    assert.equal((await api.call("GET", `/api/public/blog-site/${slug}/root-canal-cost`)).status, 404);
    assert.ok(siteId);
  });
});
