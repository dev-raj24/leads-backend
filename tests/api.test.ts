import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startApi, type Api } from "./helpers";

let api: Api;

before(async () => {
  api = await startApi();
});

after(async () => {
  await api.close();
});

describe("auth", () => {
  it("signs up, rejects duplicates, logs in and rejects bad passwords", async () => {
    const { email } = await api.signup("auth");

    const dup = await api.call("POST", "/api/auth/signup", { body: { businessName: "X", email, password: "secret123" } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, "email_in_use");

    const ok = await api.call("POST", "/api/auth/login", { body: { email, password: "secret123" } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);

    const bad = await api.call("POST", "/api/auth/login", { body: { email, password: "wrong-pass" } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, "invalid_credentials");
  });

  it("validates signup input", async () => {
    const weak = await api.call("POST", "/api/auth/signup", { body: { businessName: "X", email: "a@b.co", password: "123" } });
    assert.equal(weak.body.error, "weak_password");
    const badEmail = await api.call("POST", "/api/auth/signup", { body: { businessName: "X", email: "nope", password: "secret123" } });
    assert.equal(badEmail.body.error, "invalid_email");
  });

  it("protects private routes", async () => {
    const none = await api.call("GET", "/api/leads");
    assert.equal(none.status, 401);
    const garbage = await api.call("GET", "/api/leads", { token: "not-a-jwt" });
    assert.equal(garbage.status, 401);
  });
});

describe("leads", () => {
  it("ingests from a site key, lists, reads and updates status", async () => {
    const { token, siteKey } = await api.signup("leads");

    const ingest = await api.call("POST", "/api/ingest/lead", {
      body: { site_key: siteKey, name: "Rohit", contact: "+919800000001", message: "Root canal cost?" },
    });
    assert.equal(ingest.status, 201);

    const list = await api.call("GET", "/api/leads", { token });
    assert.equal(list.body.leads.length, 1);
    const id = list.body.leads[0].id;

    const one = await api.call("GET", `/api/leads/${id}`, { token });
    assert.equal(one.body.lead.contact, "+919800000001");

    const patched = await api.call("PATCH", `/api/leads/${id}`, { token, body: { status: "replied" } });
    assert.equal(patched.body.lead.status, "replied");

    const invalid = await api.call("PATCH", `/api/leads/${id}`, { token, body: { status: "bogus" } });
    assert.equal(invalid.status, 400);

    const filtered = await api.call("GET", "/api/leads?status=won", { token });
    assert.equal(filtered.body.leads.length, 0);
  });

  it("rejects ingest with an unknown key or no contact", async () => {
    const unknown = await api.call("POST", "/api/ingest/lead", { body: { site_key: "nope", contact: "1" } });
    assert.equal(unknown.status, 401);
    const { siteKey } = await api.signup("ingest");
    const noContact = await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey } });
    assert.equal(noContact.status, 400);
  });

  it("bulk-creates valid rows", async () => {
    const { token } = await api.signup("bulk");
    const res = await api.call("POST", "/api/leads/bulk", {
      token,
      body: { leads: [{ contact: "a@x.co", name: "A", source: "form" }, { contact: "", name: "skip" }, { contact: "b@x.co", source: "whatsapp" }] },
    });
    assert.equal(res.body.count, 2);
  });

  it("keeps tenants isolated", async () => {
    const a = await api.signup("iso_a");
    const b = await api.signup("iso_b");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: a.siteKey, contact: "secret-lead" } });
    const aLeads = await api.call("GET", "/api/leads", { token: a.token });
    const id = aLeads.body.leads[0].id;

    const bList = await api.call("GET", "/api/leads", { token: b.token });
    assert.equal(bList.body.leads.length, 0);
    const bRead = await api.call("GET", `/api/leads/${id}`, { token: b.token });
    assert.equal(bRead.status, 404);
    const bWrite = await api.call("PATCH", `/api/leads/${id}`, { token: b.token, body: { status: "won" } });
    assert.equal(bWrite.status, 404);
  });
});

