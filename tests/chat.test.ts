import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
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
const stubAi = (reply = "We open at 10.") => mock.method(gemini, "completeText", async () => reply);
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

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

async function proWithChat(label: string) {
  const acct = await api.signup(label, { plan: "pro" });
  await api.call("PATCH", `/api/sites/${acct.siteId}/settings`, { token: acct.token, body: { settings: { widget: true } } });
  await api.call("PUT", "/api/ai-config", { token: acct.token, body: { about: "A neighbourhood dental clinic." } });
  return acct;
}

describe("website chat", () => {
  it("keeps an anonymous chat out of Leads, then promotes it when contact details are shared", async () => {
    stubMail();
    stubAi();
    const { token, siteKey, email } = await proWithChat("chatsplit");

    const start = await api.call("POST", "/api/public/chat/start", { body: { siteKey, message: "What are your timings?" } });
    assert.equal(start.status, 201);
    assert.equal(start.body.reply, "We open at 10.");
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

  it("serves the hosted chat page its settings and refuses chat until the owner switches it on", async () => {
    stubAi();
    const free = await api.signup("chatfree");
    const freeConfig = await api.call("GET", `/api/public/chat/config?siteKey=${free.siteKey}`);
    assert.equal(freeConfig.status, 200);
    assert.equal(freeConfig.body.enabled, false);
    assert.equal(freeConfig.body.businessName, "Biz chatfree");
    assert.equal(freeConfig.body.poweredBy, true);
    const refused = await api.call("POST", "/api/public/chat/start", { body: { siteKey: free.siteKey, message: "hello" } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "widget_disabled");

    const pro = await proWithChat("chatpro");
    const config = await api.call("GET", `/api/public/chat/config?siteKey=${pro.siteKey}`);
    assert.equal(config.body.enabled, true);
    assert.equal(config.body.poweredBy, false);
    assert.equal(config.body.design.title, "Chat with us");
    assert.match(config.body.consent, /reply to your enquiry/);
    assert.equal((await api.call("GET", "/api/public/chat/config?siteKey=nope")).status, 404);
  });

  it("emails a team reply to a visitor who has left the page, but not to one still reading", async () => {
    stubMail();
    stubAi("Sure.");
    const acct = await proWithChat("chatmail");
    const start = await api.call("POST", "/api/public/chat/start", { body: { siteKey: acct.siteKey, message: "Hi, reach me at chatter@x.co" } });
    await settle();
    sent = [];

    await api.call("POST", `/api/chat-widget/conversations/${start.body.leadId}/reply`, { token: acct.token, body: { text: "We can see you at 5." } });
    const mail = sent.find((m) => m.to === "chatter@x.co");
    assert.ok(mail);
    assert.match(mail.text, /We can see you at 5\./);
    assert.match(mail.replyTo ?? "", /^reply\+/);

    await api.call("GET", `/api/public/chat/${start.body.leadId}/messages?siteKey=${acct.siteKey}`);
    await settle();
    sent = [];
    await api.call("POST", `/api/chat-widget/conversations/${start.body.leadId}/reply`, { token: acct.token, body: { text: "Anything else?" } });
    assert.equal(sent.filter((m) => m.to === "chatter@x.co").length, 0);
  });

  it("hands over to the team: no AI reply right after a human answered", async () => {
    const ai = stubAi("Bot answer.");
    const acct = await proWithChat("chathandoff");
    const start = await api.call("POST", "/api/public/chat/start", { body: { siteKey: acct.siteKey, message: "Hello there" } });
    await api.call("POST", `/api/chat-widget/conversations/${start.body.leadId}/reply`, { token: acct.token, body: { text: "Hi, this is Meera." } });
    const callsBefore = ai.mock.callCount();

    const next = await api.call("POST", `/api/public/chat/${start.body.leadId}/message`, { body: { siteKey: acct.siteKey, message: "Great, thanks" } });
    assert.equal(next.status, 200);
    assert.equal(next.body.handoff, true);
    assert.equal(next.body.reply, null);
    assert.equal(ai.mock.callCount(), callsBefore);

    const poll = await api.call("GET", `/api/public/chat/${start.body.leadId}/messages?siteKey=${acct.siteKey}`);
    assert.deepEqual(poll.body.messages.map((m: { from: string }) => m.from), ["visitor", "ai", "team", "visitor"]);
  });

  it("sends a visitor to the fallback line once the monthly AI chat budget is used", async () => {
    const ai = stubAi("Bot answer.");
    const acct = await proWithChat("chatbudget");
    const { pool } = await import("../src/config/db");
    const start = await api.call("POST", "/api/public/chat/start", { body: { siteKey: acct.siteKey, message: "Hello" } });
    const [{ id: tenantId }] = (await pool!.query(`select tenant_id as id from leads where id = $1`, [start.body.leadId])).rows;
    await pool!.query(
      `insert into messages (lead_id, channel, direction, body, ai_generated)
       select $1, 'chat', 'outbound', 'filler', true from generate_series(1, 2000)`,
      [start.body.leadId]
    );
    const before = ai.mock.callCount();
    const next = await api.call("POST", `/api/public/chat/${start.body.leadId}/message`, { body: { siteKey: acct.siteKey, message: "Anyone there?" } });
    assert.equal(next.status, 200);
    assert.match(next.body.reply, /team will follow up/);
    assert.equal(ai.mock.callCount(), before);
    assert.ok(tenantId);
  });
});
