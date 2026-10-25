import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { pool } from "../src/config/db";
import { env } from "../src/config/env";
import { startApi, type Api } from "./helpers";

let api: Api;
let google: http.Server;
let base = "";
let revokedTokens: string[] = [];
let queryCalls = 0;
let failRefresh = false;

const saved = { ...env.google };

const siteQuery = (body: any) => {
  const dim = body.dimensions?.[0];
  if (!dim) return { rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 }] };
  if (dim === "date") return { rows: [{ keys: ["2026-10-01"], clicks: 10, impressions: 300 }, { keys: ["2026-10-02"], clicks: 12, impressions: 320 }] };
  if (dim === "query") return { rows: [{ keys: ["root canal cost indore"], clicks: 40, impressions: 900, ctr: 0.044, position: 9.6 }, { keys: ["dentist near me"], clicks: 5, impressions: 1500, ctr: 0.003, position: 18.2 }] };
  return { rows: [{ keys: ["https://smile.example/services"], clicks: 60, impressions: 2000, ctr: 0.03, position: 11.1 }] };
};

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
        return failRefresh ? send(400, { error: "invalid_grant" }) : send(200, { access_token: "at-2", expires_in: 3600 });
      }
      if (url === "/revoke") {
        revokedTokens.push(new URLSearchParams(raw).get("token") ?? "");
        return send(200, {});
      }
      if (url === "/oauth2/v2/userinfo") return send(200, { email: "owner@smile.example" });
      if (url === "/webmasters/v3/sites") return send(200, { siteEntry: [{ siteUrl: "sc-domain:smile.example", permissionLevel: "siteOwner" }, { siteUrl: "https://old.example/", permissionLevel: "siteUnverifiedUser" }] });
      if (url.startsWith("/webmasters/v3/sites/") && url.endsWith("/searchAnalytics/query")) {
        queryCalls += 1;
        return send(200, siteQuery(JSON.parse(raw || "{}")));
      }
      send(404, {});
    });
  });
  await new Promise<void>((resolve) => google.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  Object.assign(env.google, { clientId: "cid", clientSecret: "csecret", authBase: `${base}/auth`, tokenBase: base, apiBase: base });
});

after(async () => {
  Object.assign(env.google, saved);
  await new Promise<void>((resolve) => google.close(() => resolve()));
  await api.close();
});

