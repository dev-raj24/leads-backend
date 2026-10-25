import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import * as mailer from "../src/services/mailer.service";
import { startApi, type Api } from "./helpers";

let api: Api;
let sent: Array<{ to: string; subject: string; text: string }> = [];

const stubMail = () => {
  mock.method(mailer, "isMailConfigured", () => true);
  mock.method(mailer, "sendMail", async (m: (typeof sent)[number]) => {
    sent.push(m);
    return true;
  });
};

const extractToken = (text: string) => new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

before(async () => {
  api = await startApi();
});

after(async () => {
  await api.close();
});

afterEach(() => {
  mock.restoreAll();
  sent = [];
});

describe("forgot / reset password", () => {
  it("emails a working reset link and never reveals whether the email exists", async () => {
    stubMail();
    const { email } = await api.signup("reset");
    await new Promise((r) => setTimeout(r, 200));
    sent = [];

    const known = await api.call("POST", "/api/auth/forgot-password", { body: { email } });
    const unknown = await api.call("POST", "/api/auth/forgot-password", { body: { email: "ghost@example.test" } });
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.status, unknown.status);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, email);

    const token = extractToken(sent[0].text);
    const reset = await api.call("POST", "/api/auth/reset-password", { body: { token, password: "brandnewpass1" } });
    assert.equal(reset.status, 200);

    const oldLogin = await api.call("POST", "/api/auth/login", { body: { email, password: "secret123" } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await api.call("POST", "/api/auth/login", { body: { email, password: "brandnewpass1" } });
    assert.equal(newLogin.status, 200);
  });

  it("rejects a used, wrong or expired token, and enforces the password policy", async () => {
    stubMail();
    const { email } = await api.signup("reset_bad");
    await new Promise((r) => setTimeout(r, 200));
    sent = [];
    await api.call("POST", "/api/auth/forgot-password", { body: { email } });
    const token = extractToken(sent[0].text);

    const weak = await api.call("POST", "/api/auth/reset-password", { body: { token, password: "short" } });
    assert.equal(weak.body.error, "weak_password");

    const wrong = await api.call("POST", "/api/auth/reset-password", { body: { token: "not-a-real-token", password: "brandnewpass1" } });
    assert.equal(wrong.body.error, "invalid_or_expired_token");

    const ok = await api.call("POST", "/api/auth/reset-password", { body: { token, password: "brandnewpass1" } });
    assert.equal(ok.status, 200);

    const reused = await api.call("POST", "/api/auth/reset-password", { body: { token, password: "anotherpass1" } });
    assert.equal(reused.body.error, "invalid_or_expired_token");
  });

  it("does not send an email when mail isn't configured, but still responds ok", async () => {
    const { email } = await api.signup("reset_nomail");
    const res = await api.call("POST", "/api/auth/forgot-password", { body: { email } });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 0);
  });
});

describe("change password (signed in)", () => {
  it("updates the password when the current one is correct", async () => {
    const { token, email } = await api.signup("changepw");

    const res = await api.call("PATCH", "/api/auth/password", {
      token,
      body: { currentPassword: "secret123", newPassword: "brandnewpass1" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);

    const oldLogin = await api.call("POST", "/api/auth/login", { body: { email, password: "secret123" } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await api.call("POST", "/api/auth/login", { body: { email, password: "brandnewpass1" } });
    assert.equal(newLogin.status, 200);
  });

  it("rejects a wrong current password, a weak new one, and requires auth", async () => {
    const { token } = await api.signup("changepw_bad");

    const wrong = await api.call("PATCH", "/api/auth/password", { token, body: { currentPassword: "nope", newPassword: "brandnewpass1" } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, "wrong_current_password");

    const weak = await api.call("PATCH", "/api/auth/password", { token, body: { currentPassword: "secret123", newPassword: "short" } });
    assert.equal(weak.body.error, "weak_password");

    const noAuth = await api.call("PATCH", "/api/auth/password", { body: { currentPassword: "secret123", newPassword: "brandnewpass1" } });
    assert.equal(noAuth.status, 401);
  });
});

describe("change email (signed in)", () => {
  it("updates the email when the current password is correct, and logs in with the new one", async () => {
    const { token } = await api.signup("changeemail");

    const res = await api.call("PATCH", "/api/auth/email", { token, body: { newEmail: "renamed@example.test", currentPassword: "secret123" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, "renamed@example.test");

    const newLogin = await api.call("POST", "/api/auth/login", { body: { email: "renamed@example.test", password: "secret123" } });
    assert.equal(newLogin.status, 200);
  });

  it("rejects a wrong password, an email already in use, and an invalid email", async () => {
    const a = await api.signup("changeemail_a");
    const b = await api.signup("changeemail_b");

    const wrong = await api.call("PATCH", "/api/auth/email", { token: a.token, body: { newEmail: "new@example.test", currentPassword: "nope" } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, "wrong_current_password");

    const taken = await api.call("PATCH", "/api/auth/email", { token: a.token, body: { newEmail: b.email, currentPassword: "secret123" } });
    assert.equal(taken.body.error, "email_in_use");

    const invalid = await api.call("PATCH", "/api/auth/email", { token: a.token, body: { newEmail: "not-an-email", currentPassword: "secret123" } });
    assert.equal(invalid.body.error, "invalid_email");
  });
});
