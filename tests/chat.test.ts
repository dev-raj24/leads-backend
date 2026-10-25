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

const savedDomain = env.inboundEmailDomain;

before(async () => {
  env.geminiApiKey = "test-key";
  env.inboundEmailDomain = "inbound.example.test";
  api = await startApi();
});
after(async () => {
  env.inboundEmailDomain = savedDomain;
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
