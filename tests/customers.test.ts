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

describe("customers", () => {
  it("groups leads by contact, isolates by tenant, and marks won contacts as customers", async () => {
    const { token, siteKey } = await api.signup("cust");

    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Riya", contact: "riya@x.co", message: "Root canal?" } });
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Riya Sharma", contact: "RIYA@x.co", message: "Follow-up question" } });
    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Amit", contact: "amit@x.co", message: "Cleaning cost?" } });

    const list = await api.call("GET", "/api/customers", { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.customers.length, 2);

    const riya = list.body.customers.find((c: any) => c.contact.toLowerCase() === "riya@x.co");
    assert.equal(riya.leadCount, 2);
    assert.equal(riya.wonCount, 0);
    assert.equal(riya.isCustomer, false);
    assert.equal(riya.name, "Riya Sharma");

    const leads = await api.call("GET", "/api/leads", { token });
    const riyaLeadId = leads.body.leads.find((l: any) => l.contact.toLowerCase() === "riya@x.co").id;
    await api.call("PATCH", `/api/leads/${riyaLeadId}`, { token, body: { status: "won" } });

    const detail = await api.call("GET", `/api/customers/${encodeURIComponent("riya@x.co")}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.customer.leadCount, 2);
    assert.equal(detail.body.customer.wonCount, 1);
    assert.equal(detail.body.customer.isCustomer, true);
    assert.equal(detail.body.leads.length, 2);

    const other = await api.signup("cust_other");
    assert.equal((await api.call("GET", "/api/customers", { token: other.token })).body.customers.length, 0);
    assert.equal((await api.call("GET", `/api/customers/${encodeURIComponent("riya@x.co")}`, { token: other.token })).status, 404);
  });

  it("returns 404 for a contact that never enquired, and includes follow-ups in the detail view", async () => {
    const { token, siteKey } = await api.signup("cust_fu");

    const missing = await api.call("GET", "/api/customers/ghost@x.co", { token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "customer_not_found");

    await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: "Vikram", contact: "vikram@x.co", message: "Need braces info" } });
    const leads = await api.call("GET", "/api/leads", { token });
    const leadId = leads.body.leads[0].id;

    // A new lead auto-schedules a default follow-up — that alone should show up here.
    const detail = await api.call("GET", `/api/customers/${encodeURIComponent("vikram@x.co")}`, { token });
    assert.equal(detail.body.followups.length, 1);
    assert.equal(detail.body.followups[0].leadId, leadId);
    assert.equal(detail.body.followups[0].status, "pending");
  });
});
