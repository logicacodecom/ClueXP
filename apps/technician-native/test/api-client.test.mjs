import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, CluexpApi } from "../src/api/client.ts";
import { logoutStoredSession } from "../src/features/sessionLifecycle.ts";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function session() {
  return {
    user: { id: "user-1", email: "tech@example.com" },
    roles: ["technician"],
    technician: { id: "tech-1", approved: true }
  };
}

test("concurrent authenticated 401s share one refresh and retry with rotated tokens", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("expired-access", "refresh-one");
  api.configureSessionHandlers({
    onRefresh: async () => undefined,
    onRefreshFailed: async () => assert.fail("refresh should not hard sign out")
  });

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    const authorization = init?.headers instanceof Headers ? init.headers.get("authorization") : null;
    calls.push({ path, authorization, body: init?.body ? JSON.parse(String(init.body)) : null });

    if (path === "/auth/refresh") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(200, {
        access_token: "fresh-access",
        refresh_token: "refresh-two",
        token_type: "bearer",
        session: session()
      });
    }

    if (authorization === "Bearer expired-access") {
      return jsonResponse(401, { detail: "expired" });
    }
    return jsonResponse(200, { ok: true, path, authorization });
  };

  const results = await Promise.all([
    api.readiness(),
    api.activeJobSnapshot(),
    api.offers("tech-1")
  ]);

  assert.equal(calls.filter((call) => call.path === "/auth/refresh").length, 1);
  assert.deepEqual(calls.find((call) => call.path === "/auth/refresh")?.body, { refresh_token: "refresh-one" });
  assert.equal(calls.filter((call) => call.authorization === "Bearer fresh-access").length, 3);
  assert.deepEqual(results.map((result) => result.authorization), [
    "Bearer fresh-access",
    "Bearer fresh-access",
    "Bearer fresh-access"
  ]);
});

test("refresh 401 does not recursively refresh and clears session once through handler", async () => {
  const calls = [];
  let failed = 0;
  const api = new CluexpApi(null);
  api.setSessionTokens("expired-access", "bad-refresh");
  api.configureSessionHandlers({
    onRefresh: async () => assert.fail("refresh should fail"),
    onRefreshFailed: async () => {
      failed += 1;
    }
  });

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === "/auth/refresh") {
      return jsonResponse(401, { detail: { code: "invalid_refresh_token" } });
    }
    return jsonResponse(401, { detail: "expired" });
  };

  await assert.rejects(api.me(), ApiError);

  assert.equal(calls.filter((call) => call.path === "/auth/refresh").length, 1);
  assert.equal(failed, 1);
});

test("logout posts the supplied refresh token without auth retry", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("access", "stored-refresh");

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return jsonResponse(200, { revoked: true });
  };

  const result = await api.logout("stored-refresh");

  assert.deepEqual(result, { revoked: true });
  assert.deepEqual(calls, [{ path: "/auth/logout", body: { refresh_token: "stored-refresh" } }]);
});

test("job operations messages use the technician message contract", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("access", "refresh");

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({
      method: init?.method || "GET",
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    if (path.endsWith("/messages?channel=operations")) {
      return jsonResponse(200, { messages: [] });
    }
    return jsonResponse(200, {
      message: {
        id: "msg-1",
        job_id: "job-1",
        channel: "operations",
        sender_type: "technician",
        body: "Running ten minutes behind",
        client_message_id: "message-1",
        delivery_state: "sent"
      }
    });
  };

  assert.deepEqual(await api.listJobMessages("job-1"), []);
  const result = await api.sendJobMessage("job-1", {
    body: "Running ten minutes behind",
    client_message_id: "message-1"
  });

  assert.equal(result.message.id, "msg-1");
  assert.deepEqual(calls, [
    { method: "GET", path: "/jobs/job-1/messages?channel=operations", body: null },
    {
      method: "POST",
      path: "/jobs/job-1/messages",
      body: {
        channel: "operations",
        body: "Running ten minutes behind",
        client_message_id: "message-1"
      }
    }
  ]);
});

test("job customer messages use template-only customer channel contract", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("access", "refresh");

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({
      method: init?.method || "GET",
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null
    });
    if (path.endsWith("/messages?channel=customer")) {
      return jsonResponse(200, { messages: [] });
    }
    return jsonResponse(200, {
      message: {
        id: "msg-2",
        job_id: "job-1",
        channel: "customer",
        sender_type: "technician",
        template_code: "on_my_way",
        client_message_id: "message-2",
        delivery_state: "sent"
      }
    });
  };

  assert.deepEqual(await api.listJobMessages("job-1", "customer"), []);
  const result = await api.sendJobMessage("job-1", {
    channel: "customer",
    template_code: "on_my_way",
    client_message_id: "message-2"
  });

  assert.equal(result.message.template_code, "on_my_way");
  assert.deepEqual(calls, [
    { method: "GET", path: "/jobs/job-1/messages?channel=customer", body: null },
    {
      method: "POST",
      path: "/jobs/job-1/messages",
      body: {
        channel: "customer",
        template_code: "on_my_way",
        client_message_id: "message-2"
      }
    }
  ]);
});

test("job message thread exposes unread count and mark-read contract", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("access", "refresh");

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({ method: init?.method || "GET", path });
    if (path.endsWith("/messages/read?channel=customer")) {
      return jsonResponse(200, { read_count: 2, read_at: "2026-08-02T12:00:00Z" });
    }
    return jsonResponse(200, { messages: [], unread_count: 2 });
  };

  const thread = await api.listJobMessageThread("job-1", "customer");
  const read = await api.markJobMessagesRead("job-1", "customer");

  assert.deepEqual(thread, { messages: [], unread_count: 2 });
  assert.deepEqual(read, { read_count: 2, read_at: "2026-08-02T12:00:00Z" });
  assert.deepEqual(calls, [
    { method: "GET", path: "/jobs/job-1/messages?channel=customer" },
    { method: "POST", path: "/jobs/job-1/messages/read?channel=customer" }
  ]);
});

test("job masked call request uses scoped call endpoint", async () => {
  const calls = [];
  const api = new CluexpApi(null);
  api.setSessionTokens("access", "refresh");

  globalThis.fetch = async (url, init) => {
    const path = String(url).replace("https://intake.cluexp.com/api", "");
    calls.push({ method: init?.method || "GET", path });
    return jsonResponse(200, {
      available: false,
      message: "Masked calling provider is not configured.",
      call: {
        id: "call-1",
        job_id: "job-1",
        caller_type: "technician",
        callee_type: "customer",
        status: "unavailable",
        provider_status: "skipped_no_provider",
        masked_number: null
      }
    });
  };

  const result = await api.startJobCall("job-1", "customer");

  assert.equal(result.available, false);
  assert.equal(result.call.provider_status, "skipped_no_provider");
  assert.deepEqual(calls, [{ method: "POST", path: "/jobs/job-1/calls/customer" }]);
});

test("stored logout clears local state even when server revoke fails", async () => {
  const events = [];

  await logoutStoredSession({
    api: {
      logout: async (refreshToken) => {
        events.push(`logout:${refreshToken}`);
        throw new Error("offline");
      }
    },
    loadStoredSession: async () => ({
      accessToken: "access",
      refreshToken: "refresh-to-revoke",
      session: session()
    }),
    clearStoredSession: async () => {
      events.push("clear");
    },
    wipeOutbox: async () => {
      events.push("wipe");
    },
    afterLocalClear: () => {
      events.push("state");
    }
  });

  assert.deepEqual(events, ["logout:refresh-to-revoke", "clear", "wipe", "state"]);
});
