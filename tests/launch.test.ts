import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { pool } from "../src/config/db";
import * as gemini from "../src/config/gemini";
import { env } from "../src/config/env";
import * as mailer from "../src/services/mailer.service";
import { startApi, type Api } from "./helpers";

let api: Api;
let sent: Array<{ to: string; subject: string; text: string; headers?: Record<string, string>; replyTo?: string }> = [];

const stubMail = () => {
  mock.method(mailer, "isMailConfigured", () => true);
  mock.method(mailer, "sendMail", async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  });
};
const stubAi = (reply = "Happy to help.") => mock.method(gemini, "completeText", async () => reply);
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
const ingest = (siteKey: string, body: Record<string, unknown>, headers?: Record<string, string>) =>
  api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, ...body }, headers });

before(async () => {
  env.geminiApiKey = "test-key";
  api = await startApi();
});
after(async () => {
  await api.close();
});
afterEach(() => {
  mock.restoreAll();
  sent = [];
});

describe("lead intake rules", () => {
  it("treats a double submit as one lead", async () => {
    const { token, siteKey } = await api.signup("dup");
    const a = await ingest(siteKey, { contact: "dup@x.co", message: "hello" });
    const b = await ingest(siteKey, { contact: "DUP@x.co ", message: "hello" });
    assert.equal(a.body.id, b.body.id);
    assert.equal(b.body.duplicate, true);
    assert.equal((await api.call("GET", "/api/leads", { token })).body.leads.length, 1);
  });

  it("matches the same phone number written three different ways", async () => {
    const { token, siteKey } = await api.signup("phones");
    await ingest(siteKey, { contact: "98765 43210", message: "a" });
    await ingest(siteKey, { contact: "+91 98765 43210", message: "b" });
    await ingest(siteKey, { contact: "098765-43210", message: "c" });
    const customers = await api.call("GET", "/api/customers", { token });
    assert.equal(customers.body.customers.length, 1);
    assert.equal(customers.body.customers[0].leadCount, 3);
  });

  it("keeps saving leads past the free monthly limit but pauses automation", async () => {
    stubAi();
    const { token, siteKey, email } = await api.signup("limit");
    await pool!.query(
      `insert into leads (tenant_id, contact, contact_key, source, status)
       select u.tenant_id, 'seed' || g || '@x.co', 'seed' || g || '@x.co', 'form', 'new'
       from users u, generate_series(1, 50) g where u.email = $1`,
      [email]
    );
    const over = await ingest(siteKey, { contact: "over@x.co", message: "still me" });
    assert.equal(over.status, 201);
    const leads = await api.call("GET", "/api/leads", { token });
    assert.equal(leads.body.leads.length, 51);
    const detail = await api.call("GET", `/api/leads/${leads.body.leads[0].id}`, { token });
    assert.ok(detail.status === 200);
    const followups = await api.call("GET", "/api/followups", { token });
    assert.equal(followups.body.followups.filter((f: any) => f.leadContact === "over@x.co").length, 0);
    const billing = await api.call("GET", "/api/billing", { token });
    assert.equal(billing.body.usage.overLimit, true);
  });
});

describe("automatic email safety", () => {
  it("adds a working stop link, honours it, and never replies to automated addresses", async () => {
    stubMail();
    stubAi("Thanks for writing.");
    const { siteKey } = await api.signup("unsub", { plan: "pro" });

    await ingest(siteKey, { contact: "person@x.co", message: "hello there" });
    await settle();
    const mail = sent.find((m) => m.to === "person@x.co")!;
    assert.ok(mail);
    assert.ok(mail.headers?.["List-Unsubscribe"]);
    const found = new URL(mail.text.match(/https?:\/\/\S+unsubscribe\S+/)![0]);
    const url = new URL(`${found.pathname}${found.search}`, `http://127.0.0.1:${(globalThis as any).__apiPort}`);

    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Stop these emails|Yes, stop them/);
    const done = await fetch(url, { method: "POST" });
    assert.equal(done.status, 200);

    sent = [];
    await ingest(siteKey, { contact: "person@x.co", message: "second message" });
    await settle();
    assert.equal(sent.filter((m) => m.to === "person@x.co").length, 0);

    await ingest(siteKey, { contact: "no-reply@x.co", message: "auto" });
    await settle();
    assert.equal(sent.filter((m) => m.to === "no-reply@x.co").length, 0);

    const bad = await fetch(url.toString().replace(/.$/, "x"));
    assert.equal(bad.status, 400);
  });

  it("sends at most one automatic reply per person per day", async () => {
    stubMail();
    stubAi("Reply one.");
    const { siteKey } = await api.signup("daily", { plan: "pro" });
    await ingest(siteKey, { contact: "twice@x.co", message: "first" });
    await settle();
    await ingest(siteKey, { contact: "twice@x.co", message: "second, different enough" });
    await settle();
    assert.equal(sent.filter((m) => m.to === "twice@x.co").length, 1);
  });

  it("does not send follow-ups at night when quiet hours are on", async () => {
    stubMail();
    stubAi("Checking in.");
    const { token, siteKey, siteId } = await api.signup("quiet", { plan: "pro" });
    
    const zones = ["Pacific/Auckland", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Tokyo", "Pacific/Honolulu", "UTC"];
    let nightZone = "UTC";
    for (const z of zones) {
      const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: z }).format(new Date()));
      if (h < 9 || h > 19) {
        nightZone = z;
        break;
      }
    }
    const nowHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: nightZone }).format(new Date()));
    if (nowHour >= 9 && nowHour <= 19) return;

    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { autofollow: true, timezone: nightZone } } });
    await ingest(siteKey, { contact: "night@x.co", message: "hi" });
    const id = (await api.call("GET", "/api/leads", { token })).body.leads[0].id;
    await api.call("POST", `/api/leads/${id}/followups`, { token, body: { runAt: new Date(Date.now() - 1000).toISOString() } });
    sent = [];
    const { claimDueFollowups } = await import("../src/services/followup.service");
    assert.equal((await claimDueFollowups(10, true)).filter((c) => c.leadId === id).length, 0);
  });
});