const callback = (code: string, state: string) =>
  fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/google/callback?code=${code}&state=${encodeURIComponent(state)}`, { redirect: "manual" });

async function connectedTenant(label: string) {
  const acct = await api.signup(label, { plan: "pro" });
  const { url } = (await api.call("POST", "/api/search-console/connect", { token: acct.token })).body;
  const state = new URL(url).searchParams.get("state")!;
  const res = await callback("good", state);
  return { ...acct, url, state, res };
}

describe("search console connection", () => {
  it("sends the owner to Google, stores the token sealed, and lists their properties", async () => {
    const t = await connectedTenant("sc_connect");
    const consent = new URL(t.url);
    assert.equal(consent.searchParams.get("client_id"), "cid");
    assert.equal(consent.searchParams.get("access_type"), "offline");
    assert.match(consent.searchParams.get("scope") ?? "", /webmasters\.readonly/);

    assert.equal(t.res.status, 302);
    assert.match(t.res.headers.get("location") ?? "", /\/seo\?tab=rankings&connected=1$/);

    const status = (await api.call("GET", "/api/search-console/status", { token: t.token })).body.status;
    assert.deepEqual(status, { configured: true, connected: true, email: "owner@smile.example", property: null, needsReconnect: false });

    const stored = await pool!.query(`select refresh_token_enc from search_console_connections where tenant_id = (select tenant_id from users where email = $1)`, [t.email]);
    assert.ok(stored.rows[0].refresh_token_enc.length > 20);
    assert.ok(!stored.rows[0].refresh_token_enc.includes("rt-secret-1"));

    const props = (await api.call("GET", "/api/search-console/properties", { token: t.token })).body.properties;
    assert.deepEqual(props.map((p: any) => p.siteUrl), ["sc-domain:smile.example"]);
  });

  it("rejects forged or expired state and failed codes without connecting anyone", async () => {
    const acct = await api.signup("sc_forged", { plan: "pro" });
    const forged = await callback("good", "eyJ0IjoieCJ9.bad");
    assert.match(forged.headers.get("location") ?? "", /error=failed/);

    const { url } = (await api.call("POST", "/api/search-console/connect", { token: acct.token })).body;
    const state = new URL(url).searchParams.get("state")!;
    const wrongCode = await callback("nope", state);
    assert.match(wrongCode.headers.get("location") ?? "", /error=failed/);
    assert.equal((await api.call("GET", "/api/search-console/status", { token: acct.token })).body.status.connected, false);

    const denied = await fetch(`http://127.0.0.1:${(globalThis as any).__apiPort}/api/public/google/callback?error=access_denied`, { redirect: "manual" });
    assert.match(denied.headers.get("location") ?? "", /error=denied/);
  });

  it("only accepts a property the Google account really owns, then reports and caches performance", async () => {
    const t = await connectedTenant("sc_perf");
    assert.equal((await api.call("PUT", "/api/search-console/property", { token: t.token, body: { siteUrl: "https://not-mine.example/" } })).body.error, "unknown_property");
    assert.equal((await api.call("GET", "/api/search-console/performance", { token: t.token })).body.error, "no_property_chosen");

    const chosen = await api.call("PUT", "/api/search-console/property", { token: t.token, body: { siteUrl: "sc-domain:smile.example" } });
    assert.equal(chosen.body.status.property, "sc-domain:smile.example");

    queryCalls = 0;
    const perf = (await api.call("GET", "/api/search-console/performance?days=28", { token: t.token })).body.performance;
    assert.equal(perf.totals.clicks, 120);
    assert.equal(perf.totals.ctr, 3);
    assert.equal(perf.totals.position, 12.4);
    assert.equal(perf.daily.length, 2);
    assert.equal(perf.queries[0].query, "root canal cost indore");
    assert.equal(perf.queries[0].ctr, 4.4);
    assert.equal(perf.pages[0].page, "https://smile.example/services");
    assert.equal(queryCalls, 5);

    await api.call("GET", "/api/search-console/performance?days=28", { token: t.token });
    assert.equal(queryCalls, 5);
    await api.call("GET", "/api/search-console/performance?days=28&refresh=1", { token: t.token });
    assert.equal(queryCalls, 10);

    assert.equal((await api.call("GET", "/api/search-console/performance?days=5", { token: t.token })).body.error, "invalid_range");
  });

  it("disconnects and revokes at Google, and keeps tenants and plans separate", async () => {
    revokedTokens = [];
    const t = await connectedTenant("sc_disc");
    const other = await api.signup("sc_other", { plan: "pro" });
    assert.equal((await api.call("GET", "/api/search-console/status", { token: other.token })).body.status.connected, false);

    const free = await api.signup("sc_free");
    assert.equal((await api.call("POST", "/api/search-console/connect", { token: free.token })).status, 403);

    const out = await api.call("DELETE", "/api/search-console", { token: t.token });
    assert.equal(out.body.status.connected, false);
    assert.deepEqual(revokedTokens, ["rt-secret-1"]);
  });

  it("asks the owner to reconnect when Google says access was withdrawn", async () => {
    const t = await connectedTenant("sc_revoked");
    await api.call("PUT", "/api/search-console/property", { token: t.token, body: { siteUrl: "sc-domain:smile.example" } });
    failRefresh = true;
    try {
      const { clearAccessCacheForTests } = await import("../src/services/search-console.service");
      clearAccessCacheForTests();
      const res = await api.call("GET", "/api/search-console/performance?days=7&refresh=1", { token: t.token });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "google_access_revoked");
      assert.equal((await api.call("GET", "/api/search-console/status", { token: t.token })).body.status.needsReconnect, true);
    } finally {
      failRefresh = false;
    }
  });
});
