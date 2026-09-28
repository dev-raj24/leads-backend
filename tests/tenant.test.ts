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

describe("tenant onboarding", () => {
  it("starts on the free plan, not onboarded, and has no industry", async () => {
    const { token } = await api.signup("tenant");
    const res = await api.call("GET", "/api/tenant/me", { token });
    assert.equal(res.body.tenant.plan, "free");
    assert.equal(res.body.tenant.onboardingCompleted, false);
    assert.equal(res.body.tenant.industry, null);
  });

  it("renames the business", async () => {
    const { token } = await api.signup("tenant_name");
    const renamed = await api.call("PATCH", "/api/tenant/name", { token, body: { name: "Smile Clinic Indore" } });
    assert.equal(renamed.body.tenant.name, "Smile Clinic Indore");

    const blank = await api.call("PATCH", "/api/tenant/name", { token, body: { name: "   " } });
    assert.equal(blank.body.error, "missing_business_name");

    const tooLong = await api.call("PATCH", "/api/tenant/name", { token, body: { name: "x".repeat(121) } });
    assert.equal(tooLong.body.error, "business_name_too_long");
  });

  it("saves the industry and completes onboarding once a plan is chosen", async () => {
    const { token } = await api.signup("tenant_flow");

    const industry = await api.call("PATCH", "/api/tenant/industry", { token, body: { industry: "Dental clinic" } });
    assert.equal(industry.body.tenant.industry, "Dental clinic");
    assert.equal(industry.body.tenant.onboardingCompleted, false);

    const plan = await api.call("PATCH", "/api/tenant/plan", { token, body: { plan: "pro" } });
    assert.equal(plan.body.tenant.plan, "pro");
    assert.equal(plan.body.tenant.onboardingCompleted, true);

    const me = await api.call("GET", "/api/tenant/me", { token });
    assert.equal(me.body.tenant.plan, "pro");
    assert.equal(me.body.tenant.onboardingCompleted, true);
  });

  it("rejects an unknown plan and a blank industry", async () => {
    const { token } = await api.signup("tenant_val");
    const badPlan = await api.call("PATCH", "/api/tenant/plan", { token, body: { plan: "enterprise" } });
    assert.equal(badPlan.body.error, "invalid_plan");
    const blank = await api.call("PATCH", "/api/tenant/industry", { token, body: { industry: "   " } });
    assert.equal(blank.body.error, "missing_industry");
  });

  it("requires auth and isolates tenants", async () => {
    const a = await api.signup("tenant_iso_a");
    const b = await api.signup("tenant_iso_b");
    await api.call("PATCH", "/api/tenant/plan", { token: a.token, body: { plan: "pro" } });
    const bMe = await api.call("GET", "/api/tenant/me", { token: b.token });
    assert.equal(bMe.body.tenant.plan, "free");
    assert.equal((await api.call("GET", "/api/tenant/me")).status, 401);
  });
});