describe("offers and widget config", () => {
  it("creates, updates, exposes to the widget and deletes", async () => {
    const { token, siteKey } = await api.signup("offers");

    const empty = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(empty.body.offer, null);

    const created = await api.call("POST", "/api/offers", {
      token,
      body: { title: "20% off", body: "Weekend", active: true, displayMode: "top", actionType: "whatsapp", whatsappNumber: "+91999" },
    });
    assert.equal(created.status, 201);
    const id = created.body.offer.id;

    const cfg = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(cfg.body.offer.title, "20% off");
    assert.equal(cfg.body.offer.actionText, "Chat on WhatsApp");

    await api.call("PATCH", `/api/offers/${id}`, { token, body: { active: false } });
    const paused = await api.call("GET", `/api/public/widget-config?siteKey=${siteKey}`);
    assert.equal(paused.body.offer, null);

    const del = await api.call("DELETE", `/api/offers/${id}`, { token });
    assert.equal(del.body.ok, true);
    const missing = await api.call("DELETE", `/api/offers/${id}`, { token });
    assert.equal(missing.status, 404);
  });

  it("requires a title and a site key", async () => {
    const { token } = await api.signup("offers_val");
    const noTitle = await api.call("POST", "/api/offers", { token, body: { body: "x" } });
    assert.equal(noTitle.body.error, "missing_title");
    const noKey = await api.call("GET", "/api/public/widget-config");
    assert.equal(noKey.body.error, "missing_site_key");
  });
});

describe("blog", () => {
  it("publishes posts to the public embed and hides drafts", async () => {
    const { token, siteKey } = await api.signup("blog");

    const draft = await api.call("POST", "/api/blog", { token, body: { title: "Draft post", content: "wip" } });
    assert.equal(draft.body.post.status, "draft");
    const live = await api.call("POST", "/api/blog", { token, body: { title: "Live post", content: "hello", status: "published" } });
    assert.equal(live.body.post.slug, "live-post");

    const list = await api.call("GET", `/api/public/blog?siteKey=${siteKey}`);
    assert.deepEqual(list.body.posts.map((p: any) => p.title), ["Live post"]);
    const one = await api.call("GET", `/api/public/blog/live-post?siteKey=${siteKey}`);
    assert.equal(one.body.post.content, "hello");
    const hidden = await api.call("GET", `/api/public/blog/draft-post?siteKey=${siteKey}`);
    assert.equal(hidden.status, 404);

    const published = await api.call("PATCH", `/api/blog/${draft.body.post.id}`, { token, body: { status: "published" } });
    assert.ok(published.body.post.publishedAt);

    const dupTitle = await api.call("POST", "/api/blog", { token, body: { title: "Live post", content: "again" } });
    assert.notEqual(dupTitle.body.post.slug, "live-post");
  });
});

describe("site, follow-ups and chat", () => {
  it("reads and updates site settings, lists follow-ups", async () => {
    const { token, siteId } = await api.signup("site");
    const me = await api.call("GET", "/api/sites/me", { token });
    assert.equal(me.body.site.id, siteId);
    const updated = await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { alerts: true } } });
    assert.deepEqual(updated.body.site.settings, { alerts: true });
    const bad = await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: "x" } });
    assert.equal(bad.status, 400);
    const followups = await api.call("GET", "/api/followups", { token });
    assert.deepEqual(followups.body.followups, []);
  });

  it("reports AI as not configured without a key", async () => {
    const { token } = await api.signup("chat");
    const res = await api.call("POST", "/api/chat", { token, body: { messages: [{ role: "user", content: "hi" }] } });
    assert.equal(res.status, 503);
    const empty = await api.call("POST", "/api/chat", { token, body: { messages: [] } });
    assert.equal(empty.status, 400);
  });
});
