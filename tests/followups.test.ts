import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as anthropic from "../src/config/anthropic";
import { env } from "../src/config/env";
import { runDueFollowups } from "../src/services/followup-runner.service";
import * as mailer from "../src/services/mailer.service";
import { startApi, type Api } from "./helpers";

let api: Api;
let sent: Array<{ to: string; subject: string; text: string }> = [];

const stubMail = () => {
  mock.method(mailer, "isMailConfigured", () => true);
  mock.method(mailer, "sendMail", async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  });
};

const stubAi = (reply: string | Error) =>
  mock.method(anthropic, "completeText", async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const past = () => new Date(Date.now() - 1000).toISOString();

async function newLead(siteKey: string, token: string, contact: string) {
  await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Riya", contact, message: "Need braces info" } });
  const leads = await api.call("GET", "/api/leads", { token });
  return leads.body.leads.find((l: any) => l.contact === contact).id as string;
}

before(async () => {
  env.anthropicApiKey = "test-key";
  api = await startApi();
});

after(async () => {
  await api.close();
});

afterEach(() => {
  mock.restoreAll();
  sent = [];
});

describe("alerts", () => {
  it("emails the owner about a new lead and respects the alerts switch", async () => {
    stubMail();
    stubAi(new Error("no ai"));
    const { token, siteKey, siteId, email } = await api.signup("alerts");

    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Asha", contact: "asha@x.co", message: "Hello" } });
    await settle();
    const alert = sent.find((m) => m.to === email);
    assert.ok(alert);
    assert.match(alert.subject, /New lead: Asha/);
    assert.match(alert.text, /Hello/);

    sent = [];
    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { alerts: false } } });
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, contact: "b@x.co", message: "again" } });
    await settle();
    assert.equal(sent.filter((m) => m.to === email).length, 0);
  });

  it("emails the AI reply to a lead who left an email address", async () => {
    stubMail();
    stubAi("Thanks Asha, we'll be in touch.");
    const { siteKey } = await api.signup("email_reply");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Asha", contact: "asha@x.co", message: "Hello" } });
    await settle();
    const toLead = sent.find((m) => m.to === "asha@x.co");
    assert.ok(toLead);
    assert.equal(toLead.text, "Thanks Asha, we'll be in touch.");
  });
});

describe("follow-ups", () => {
  it("schedules a pending follow-up 48 hours after a new lead", async () => {
    stubAi(new Error("no ai"));
    const { token, siteKey } = await api.signup("fu_default");
    await newLead(siteKey, token, "riya@x.co");
    const list = await api.call("GET", "/api/followups", { token });
    assert.equal(list.body.followups.length, 1);
    assert.equal(list.body.followups[0].status, "pending");
    const hoursAhead = (Date.parse(list.body.followups[0].runAt) - Date.now()) / 3600000;
    assert.ok(hoursAhead > 47 && hoursAhead < 49);
  });

  it("does not send an unapproved follow-up, then sends it once approved", async () => {
    stubMail();
    stubAi("Hi Riya, still interested in braces?");
    const { token, siteKey } = await api.signup("fu_approve");
    const leadId = await newLead(siteKey, token, "riya@x.co");
    sent = [];

    const created = await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: past() } });
    assert.equal(created.status, 201);
    const id = created.body.followup.id;

    await runDueFollowups();
    assert.equal(sent.length, 0);
    const still = await api.call("GET", "/api/followups", { token });
    assert.equal(still.body.followups.find((f: any) => f.id === id).status, "pending");

    const approved = await api.call("POST", `/api/followups/${id}/approve`, { token, body: { template: "Hi Riya, shall we book a slot?" } });
    assert.equal(approved.body.followup.status, "approved");

    assert.equal(await runDueFollowups(), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "riya@x.co");
    assert.equal(sent[0].text, "Hi Riya, shall we book a slot?");

    const after = await api.call("GET", "/api/followups", { token });
    const done = after.body.followups.find((f: any) => f.id === id);
    assert.equal(done.status, "sent");
    assert.equal(done.channel, "email");
    const detail = await api.call("GET", `/api/leads/${leadId}`, { token });
    assert.ok(detail.body.messages.some((m: any) => m.direction === "outbound" && m.body.includes("book a slot")));
  });

  it("sends automatically when auto follow-up is switched on, drafting with AI", async () => {
    stubMail();
    stubAi("Hi Riya, just checking in!");
    const { token, siteKey, siteId } = await api.signup("fu_auto");
    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { autofollow: true } } });
    const leadId = await newLead(siteKey, token, "riya@x.co");
    sent = [];

    await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: past() } });
    await runDueFollowups();
    const nudge = sent.find((m) => m.subject === "Following up on your enquiry");
    assert.equal(nudge?.text, "Hi Riya, just checking in!");
  });

  it("falls back to a generic message when the AI is down, and hands phone leads over for manual sending", async () => {
    stubMail();
    stubAi(new Error("down"));
    const { token, siteKey } = await api.signup("fu_manual");
    const leadId = await newLead(siteKey, token, "+919800000009");
    await settle();
    sent = [];
    const created = await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: past() } });
    const id = created.body.followup.id;
    await api.call("POST", `/api/followups/${id}/approve`, { token });

    await runDueFollowups();
    const list = await api.call("GET", "/api/followups", { token });
    const item = list.body.followups.find((f: any) => f.id === id);
    assert.equal(item.status, "manual");
    assert.match(item.template, /just checking in/);
    assert.equal(sent.length, 0);

    const marked = await api.call("POST", `/api/followups/${id}/mark-sent`, { token });
    assert.equal(marked.body.followup.status, "sent");
  });

  it("cancels follow-ups for leads that are no longer new", async () => {
    stubMail();
    stubAi(new Error("down"));
    const { token, siteKey } = await api.signup("fu_cancel");
    const leadId = await newLead(siteKey, token, "riya@x.co");
    sent = [];
    const created = await api.call("POST", `/api/leads/${leadId}/followups`, { token, body: { runAt: past() } });
    const id = created.body.followup.id;
    await api.call("POST", `/api/followups/${id}/approve`, { token });
    await api.call("PATCH", `/api/leads/${leadId}`, { token, body: { status: "replied" } });

    await runDueFollowups();
    const list = await api.call("GET", "/api/followups", { token });
    assert.equal(list.body.followups.find((f: any) => f.id === id).status, "cancelled");
    assert.equal(sent.length, 0);
  });

  it("lets owners cancel, validates input and isolates tenants", async () => {
    stubAi(new Error("down"));
    const a = await api.signup("fu_iso_a");
    const b = await api.signup("fu_iso_b");
    const leadId = await newLead(a.siteKey, a.token, "riya@x.co");
    const created = await api.call("POST", `/api/leads/${leadId}/followups`, { token: a.token, body: {} });
    const id = created.body.followup.id;

    assert.equal((await api.call("POST", `/api/followups/${id}/approve`, { token: b.token })).status, 404);
    assert.equal((await api.call("POST", `/api/leads/${leadId}/followups`, { token: b.token, body: {} })).status, 404);
    assert.equal((await api.call("POST", `/api/leads/${leadId}/followups`, { token: a.token, body: { runAt: "nonsense" } })).body.error, "invalid_run_at");

    const cancelled = await api.call("POST", `/api/followups/${id}/cancel`, { token: a.token });
    assert.equal(cancelled.body.followup.status, "cancelled");
    assert.equal((await api.call("POST", `/api/followups/${id}/cancel`, { token: a.token })).status, 404);
  });
});
