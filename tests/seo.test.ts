import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { analyzePage } from "../src/services/seo-analyzer";
import { assertFetchable, FetchBlockedError, isPrivateAddress } from "../src/utils/safeFetch";
import { startApi, type Api } from "./helpers";

let api: Api;
let site: http.Server;
let base = "";

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
