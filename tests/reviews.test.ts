import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { pool } from "../src/config/db";
import { env } from "../src/config/env";
import { startApi, type Api } from "./helpers";

let api: Api;
let google: http.Server;
let revokedTokens: string[] = [];

const saved = { ...env.google };

before(async () => {
  api = await startApi();
  google = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = req.url ?? "";
      if (url === "/token") {
        const form = new URLSearchParams(raw);
        if (form.get("grant_type") === "authorization_code") {
          return form.get("code") === "good" ? send(200, { access_token: "at-1", refresh_token: "rt-secret-1", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
        }
        return send(200, { access_token: "at-2", expires_in: 3600 });
      }
      if (url === "/revoke") {
        revokedTokens.push(new URLSearchParams(raw).get("token") ?? "");
        return send(200, {});
      }
      if (url === "/oauth2/v2/userinfo") return send(200, { email: "owner@smile.example" });
      if (url === "/accounts/accounts") return send(200, { accounts: [{ name: "accounts/111" }] });
      if (url === "/info/accounts/111/locations?readMask=name,title") return send(200, { locations: [{ name: "locations/222", title: "Smile Dental, Indore" }] });
      if (url === "/mb/accounts/111/locations/222/reviews?pageSize=50") {
        return send(200, {
          reviews: [
            { reviewId: "r1", reviewer: { displayName: "Asha" }, starRating: "FIVE", comment: "Loved the service!", createTime: "2026-10-01T10:00:00Z" },
            { reviewId: "r2", reviewer: { displayName: "Rohit" }, starRating: "TWO", comment: "Had to wait too long.", createTime: "2026-10-02T10:00:00Z" },
          ],
        });
      }
      if (url === "/mb/accounts/111/locations/222/reviews/r1/reply" && req.method === "PUT") return send(200, { comment: JSON.parse(raw).comment });
      send(404, { path: url });
    });
  });
  await new Promise<void>((resolve) => google.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  Object.assign(env.google, {
    clientId: "cid",
    clientSecret: "csecret",
    authBase: `${base}/auth`,
    tokenBase: base,
    apiBase: base,
    accountsBase: `${base}/accounts`,
    businessInfoBase: `${base}/info`,
    myBusinessBase: `${base}/mb`,
  });
});

after(async () => {
  Object.assign(env.google, saved);
  await new Promise<void>((resolve) => google.close(() => resolve()));
  await api.close();
});

const callback = (code: string, state: string) =>
  fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/google-reviews/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: "manual" });

async function connectedTenant(label: string) {
  const acct = await api.signup(label, { plan: "pro" });
  const { url } = (await api.call("POST", "/api/reviews/connect", { token: acct.token })).body;
  const state = new URL(url).searchParams.get("state")!;
  const res = await callback("good", state);
  return { ...acct, url, state, res };
}

describe("google reviews", () => {
  it("connects, picks a location, and keeps free-plan and other tenants out", async () => {
    const free = await api.signup("rv_free");
    assert.equal((await api.call("POST", "/api/reviews/connect", { token: free.token })).status, 403);

    const t = await connectedTenant("rv_connect");
    assert.equal(t.res.status, 302);
    assert.match(t.res.headers.get("location") ?? "", /\/reviews\?connected=1$/);

    const status1 = (await api.call("GET", "/api/reviews/status", { token: t.token })).body.status;
    assert.deepEqual(status1, { configured: true, connected: true, email: "owner@smile.example", locationId: null, locationName: null, needsReconnect: false });

    const stored = await pool!.query(`select refresh_token_enc from google_business_connections where tenant_id = (select tenant_id from users where email = $1)`, [t.email]);
    assert.ok(!stored.rows[0].refresh_token_enc.includes("rt-secret-1"));

    const locations = (await api.call("GET", "/api/reviews/locations", { token: t.token })).body.locations;
    assert.deepEqual(locations, [{ accountId: "111", locationId: "222", title: "Smile Dental, Indore" }]);

    const chosen = await api.call("PUT", "/api/reviews/location", { token: t.token, body: { accountId: "111", locationId: "222", title: "Smile Dental, Indore" } });
    assert.equal(chosen.body.status.locationId, "222");

    const other = await api.signup("rv_other", { plan: "pro" });
    assert.equal((await api.call("GET", "/api/reviews/status", { token: other.token })).body.status.connected, false);
  });

  it("pulls in new reviews once per review (never re-drafting an old one), and posts an owner-approved reply to Google", async () => {
    const t = await connectedTenant("rv_sync");
    await api.call("PUT", "/api/reviews/location", { token: t.token, body: { accountId: "111", locationId: "222", title: "Smile Dental, Indore" } });

    const first = (await api.call("GET", "/api/reviews", { token: t.token })).body.reviews;
    assert.equal(first.length, 2);
    assert.equal(first.find((r: any) => r.reviewId === "r1").status, "pending");
    assert.equal(first.find((r: any) => r.reviewId === "r1").aiDraft, null); // no GEMINI_API_KEY in tests — draft stays empty, never blocking the sync

    const r1 = first.find((r: any) => r.reviewId === "r1");
    const sent = await api.call("POST", `/api/reviews/${r1.id}/send`, { token: t.token, body: { text: "Thank you so much, Asha!" } });
    assert.equal(sent.body.review.status, "sent");
    assert.equal(sent.body.review.sentReply, "Thank you so much, Asha!");

    const r2 = first.find((r: any) => r.reviewId === "r2");
    const skipped = await api.call("POST", `/api/reviews/${r2.id}/skip`, { token: t.token });
    assert.equal(skipped.body.review.status, "skipped");

    await api.call("POST", "/api/reviews/sync", { token: t.token });
    const again = (await api.call("GET", "/api/reviews", { token: t.token })).body.reviews;
    assert.equal(again.length, 2, "re-syncing must not duplicate reviews already seen");
    assert.equal(again.find((r: any) => r.reviewId === "r1").status, "sent");
  });

  it("disconnects, revokes at Google, and clears stored reviews", async () => {
    revokedTokens = [];
    const t = await connectedTenant("rv_disc");
    await api.call("PUT", "/api/reviews/location", { token: t.token, body: { accountId: "111", locationId: "222", title: "Smile Dental, Indore" } });
    await api.call("GET", "/api/reviews", { token: t.token });

    const out = await api.call("DELETE", "/api/reviews", { token: t.token });
    assert.equal(out.body.status.connected, false);
    assert.deepEqual(revokedTokens, ["rt-secret-1"]);

    const tenantRow = await pool!.query<{ tenant_id: string }>(`select tenant_id from users where email = $1`, [t.email]);
    const left = await pool!.query(`select count(*) from reviews where tenant_id = $1`, [tenantRow.rows[0].tenant_id]);
    assert.equal(Number(left.rows[0].count), 0);
  });
});