describe("chat and leads stay separate", () => {
  async function proWithChat(label: string) {
    const acct = await api.signup(label, { plan: "pro" });
    await api.call("PATCH", `/api/sites/${acct.siteId}/settings`, { token: acct.token, body: { settings: { widget: true } } });
    await api.call("PUT", "/api/ai-config", { token: acct.token, body: { about: "A neighbourhood dental clinic." } });
    return acct;
  }

  it("keeps an anonymous chat out of Leads, then promotes it when contact details are shared", async () => {
    stubMail();
    stubAi("We open at 10.");
    const { token, siteKey, email } = await proWithChat("chatsplit");

    const start = await api.call("POST", "/api/public/chat/start", { body: { siteKey, message: "What are your timings?" } });
    assert.equal(start.status, 201);
    await settle();
    assert.equal((await api.call("GET", "/api/leads", { token })).body.leads.length, 0);
    assert.equal((await api.call("GET", "/api/stats/overview", { token })).body.stats.totals.leads, 0);
    const convos = await api.call("GET", "/api/chat-widget/conversations", { token });
    assert.equal(convos.body.conversations.length, 1);
    assert.equal(convos.body.conversations[0].isLead, false);
    assert.equal(convos.body.conversations[0].contact, null);
    assert.ok(sent.some((m) => m.to === email && /New chat/.test(m.subject)));
    assert.ok(!sent.some((m) => /New lead/.test(m.subject)));

    sent = [];
    const next = await api.call("POST", `/api/public/chat/${start.body.leadId}/message`, {
      body: { siteKey, message: "Book me please, my number is 98765 43210" },
    });
    assert.equal(next.status, 200);
    await settle();
    const leads = await api.call("GET", "/api/leads", { token });
    assert.equal(leads.body.leads.length, 1);
    assert.equal(leads.body.leads[0].source, "chat_widget");
    assert.ok(sent.some((m) => m.to === email && /New lead/.test(m.subject)));
    assert.equal((await api.call("GET", "/api/chat-widget/conversations", { token })).body.conversations[0].isLead, true);
  });

  it("creates a lead straight away when the first message already has an email", async () => {
    stubAi("Sure.");
    const { token, siteKey } = await proWithChat("chatemail");
    await api.call("POST", "/api/public/chat/start", { body: { siteKey, message: "Hi, reach me at kiran@x.co" } });
    const leads = await api.call("GET", "/api/leads", { token });
    assert.equal(leads.body.leads.length, 1);
    assert.equal(leads.body.leads[0].contact, "kiran@x.co");
  });
});

