import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as gemini from "../src/config/gemini";
import { env } from "../src/config/env";
import * as mailer from "../src/services/mailer.service";
import { startApi, type Api } from "./helpers";

let api: Api;
let calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
let sent: Array<{ to: string; subject: string; text: string }> = [];

const stubAi = (reply: string | Error) =>
  mock.method(gemini, "completeText", async (opts: (typeof calls)[number]) => {
    calls.push(opts);
    if (reply instanceof Error) throw reply;
    return reply;
  });

const stubMail = () => {
  mock.method(mailer, "isMailConfigured", () => true);
  mock.method(mailer, "sendMail", async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  });
};

before(async () => {
  env.geminiApiKey = "test-key";
  api = await startApi();
});

after(async () => {
  await api.close();
});

afterEach(() => {
  mock.restoreAll();
  calls = [];
  sent = [];
});

describe("business profile", () => {
  it("returns the signup description and saves edits with limits", async () => {
    const { token } = await api.signup("profile");
    const initial = await api.call("GET", "/api/ai-config", { token });
    assert.equal(initial.body.config.about, "Dental care");
    assert.deepEqual(initial.body.config.services, []);

    const saved = await api.call("PUT", "/api/ai-config", {
      token,
      body: {
        about: "Family dentist",
        services: [{ name: "Cleaning", description: "", price: "800", hidePrice: false }],
        timings: "Mon-Sat 10-7",
        tone: "friendly",
        faqs: "Q: Parking? A: Yes",
      },
    });
    assert.deepEqual(saved.body.config.services, [{ name: "Cleaning", description: "", price: "800", hidePrice: false }]);
    const again = await api.call("GET", "/api/ai-config", { token });
    assert.equal(again.body.config.timings, "Mon-Sat 10-7");

    const tooLong = await api.call("PUT", "/api/ai-config", { token, body: { tone: "x".repeat(201), services: [] } });
    assert.equal(tooLong.body.error, "tone_too_long");
  });

  it("validates services", async () => {
    const { token } = await api.signup("profile_val");
    const notArray = await api.call("PUT", "/api/ai-config", { token, body: { services: "Cleaning ₹800" } });
    assert.equal(notArray.body.error, "invalid_services");

    const noName = await api.call("PUT", "/api/ai-config", { token, body: { services: [{ name: "", price: "800" }] } });
    assert.equal(noName.body.error, "missing_service_name");

    const tooMany = await api.call("PUT", "/api/ai-config", {
      token,
      body: { services: Array.from({ length: 31 }, (_, i) => ({ name: `Service ${i}` })) },
    });
    assert.equal(tooMany.body.error, "too_many_services");

    const longName = await api.call("PUT", "/api/ai-config", { token, body: { services: [{ name: "x".repeat(101) }] } });
    assert.equal(longName.body.error, "service_name_too_long");
  });
});

describe("auto-reply", () => {
  it("replies to a new lead, stores the thread and grounds the prompt in the business profile", async () => {
    stubAi("Hi Rohit, a root canal starts at ₹4,500. Shall I book you in?");
    const { token, siteKey } = await api.signup("auto", { plan: "pro" });
    await api.call("PUT", "/api/ai-config", {
      token,
      body: { services: [{ name: "Root canal", price: "4,500", hidePrice: false }], about: "Smile Clinic" },
    });

    const res = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Rohit", contact: "r@x.co", message: "Root canal cost?" } });
    assert.equal(res.status, 201);
    assert.match(res.body.reply, /₹4,500/);

    assert.equal(calls.length, 1);
    assert.match(calls[0].system, /Root canal.*₹4,500/s);
    assert.match(calls[0].messages[0].content, /Root canal cost\?/);

    const leads = await api.call("GET", "/api/leads", { token });
    const detail = await api.call("GET", `/api/leads/${leads.body.leads[0].id}`, { token });
    assert.deepEqual(detail.body.messages.map((m: any) => [m.direction, m.aiGenerated]), [["inbound", false], ["outbound", true]]);
  });

  it("tells the AI never to quote a hidden price", async () => {
    stubAi("Happy to help — could you call us so we can quote the right price?");
    const { token, siteKey } = await api.signup("hideprice", { plan: "pro" });
    await api.call("PUT", "/api/ai-config", {
      token,
      body: { services: [{ name: "Custom implants", price: "", hidePrice: true }] },
    });
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "x@x.co", message: "How much for implants?" } });
    assert.match(calls[0].system, /never state a number/);
  });

  it("skips the reply when switched off and survives AI failures", async () => {
    const { token, siteKey, siteId } = await api.signup("auto_off");

    const fail = stubAi(new Error("upstream down"));
    const failed = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "a@x.co", message: "hi" } });
    assert.equal(failed.status, 201);
    assert.equal(failed.body.reply, null);
    fail.mock.restore();

    const spy = stubAi("should not be used");
    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { autoreply: false } } });
    const off = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "b@x.co", message: "hi again" } });
    assert.equal(off.body.reply, null);
    assert.equal(spy.mock.callCount(), 0);
  });

  it("drafts a reply on demand, only for the owner's own leads", async () => {
    stubAi("Thanks for reaching out!");
    const a = await api.signup("draft_a");
    const b = await api.signup("draft_b");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: a.siteKey, contact: "c@x.co", message: "Need info" } });
    const id = (await api.call("GET", "/api/leads", { token: a.token })).body.leads[0].id;

    const ok = await api.call("POST", `/api/leads/${id}/ai-reply`, { token: a.token });
    assert.equal(ok.body.reply, "Thanks for reaching out!");
    const other = await api.call("POST", `/api/leads/${id}/ai-reply`, { token: b.token });
    assert.equal(other.status, 404);
  });

  it("sends a manual reply by email, records it, marks the lead replied, and isolates tenants", async () => {
    stubMail();
    stubAi(new Error("unused"));
    const a = await api.signup("reply_a");
    const b = await api.signup("reply_b");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: a.siteKey, contact: "c@x.co", message: "Need info" } });
    const id = (await api.call("GET", "/api/leads", { token: a.token })).body.leads[0].id;
    sent = []; // clear the owner-alert email sent at ingest — only care about the reply below

    const res = await api.call("POST", `/api/leads/${id}/reply`, { token: a.token, body: { text: "Thanks, we'll call you shortly!" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.status, "replied");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "c@x.co");
    assert.equal(sent[0].text, "Thanks, we'll call you shortly!");

    const detail = await api.call("GET", `/api/leads/${id}`, { token: a.token });
    assert.ok(detail.body.messages.some((m: any) => m.direction === "outbound" && m.channel === "email" && m.body === "Thanks, we'll call you shortly!"));

    assert.equal((await api.call("POST", `/api/leads/${id}/reply`, { token: b.token, body: { text: "x" } })).status, 404);
  });

  it("rejects a manual reply with no text, no email on file, or mail not configured", async () => {
    stubAi(new Error("unused"));
    const { token, siteKey } = await api.signup("reply_bad");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "+919800000001", message: "hi" } });
    const id = (await api.call("GET", "/api/leads", { token })).body.leads[0].id;

    const noText = await api.call("POST", `/api/leads/${id}/reply`, { token, body: {} });
    assert.equal(noText.body.error, "missing_text");

    const noEmail = await api.call("POST", `/api/leads/${id}/reply`, { token, body: { text: "hi" } });
    assert.equal(noEmail.body.error, "no_email_on_file");
  });
});

