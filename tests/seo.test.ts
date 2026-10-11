import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as gemini from "../src/config/gemini";
import { analyzePage } from "../src/services/seo-analyzer";
import { assertFetchable, FetchBlockedError, isPrivateAddress } from "../src/utils/safeFetch";
import { startApi, type Api } from "./helpers";

let api: Api;
let site: http.Server;
let base = "";

afterEach(() => mock.restoreAll());

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(" ");

const pages: Record<string, { status: number; type?: string; body: string }> = {
  "/": {
    status: 200,
    body: `<html><head><title>Hi</title></head><body><h1>One</h1><h1>Two</h1><img src="a.png"><img src="b.png" alt="ok"><a href="/about">About</a> <a href="/contact">Contact</a> <a href="https://other.example/x">x</a><p>Short page.</p></body></html>`,
  },
  "/about": {
    status: 200,
    body: `<html lang="en"><head><title>About our dental clinic in Indore | Smile Studio</title><meta name="description" content="Meet the dentists at Smile Studio in Indore. Painless treatment, clear prices and weekend appointments for the whole family."><meta name="viewport" content="width=device-width"><link rel="canonical" href="/about"><meta property="og:title" content="About"><script type="application/ld+json">{"@type":"LocalBusiness"}</script></head><body><h1>About Smile Studio</h1><h2>Our team</h2><p>${words(330)}</p></body></html>`,
  },
  "/contact": { status: 404, body: "<html><head><title>Not found</title></head><body>Nope</body></html>" },
  "/robots.txt": { status: 200, type: "text/plain", body: "User-agent: *\nDisallow:\n" },
};