describe("script safety", () => {
  it("records that the script is installed, and refuses and reports unlisted domains", async () => {
    const { token, siteKey, siteId } = await api.signup("domains");
    assert.equal((await api.call("GET", "/api/sites/me/install", { token })).body.status.installed, false);

    await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`, { headers: { origin: "https://www.shop.test" } });
    await settle();
    const seen = await api.call("GET", "/api/sites/me/install", { token });
    assert.equal(seen.body.status.installed, true);
    assert.equal(seen.body.status.lastSeenHost, "shop.test");

    const save = await api.call("PATCH", `/api/sites/${siteId}/settings`, {
      token,
      body: { settings: { allowedDomains: ["https://Shop.test/contact", "junk value", "other.in"] } },
    });
    assert.deepEqual(save.body.site.settings.allowedDomains, ["shop.test", "other.in"]);

    const ok = await ingest(siteKey, { contact: "ok@x.co", message: "from the right site" }, { origin: "https://blog.shop.test" });
    assert.equal(ok.status, 201);
    const blocked = await ingest(siteKey, { contact: "bad@x.co", message: "copied script" }, { origin: "https://evil.example" });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, "domain_not_allowed");
    const noOrigin = await ingest(siteKey, { contact: "api@x.co", message: "server to server" });
    assert.equal(noOrigin.status, 201);

    await settle();
    const status = await api.call("GET", "/api/sites/me/install", { token });
    assert.equal(status.body.status.blocked[0].host, "evil.example");
    assert.equal((await api.call("GET", "/api/leads", { token })).body.leads.length, 2);
  });
});

describe("email verification", () => {
  it("emails a link at signup, verifies once, and holds alerts back until then", async () => {
    stubMail();
    stubAi("Hi.");
    const { token, siteKey, email } = await api.signup("verify", { verified: false });
    await settle();
    const verifyMail = sent.find((m) => m.to === email && /Confirm your email/.test(m.subject));
    assert.ok(verifyMail);

    await ingest(siteKey, { contact: "early@x.co", message: "before verifying" });
    await settle();
    assert.ok(!sent.some((m) => m.to === email && /New lead/.test(m.subject)));
    assert.equal((await api.call("GET", "/api/auth/me", { token })).body.user.emailVerified, false);

    const link = new URL(verifyMail!.text.match(/https?:\/\/\S+/)![0]);
    const token2 = link.searchParams.get("token")!;
    const first = await api.call("POST", "/api/auth/verify-email", { body: { token: token2 } });
    assert.equal(first.status, 200);
    assert.equal(first.body.user.emailVerified, true);
    assert.equal((await api.call("POST", "/api/auth/verify-email", { body: { token: token2 } })).status, 400);
    assert.equal((await api.call("GET", "/api/auth/me", { token })).body.user.emailVerified, true);

    sent = [];
    await ingest(siteKey, { contact: "later@x.co", message: "after verifying" });
    await settle();
    assert.ok(sent.some((m) => m.to === email && /New lead/.test(m.subject)));
  });
});

describe("plans and billing", () => {
  it("only lets a tenant reach Pro through billing when payments are configured, and hides locked parts after a downgrade", async () => {
    const { token, siteKey } = await api.signup("billing");
    const overview = await api.call("GET", "/api/billing", { token });
    assert.equal(overview.body.plan, "free");
    assert.equal(overview.body.usage.leadsLimit, 50);

    await api.call("PATCH", "/api/tenant/plan", { token, body: { plan: "pro" } });
    const offer = await api.call("POST", "/api/offers", { token, body: { title: "Sale", active: true, body: JSON.stringify({ displayMode: "bottom-left", actionType: "link", targetUrl: "https://x.test" }) } });
    assert.equal(offer.status, 201);
    const live = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.ok(live.body.offer);

    const cancelled = await api.call("POST", "/api/billing/cancel", { token });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.plan, "free");
    const after = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(after.body.offer, null);
    assert.equal((await api.call("GET", "/api/offers", { token })).body.offers.length, 1);
  });

  it("verifies webhook signatures and applies each event only once", async () => {
    const { token, email } = await api.signup("hook");
    const tenantId = (await pool!.query(`select tenant_id from users where email = $1`, [email])).rows[0].tenant_id;
    await pool!.query(`update tenants set razorpay_subscription_id = 'sub_test_1' where id = $1`, [tenantId]);

    const saved = env.razorpay.webhookSecret;
    env.razorpay.webhookSecret = "whsec_test";
    try {
      const payload = JSON.stringify({
        event: "subscription.charged",
        payload: { subscription: { entity: { id: "sub_test_1", current_end: Math.floor(Date.now() / 1000) + 86400 * 30 } } },
      });
      const sign = (body: string) => createHmac("sha256", "whsec_test").update(body).digest("hex");
      const post = (body: string, signature: string, id = "evt_1") =>
        fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/billing/razorpay-webhook`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": id },
          body,
        });

      assert.equal((await post(payload, "deadbeef")).status, 400);
      assert.equal((await api.call("GET", "/api/billing", { token })).body.plan, "free");

      const ok = await post(payload, sign(payload));
      assert.equal(ok.status, 200);
      assert.equal((await ok.json() as any).handled, true);
      assert.equal((await api.call("GET", "/api/billing", { token })).body.plan, "pro");

      const again = await post(payload, sign(payload));
      assert.equal((await again.json() as any).duplicate, true);

      const ended = JSON.stringify({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_test_1" } } } });
      assert.equal((await post(ended, sign(ended), "evt_2")).status, 200);
      assert.equal((await api.call("GET", "/api/billing", { token })).body.plan, "free");
    } finally {
      env.razorpay.webhookSecret = saved;
    }
  });
});