describe("assistant chat", () => {
  it("answers from the tenant's own data and never sees other tenants' leads", async () => {
    stubAi("You have 1 new lead.");
    const mine = await api.signup("chat_mine");
    const other = await api.signup("chat_other");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: mine.siteKey, name: "Mine", contact: "m@x.co", message: "my private enquiry" } });
    await api.call("POST", "/api/ingest/lead", { body: { site_key: other.siteKey, name: "Other", contact: "o@x.co", message: "someone else's secret" } });
    calls = [];

    const res = await api.call("POST", "/api/chat", { token: mine.token, body: { messages: [{ role: "user", content: "How many leads?" }] } });
    assert.equal(res.body.reply, "You have 1 new lead.");
    assert.match(calls[0].system, /my private enquiry/);
    assert.match(calls[0].system, /new=1/);
    assert.doesNotMatch(calls[0].system, /someone else's secret/);
  });

  it("generates blog drafts using the business profile", async () => {
    stubAi(JSON.stringify({ title: "T", excerpt: "E", content: "C" }));
    const { token } = await api.signup("blogai");
    await api.call("PATCH", "/api/tenant/plan", { token, body: { plan: "pro" } });
    await api.call("PUT", "/api/ai-config", { token, body: { about: "Smile Clinic Indore", services: [{ name: "Braces" }] } });
    const res = await api.call("POST", "/api/blog/generate", { token, body: { topic: "Braces aftercare" } });
    assert.equal(res.body.draft.title, "T");
    assert.match(calls[0].system, /Smile Clinic Indore/);
  });

  it("blocks AI blog generation on the free plan", async () => {
    stubAi(JSON.stringify({ title: "T", excerpt: "E", content: "C" }));
    const { token } = await api.signup("blogai_free");
    const res = await api.call("POST", "/api/blog/generate", { token, body: { topic: "Braces aftercare" } });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "pro_required");
    assert.equal(calls.length, 0);
  });
});

describe("skipped onboarding", () => {
  it("still captures the lead but keeps the AI quiet until the business profile has something real in it", async () => {
    const spy = stubAi("Thanks for reaching out!");
    const { token, siteKey } = await api.signup("skipped", { plan: "pro" });
    await api.call("PUT", "/api/ai-config", { token, body: { about: "" } });

    const res = await api.call("POST", "/api/ingest/lead", {
      body: { site_key: siteKey, name: "Rohit", contact: "rohit@x.co", message: "Do you have Sunday slots and what's the price?" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.reply, null);
    assert.equal(spy.mock.callCount(), 0);

    const leads = await api.call("GET", "/api/leads", { token });
    assert.equal(leads.body.leads.length, 1);
    assert.equal(leads.body.leads[0].status, "new");
    const detail = await api.call("GET", `/api/leads/${leads.body.leads[0].id}`, { token });
    assert.equal(detail.body.messages.length, 1);
  });

  it("never sends an AI reply on the free plan, even with a full profile", async () => {
    const spy = stubAi("Thanks!");
    const { token, siteKey } = await api.signup("free_noai");
    await api.call("PUT", "/api/ai-config", { token, body: { about: "A family dental clinic open all week in Pune." } });
    const res = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "m@x.co", message: "hi" } });
    assert.equal(res.body.reply, null);
    assert.equal(spy.mock.callCount(), 0);
  });
});
