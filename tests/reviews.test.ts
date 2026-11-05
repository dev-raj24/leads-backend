import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { pool } from "../src/config/db";
import { env } from "../src/config/env";
import { startApi, type Api } from "./helpers";

let api: Api;
let serp: http.Server;

const saved = { serpApiKey: env.serpApiKey, serpApiBase: env.serpApiBase };

before(async () => {
  api = await startApi();
  serp = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "", "http://localhost");
    const engine = url.searchParams.get("engine");

    if (engine === "google_maps") {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("Smile")) {
        return send(200, {
          local_results: [
            { data_id: "0xabc:0xdef", title: "Smile Dental, Indore", address: "MG Road, Indore", rating: 4.6, reviews: 128 },
            { data_id: "0xother:0xid", title: "Smile Dental Care, Bhopal", address: "Bhopal", rating: 4.1, reviews: 40 },
          ],
        });
      }
      return send(200, { local_results: [] });
    }
    if (engine === "google_maps_reviews") {
      const dataId = url.searchParams.get("data_id");
      if (dataId !== "0xabc:0xdef") return send(200, { reviews: [] });
      return send(200, {
        reviews: [
          { review_id: "r1", user: { name: "Asha Patil" }, rating: 5, snippet: "Loved the service!", iso_date: "2026-10-01T10:00:00Z" },
          { review_id: "r2", user: { name: "Rohit Sharma" }, rating: 2, snippet: "Had to wait too long.", iso_date: "2026-10-02T10:00:00Z" },
        ],
      });
    }
    send(404, { error: "unknown engine" });
  });
  await new Promise<void>((resolve) => serp.listen(0, "127.0.0.1", resolve));
  env.serpApiKey = "test-key";
  env.serpApiBase = `http://127.0.0.1:${(serp.address() as AddressInfo).port}/search`;
});

after(async () => {
  Object.assign(env, saved);
  await new Promise<void>((resolve) => serp.close(() => resolve()));
  await api.close();
});

async function connectedTenant(label: string) {
  const acct = await api.signup(label, { plan: "pro" });
  const found = await api.call("GET", "/api/reviews/search?q=Smile Dental", { token: acct.token });
  const match = found.body.matches[0];
  const chosen = await api.call("PUT", "/api/reviews/business", { token: acct.token, body: { dataId: match.dataId, title: match.title, address: match.address } });
  return { ...acct, match, status: chosen.body.status };
}

describe("reviews (SerpApi-backed)", () => {
  it("looks up a business by name, keeps free-plan and other tenants out, and lists multiple candidates", async () => {
    const free = await api.signup("rv_free");
    assert.equal((await api.call("GET", "/api/reviews/search?q=Smile", { token: free.token })).status, 403);

    const t = await api.signup("rv_search", { plan: "pro" });
    const found = await api.call("GET", "/api/reviews/search?q=Smile Dental", { token: t.token });
    assert.equal(found.body.matches.length, 2);
    assert.equal(found.body.matches[0].title, "Smile Dental, Indore");
    assert.equal(found.body.matches[0].dataId, "0xabc:0xdef");

    const status0 = (await api.call("GET", "/api/reviews/status", { token: t.token })).body.status;
    assert.deepEqual(status0, { configured: true, connected: false, businessName: null, address: null });
  });

  it("connects a chosen business, pulls in its reviews once each, and lets another tenant stay unconnected", async () => {
    const t = await connectedTenant("rv_connect");
    assert.equal(t.status.connected, true);
    assert.equal(t.status.businessName, "Smile Dental, Indore");

    const list = (await api.call("GET", "/api/reviews", { token: t.token })).body.reviews;
    assert.equal(list.length, 2);
    const r1 = list.find((r: any) => r.reviewId === "r1");
    assert.equal(r1.reviewerName, "Asha Patil");
    assert.equal(r1.rating, 5);
    assert.equal(r1.status, "pending");
    assert.equal(r1.aiDraft, null); // no GEMINI_API_KEY in tests — draft stays empty, never blocking the sync

    const other = await api.signup("rv_other", { plan: "pro" });
    assert.equal((await api.call("GET", "/api/reviews/status", { token: other.token })).body.status.connected, false);
  });

  it("records a copied reply, skips another, and never re-drafts a review it already has", async () => {
    const t = await connectedTenant("rv_copy");
    const list = (await api.call("GET", "/api/reviews", { token: t.token })).body.reviews;
    const r1 = list.find((r: any) => r.reviewId === "r1");
    const r2 = list.find((r: any) => r.reviewId === "r2");

    const copied = await api.call("POST", `/api/reviews/${r1.id}/copy`, { token: t.token, body: { text: "Thank you so much, Asha!" } });
    assert.equal(copied.body.review.status, "sent");
    assert.equal(copied.body.review.sentReply, "Thank you so much, Asha!");

    const skipped = await api.call("POST", `/api/reviews/${r2.id}/skip`, { token: t.token });
    assert.equal(skipped.body.review.status, "skipped");

    await api.call("POST", "/api/reviews/sync", { token: t.token });
    const again = (await api.call("GET", "/api/reviews", { token: t.token })).body.reviews;
    assert.equal(again.length, 2, "re-syncing must not duplicate reviews already seen");
    assert.equal(again.find((r: any) => r.reviewId === "r1").status, "sent");
  });

  it("disconnects and clears stored reviews", async () => {
    const t = await connectedTenant("rv_disc");
    await api.call("GET", "/api/reviews", { token: t.token });

    const out = await api.call("DELETE", "/api/reviews", { token: t.token });
    assert.equal(out.body.status.connected, false);

    const tenantRow = await pool!.query<{ tenant_id: string }>(`select tenant_id from users where email = $1`, [t.email]);
    const left = await pool!.query(`select count(*) from reviews where tenant_id = $1`, [tenantRow.rows[0].tenant_id]);
    assert.equal(Number(left.rows[0].count), 0);
  });
});
