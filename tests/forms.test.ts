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

const ingest = (siteKey: string, body: Record<string, unknown>) => api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, ...body } });

describe("hosted form and form questions", () => {
  it("normalises the owner's questions and serves them, with the consent line, to the hosted form page", async () => {
    const { token, siteKey, siteId } = await api.signup("hostedform");
    const saved = await api.call("PATCH", `/api/sites/${siteId}/settings`, {
      token,
      body: { settings: { leadFields: [{ name: "Service", required: true, options: ["Braces", "Whitening", "Braces"] }, { name: "Budget" }, { name: "service" }] } },
    });
    assert.deepEqual(saved.body.site.settings.leadFields, [
      { name: "Service", required: true, options: ["Braces", "Whitening"] },
      { name: "Budget", required: false, options: [] },
    ]);

    const page = await api.call("GET", `/api/public/form?siteKey=${siteKey}`);
    assert.equal(page.body.businessName, "Biz hostedform");
    assert.equal(page.body.fields.length, 2);
    assert.match(page.body.consent, /reply to your enquiry/);
    assert.equal(page.body.poweredBy, true);
    assert.equal((await api.call("GET", "/api/public/form?siteKey=nope")).status, 404);

    await api.call("PATCH", `/api/sites/${siteId}/settings`, { token, body: { settings: { leadFields: [], formConsent: "  We may call you about this enquiry only.  " } } });
    assert.equal((await api.call("GET", `/api/public/form?siteKey=${siteKey}`)).body.consent, "We may call you about this enquiry only.");
  });

  it("checks answers against the questions and shows them on the lead", async () => {
    const { token, siteKey, siteId } = await api.signup("formanswers");
    await api.call("PATCH", `/api/sites/${siteId}/settings`, {
      token,
      body: { settings: { leadFields: [{ name: "Service", required: true, options: ["Braces", "Whitening"] }, { name: "Budget" }] } },
    });

    assert.equal((await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: {} })).body.error, "missing_field");
    assert.equal((await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: { Service: "Surgery" } })).body.error, "invalid_field");
    const ok = await ingest(siteKey, { contact: "f@x.co", message: "hi", fields: { Service: "Braces", Budget: "20000", Hacker: "x" } });
    assert.equal(ok.status, 201);
    const lead = (await api.call("GET", "/api/leads", { token })).body.leads[0];
    assert.deepEqual(lead.customFields, { Service: "Braces", Budget: "20000" });
  });
});
