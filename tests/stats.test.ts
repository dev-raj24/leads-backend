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

describe("stats overview", () => {
  it("returns zeros for a brand-new workspace", async () => {
    const { token } = await api.signup("stats_empty");
    const res = await api.call("GET", "/api/stats/overview", { token });
    assert.equal(res.status, 200);
    const s = res.body.stats;
    assert.equal(s.totals.leads, 0);
    assert.equal(s.conversionRate, 0);
    assert.equal(s.avgFirstReplySeconds, null);
    assert.equal(s.daily.length, 14);
    assert.ok(s.daily.every((d: any) => d.leads === 0));
  });

  it("counts leads by status, source and day and computes conversion", async () => {
    const { token, siteKey } = await api.signup("stats_data");
    for (const contact of ["a@x.co", "b@x.co", "c@x.co", "d@x.co"]) {
      await api.call("POST", "/api/ingest/lead", { body: { site_key: siteKey, name: contact, contact, message: "hi" } });
    }
    const ids = (await api.call("GET", "/api/leads", { token })).body.leads.map((l: any) => l.id);
    await api.call("PATCH", `/api/leads/${ids[0]}`, { token, body: { status: "won" } });
    await api.call("PATCH", `/api/leads/${ids[1]}`, { token, body: { status: "replied" } });
    await api.call("POST", "/api/leads/bulk", { token, body: { leads: [{ contact: "w@x.co", source: "whatsapp" }] } });

    const s = (await api.call("GET", "/api/stats/overview?days=7", { token })).body.stats;
    assert.equal(s.totals.leads, 5);
    assert.equal(s.totals.won, 1);
    assert.equal(s.totals.waiting, 3);
    assert.equal(s.totals.today, 5);
    assert.equal(s.totals.last7Days, 5);
    assert.equal(s.conversionRate, 0.2);
    assert.equal(s.daily.length, 7);
    assert.equal(s.daily[6].leads, 5);
    assert.equal(s.daily[6].won, 1);
    assert.deepEqual(s.bySource, [{ source: "form", count: 4 }, { source: "whatsapp", count: 1 }]);
    assert.equal(s.followupsOpen, 4);
  });

  it("is scoped to the tenant", async () => {
    const a = await api.signup("stats_a");
    const b = await api.signup("stats_b");
    await api.call("POST", "/api/ingest/lead", { body: { site_key: a.siteKey, contact: "only-a@x.co" } });
    const s = (await api.call("GET", "/api/stats/overview", { token: b.token })).body.stats;
    assert.equal(s.totals.leads, 0);
  });

  it("validates days and timezone, and honours a timezone", async () => {
    const { token } = await api.signup("stats_val");
    assert.equal((await api.call("GET", "/api/stats/overview?days=5", { token })).body.error, "invalid_days");
    assert.equal((await api.call("GET", "/api/stats/overview?tz=Not/AZone", { token })).body.error, "invalid_timezone");
    const ist = await api.call("GET", "/api/stats/overview?tz=Asia/Kolkata&days=30", { token });
    assert.equal(ist.status, 200);
    assert.equal(ist.body.stats.daily.length, 30);
    assert.equal((await api.call("GET", "/api/stats/overview")).status, 401);
  });
});
