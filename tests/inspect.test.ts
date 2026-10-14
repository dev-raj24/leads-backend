import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as gemini from "../src/config/gemini";
import { startApi, type Api } from "./helpers";

let api: Api;
let site: http.Server;
let base = "";
let embedKey = "";

const words = (n: number, w = "care") => Array.from({ length: n }, (_, i) => `${w}${i % 25}`).join(" ");

before(async () => {
  api = await startApi();
  site = http.createServer((req, res) => {
    const pages: Record<string, string> = {
      "/": `<html><head><title>Smile Studio</title></head><body><nav><a href="/about">About</a> <a href="/pricing">Pricing</a> <a href="/gallery.jpg">pic</a></nav><p>${words(60)}</p><script src="http://localhost:4001/widget.js" data-site-key="${embedKey}"></script></body></html>`,
      "/about": `<html><body><h1>About us</h1><p>Smile Studio is a family dental clinic in Indore. Open Monday to Saturday, 10 AM to 7 PM. ${words(50)}</p></body></html>`,
      "/pricing": `<html><body><h1>Pricing</h1><p>Root canal from Rs 4,500. Braces from Rs 35,000. ${words(40)}</p></body></html>`,
    };
    const body = pages[req.url ?? "/"];
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
    res.end(body ?? "missing");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await api.close();
});

afterEach(() => mock.restoreAll());

const draftJson = JSON.stringify({
  about: "Smile Studio is a family dental clinic in Indore.",
  services: [{ name: "Root canal", description: "Pain-free treatment", price: "from Rs 4,500" }, { name: "Braces", description: "", price: "from Rs 35,000" }],
  timings: "Mon to Sat, 10 AM to 7 PM",
  tone: "warm and plain",
  faqs: "",
});

describe("website inspection", () => {
  it("finds the script by key and drafts a business profile from the live site (Pro)", async () => {
    mock.method(gemini, "completeText", async () => draftJson);
    const acct = await api.signup("inspect", { plan: "pro" });
    embedKey = acct.siteKey;

    const res = await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: base } });
    assert.equal(res.status, 200);
    const i = res.body.inspection;
    assert.equal(i.reachable, true);
    assert.equal(i.scriptFound, true);
    assert.equal(i.keyMatches, true);
    assert.equal(i.pagesRead, 3);
    assert.equal(i.draft.services[0].name, "Root canal");
    assert.equal(i.draft.timings, "Mon to Sat, 10 AM to 7 PM");
    assert.equal(i.draft.services.every((s: any) => s.hidePrice === false), true);
  });

  it("still tells Free accounts whether the script is installed, without spending AI on a draft", async () => {
    const spy = mock.method(gemini, "completeText", async () => draftJson);
    const acct = await api.signup("inspect_free");
    embedKey = "some-other-key";
    const res = await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: base } });
    const i = res.body.inspection;
    assert.equal(i.scriptFound, true);
    assert.equal(i.keyMatches, false);
    assert.equal(i.draft, null);
    assert.equal(i.draftSkipped, "not_pro");
    assert.equal(spy.mock.callCount(), 0);
  });

  it("copes with AI trouble, bad addresses and unreachable sites", async () => {
    const acct = await api.signup("inspect_bad", { plan: "pro" });
    embedKey = acct.siteKey;

    mock.method(gemini, "completeText", async () => {
      throw new Error("busy");
    });
    const down = (await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: base } })).body.inspection;
    assert.equal(down.draft, null);
    assert.equal(down.draftSkipped, "ai_unavailable");
    assert.equal(down.keyMatches, true);

    mock.restoreAll();
    mock.method(gemini, "completeText", async () => "not json at all");
    assert.equal((await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: base } })).body.inspection.draftSkipped, "ai_unavailable");

    assert.equal((await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: {} })).body.error, "missing_url");
    assert.equal((await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: "file:///etc/passwd" } })).body.error, "url_not_allowed");
    const gone = (await api.call("POST", "/api/sites/me/inspect", { token: acct.token, body: { url: "http://127.0.0.1:9" } })).body.inspection;
    assert.equal(gone.reachable, false);
    assert.equal(gone.scriptFound, false);
  });
});
