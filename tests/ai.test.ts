import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as anthropic from "../src/config/anthropic";
import { env } from "../src/config/env";
import { startApi, type Api } from "./helpers";

let api: Api;
let calls: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];

const stubAi = (reply: string | Error) =>
  mock.method(anthropic, "completeText", async (opts: (typeof calls)[number]) => {
    calls.push(opts);
    if (reply instanceof Error) throw reply;
    return reply;
  });

before(async () => {
  env.anthropicApiKey = "test-key";
  api = await startApi();
});

after(async () => {
  await api.close();
});

afterEach(() => {
  mock.restoreAll();
  calls = [];
});

describe("business profile", () => {
  it("returns the signup description and saves edits with limits", async () => {
    const { token } = await api.signup("profile");
    const initial = await api.call("GET", "/api/ai-config", { token });
    assert.equal(initial.body.config.about, "Dental care");

    const saved = await api.call("PUT", "/api/ai-config", {
      token,
      body: { about: "Family dentist", services: "Cleaning ₹800", timings: "Mon-Sat 10-7", tone: "friendly", faqs: "Q: Parking? A: Yes" },
    });
    assert.equal(saved.body.config.services, "Cleaning ₹800");
    const again = await api.call("GET", "/api/ai-config", { token });
    assert.equal(again.body.config.timings, "Mon-Sat 10-7");

    const tooLong = await api.call("PUT", "/api/ai-config", { token, body: { tone: "x".repeat(201) } });
    assert.equal(tooLong.body.error, "tone_too_long");
  });
});

describe("auto-reply", () => {
  it("replies to a new lead, stores the thread and grounds the prompt in the business profile", async () => {
    stubAi("Hi Rohit, a root canal starts at ₹4,500. Shall I book you in?");
    const { token, siteKey } = await api.signup("auto");
    await api.call("PUT", "/api/ai-config", { token, body: { services: "Root canal from ₹4,500", about: "Smile Clinic" } });

    const res = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Rohit", contact: "r@x.co", message: "Root canal cost?" } });
    assert.equal(res.status, 201);
    assert.match(res.body.reply, /₹4,500/);

    assert.equal(calls.length, 1);
    assert.match(calls[0].system, /Root canal from ₹4,500/);
    assert.match(calls[0].messages[0].content, /Root canal cost\?/);

    const leads = await api.call("GET", "/api/leads", { token });
    const detail = await api.call("GET", `/api/leads/${leads.body.leads[0].id}`, { token });
    assert.deepEqual(detail.body.messages.map((m: any) => [m.direction, m.aiGenerated]), [["inbound", false], ["outbound", true]]);
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
    await api.call("PUT", "/api/ai-config", { token, body: { about: "Smile Clinic Indore", services: "Braces" } });
    const res = await api.call("POST", "/api/blog/generate", { token, body: { topic: "Braces aftercare" } });
    assert.equal(res.body.draft.title, "T");
    assert.match(calls[0].system, /Smile Clinic Indore/);
  });
});