before(async () => {
  api = await startApi();
  site = http.createServer((req, res) => {
    const page = pages[req.url ?? "/"] ?? { status: 404, body: "missing" };
    res.writeHead(page.status, { "content-type": page.type ?? "text/html" });
    res.end(page.body);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await api.close();
});

const waitFor = async (token: string, id: string) => {
  for (let i = 0; i < 60; i++) {
    const res = await api.call("GET", `/api/seo/audits/${id}`, { token });
    if (res.body.audit.status !== "running") return res.body.audit;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("audit never finished");
};

describe("seo page analyzer", () => {
  it("scores a weak page low and a well-built page high", () => {
    const weak = analyzePage({ url: "https://x.test/", status: 200, html: pages["/"].body, ms: 100, bytes: 400 });
    const ids = weak.issues.map((i) => i.id);
    for (const id of ["title_length", "description_missing", "h1_multiple", "viewport", "alt", "thin"]) assert.ok(ids.includes(id), id);
    assert.ok(weak.score < 60);
    assert.deepEqual(weak.internalLinks, ["https://x.test/about", "https://x.test/contact"]);

    const good = analyzePage({ url: "https://x.test/about", status: 200, html: pages["/about"].body, ms: 100, bytes: 400 });
    assert.deepEqual(good.issues.map((i) => i.id), []);
    assert.equal(good.score, 100);
  });
});

describe("javascript-built pages and sitemap discovery", () => {
  const shell = `<html lang="en"><head><title>Escorts Realm</title><meta name="viewport" content="width=device-width"></head><body><div id="__next"></div>${Array.from({ length: 6 }, (_, i) => `<script src="/_next/static/chunk${i}.js"></script>`).join("")}</body></html>`;

  it("tells a JavaScript-only page apart from a thin one and does not blame the missing heading", () => {
    const page = analyzePage({ url: "https://x.test/", status: 200, html: shell, ms: 50, bytes: 900 });
    const ids = page.issues.map((i) => i.id);
    assert.equal(page.jsRendered, true);
    assert.ok(ids.includes("js_rendered"));
    for (const noise of ["h1_missing", "thin", "thin_light", "h2"]) assert.ok(!ids.includes(noise), noise);

    const thin = analyzePage({ url: "https://x.test/", status: 200, html: "<html><head><title>Plain page title here for test</title></head><body><h1>Hi</h1><p>Short.</p></body></html>", ms: 50, bytes: 200 });
    assert.equal(thin.jsRendered, false);
    assert.ok(thin.issues.some((i) => i.id === "thin"));
  });

  it("finds pages from the sitemap when the home page has no links in its source", async () => {
    const hidden = http.createServer((req, res) => {
      const routes: Record<string, string> = {
        "/": shell,
        "/sitemap.xml": `<?xml version="1.0"?><urlset><url><loc>http://${req.headers.host}/pricing</loc></url><url><loc>http://${req.headers.host}/team</loc></url></urlset>`,
        "/pricing": "<html lang='en'><head><title>Pricing for our services across Canada | Escorts</title></head><body><h1>Pricing</h1></body></html>",
        "/team": "<html><head><title>Team</title></head><body><h1>Team</h1></body></html>",
      };
      const body = routes[req.url ?? "/"];
      res.writeHead(body ? 200 : 404, { "content-type": req.url === "/sitemap.xml" ? "application/xml" : "text/html" });
      res.end(body ?? "missing");
    });
    await new Promise<void>((resolve) => hidden.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(hidden.address() as AddressInfo).port}`;
    try {
      const { token } = await api.signup("seo_js", { plan: "pro" });
      const started = await api.call("POST", "/api/seo/audits", { token, body: { url: origin } });
      const audit = await waitFor(token, started.body.audit.id);
      assert.equal(audit.status, "done");
      const paths = audit.result.pages.map((p: any) => new URL(p.url).pathname).sort();
      assert.deepEqual(paths, ["/", "/pricing", "/team"]);
      assert.equal(audit.result.siteIssues.some((i: any) => i.id === "sitemap"), false);
    } finally {
      await new Promise<void>((resolve) => hidden.close(() => resolve()));
    }
  });
});

describe("fetch safety", () => {
  it("refuses internal addresses, odd ports, credentials and non-web schemes in production mode", () => {
    for (const bad of ["http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://192.168.1.1/", "http://localhost/", "http://svc.internal/", "https://example.com:22/", "ftp://example.com/", "file:///etc/passwd", "https://user:pw@example.com/"]) {
      assert.throws(() => assertFetchable(bad, false), FetchBlockedError, bad);
    }
    assert.doesNotThrow(() => assertFetchable("https://example.com/page", false));
    assert.doesNotThrow(() => assertFetchable("http://127.0.0.1:3001/", true));
  });

  it("recognises private and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.77.46", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  });
});

describe("seo audit API", () => {
  it("scans a site, follows its links, and reports a score with fixes", async () => {
    const { token } = await api.signup("seo", { plan: "pro" });
    const started = await api.call("POST", "/api/seo/audits", { token, body: { url: base } });
    assert.equal(started.status, 202);
    assert.equal(started.body.audit.status, "running");

    const busy = await api.call("POST", "/api/seo/audits", { token, body: { url: base } });
    assert.equal(busy.body.error, "audit_already_running");

    const audit = await waitFor(token, started.body.audit.id);
    assert.equal(audit.status, "done");
    assert.equal(audit.result.pages.length, 3);
    const byPath = Object.fromEntries(audit.result.pages.map((p: any) => [new URL(p.url).pathname, p]));
    assert.equal(byPath["/about"].score, 100);
    assert.ok(byPath["/"].score < 60);
    assert.equal(byPath["/contact"].status, 404);
    assert.ok(audit.result.siteIssues.some((i: any) => i.id === "sitemap"));
    assert.ok(audit.score > 0 && audit.score < 100);
    assert.ok(audit.result.counts.critical >= 1);

    const list = await api.call("GET", "/api/seo/audits", { token });
    assert.equal(list.body.audits[0].id, audit.id);
    assert.equal(list.body.audits[0].pageCount, 3);
  });

  it("is a Pro feature, validates the address and keeps scans private to the account", async () => {
    const free = await api.signup("seo_free");
    assert.equal((await api.call("POST", "/api/seo/audits", { token: free.token, body: { url: base } })).status, 403);

    const a = await api.signup("seo_a", { plan: "pro" });
    const b = await api.signup("seo_b", { plan: "pro" });
    assert.equal((await api.call("POST", "/api/seo/audits", { token: a.token, body: {} })).body.error, "missing_url");
    assert.equal((await api.call("POST", "/api/seo/audits", { token: a.token, body: { url: "file:///etc/passwd" } })).body.error, "url_not_allowed");

    const started = await api.call("POST", "/api/seo/audits", { token: a.token, body: { url: base } });
    await waitFor(a.token, started.body.audit.id);
    assert.equal((await api.call("GET", `/api/seo/audits/${started.body.audit.id}`, { token: b.token })).status, 404);
  });

  it("reports an unreachable site as a failed scan with a reason, not a crash", async () => {
    const { token } = await api.signup("seo_down", { plan: "pro" });
    const started = await api.call("POST", "/api/seo/audits", { token, body: { url: "http://127.0.0.1:9" } });
    const audit = await waitFor(token, started.body.audit.id);
    assert.equal(audit.status, "done");
    assert.equal(audit.result.pages[0].status, 0);
    assert.equal(audit.result.pages[0].issues[0].id, "unreachable");
  });
});

describe("ready-to-paste fixes", () => {
  async function scanned(label: string) {
    const acct = await api.signup(label, { plan: "pro" });
    await api.call("PUT", "/api/ai-config", { token: acct.token, body: { about: "A family dental clinic in Indore.", services: [{ name: "Braces", price: "", hidePrice: true }] } });
    const started = await api.call("POST", "/api/seo/audits", { token: acct.token, body: { url: base } });
    const audit = await waitFor(acct.token, started.body.audit.id);
    return { ...acct, audit };
  }

  it("writes the missing tags and image descriptions for a weak page, and nothing for a good one", async () => {
    const { token, audit } = await scanned("fixes");
    mock.method(gemini, "completeText", async () =>
      JSON.stringify({ title: "Dental clinic in Indore | Smile Studio", description: "Painless braces, whitening and check-ups for the whole family in Indore. Book a visit with Smile Studio this week.", h1: "Your family dentist in Indore", alts: ["Dentist checking a patient"], contentIdeas: ["Treatments we offer", "Prices and payment options", "Meet the team"] })
    );

    const home = audit.result.pages.find((p: any) => new URL(p.url).pathname === "/");
    const res = await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token, body: { url: home.url } });
    assert.equal(res.status, 200);
    const byId = Object.fromEntries(res.body.pack.items.map((i: any) => [i.id, i]));
    assert.equal(res.body.pack.aiUsed, true);
    assert.equal(byId.title.value, "<title>Dental clinic in Indore | Smile Studio</title>");
    assert.match(byId.description.value, /^<meta name="description" content="Painless braces/);
    assert.match(byId.viewport.value, /viewport/);
    assert.equal(byId.canonical.value, `<link rel="canonical" href="${home.url}">`);
    assert.match(byId.h1_multiple.value, /Keep one H1/);
    assert.match(byId.alt.value, /a\.png\s+→\s+Dentist checking a patient/);
    assert.match(byId.schema.value, /"@type": "LocalBusiness"/);
    assert.match(byId.schema.value, /Braces/);
    assert.match(byId.thin.value, /^1\. Treatments we offer/);
    assert.ok(res.body.pack.items.every((i: any) => i.value.length > 0));

    const good = audit.result.pages.find((p: any) => new URL(p.url).pathname === "/about");
    const none = await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token, body: { url: good.url } });
    assert.deepEqual(none.body.pack.items, []);

    const stored = await api.call("GET", `/api/seo/audits/${audit.id}`, { token });
    assert.ok(stored.body.audit.fixes[home.url].items.length > 0);
  });

  it("still gives the fixed-format tags when the AI is down, and refuses unknown pages and other accounts", async () => {
    const { token, audit } = await scanned("fixes_down");
    mock.method(gemini, "completeText", async () => {
      throw new Error("down");
    });
    const home = audit.result.pages.find((p: any) => new URL(p.url).pathname === "/");
    const res = await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token, body: { url: home.url } });
    assert.equal(res.body.pack.aiUsed, false);
    const ids = res.body.pack.items.map((i: any) => i.id);
    assert.ok(ids.includes("viewport") && ids.includes("canonical"));
    assert.ok(!ids.includes("title"));

    assert.equal((await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token, body: { url: "https://elsewhere.test/" } })).body.error, "unknown_page");
    assert.equal((await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token, body: {} })).body.error, "missing_url");

    const other = await api.signup("fixes_other", { plan: "pro" });
    assert.equal((await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token: other.token, body: { url: home.url } })).status, 404);
    const free = await api.signup("fixes_free");
    assert.equal((await api.call("POST", `/api/seo/audits/${audit.id}/fixes`, { token: free.token, body: { url: home.url } })).status, 403);
  });
});

