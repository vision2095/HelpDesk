const fs = require("node:fs");
const path = require("node:path");
function createCloudClient({
  directory,
  encrypt,
  decrypt,
  fetchImpl = globalThis.fetch,
  defaultUrl = process.env.LENSDESK_SERVER_URL ||
    process.env.PUBLIC_URL ||
    "http://127.0.0.1:4319",
}) {
  const file = path.join(directory, "cloud.json");
  let config = { url: "", token: "", refreshToken: "" };
  let revision = 0,
    configurationError = "";
  function normalizeUrl(url) {
    if (!url) return "";
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !(
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
      )
    )
      throw new Error(
        "Use an HTTPS server origin without a path, or localhost for development.",
      );
    return parsed.origin;
  }
  if (fs.existsSync(file)) {
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      configurationError =
        "Saved cloud connection could not be read. Reconnect your server and sign in. Your local workspace is available.";
    }
    let savedUrl = "";
    if (saved && typeof saved === "object") {
      try {
        if (saved.url) savedUrl = normalizeUrl(saved.url);
      } catch {}
    }
    if (!savedUrl && defaultUrl) {
      try {
        savedUrl = normalizeUrl(defaultUrl);
      } catch {}
    }
    if (saved && typeof saved === "object") {
      try {
        const refreshToken = saved.refreshToken
          ? decrypt(Buffer.from(saved.refreshToken, "base64"))
          : "";
        const token = saved.token
          ? decrypt(Buffer.from(saved.token, "base64"))
          : "";
        config = {
          url: savedUrl,
          token,
          refreshToken,
          desktopSessionId: saved.desktopSessionId || "",
          tokenIssuedAt: Number(saved.tokenIssuedAt || 0),
        };
      } catch {
        configurationError =
          "Saved cloud connection could not be read. Reconnect your server and sign in. Your local workspace is available.";
        config = {
          url: savedUrl,
          token: "",
          refreshToken: "",
          desktopSessionId: "",
          tokenIssuedAt: 0,
        };
      }
    } else {
      config = { url: savedUrl, token: "", refreshToken: "" };
    }
  } else if (defaultUrl) {
    try {
      config.url = normalizeUrl(defaultUrl);
    } catch {}
  }
  function persist(next = config) {
    const value = {
      url: next.url,
      token: next.token ? encrypt(next.token).toString("base64") : "",
      refreshToken: next.refreshToken
        ? encrypt(next.refreshToken).toString("base64")
        : "",
      desktopSessionId: next.desktopSessionId || "",
      tokenIssuedAt: next.tokenIssuedAt || 0,
    };
    fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  }
  return {
    configure(url) {
      const origin = normalizeUrl(url);
      const next = {
        url: origin,
        token: origin === config.url ? config.token : "",
      };
      persist(next);
      config = next;
      revision++;
      configurationError = "";
      return { serverUrl: config.url, user: null };
    },
    async request(action, payload = {}, options = {}) {
      if (!config.url && defaultUrl) {
        try {
          config.url = normalizeUrl(defaultUrl);
        } catch {}
      }
      if (!config.url) {
        if (action === "cloud.state")
          return {
            user: null,
            serverUrl: "",
            ...(configurationError ? { configurationError } : {}),
          };
        throw new Error("Connect your hosted server first.");
      }
      if (
        ![
          "auth.login",
          "auth.mfa",
          "auth.register",
          "auth.logout",
          "auth.verify",
          "auth.resend",
          "auth.reset.request",
          "auth.reset",
          "state",
          "workspace.list",
          "session.get",
          "session.search",
          "session.patch",
          "transcript.append",
          "sync.changes",
          "recovery.snapshots",
          "recovery.restore",
          "history.list",
          "history.restore",
          "settings.save",
          "profile.save",
          "profile.delete",
          "session.save",
          "session.delete",
          "key.save",
          "key.delete",
          "chat",
          "chat.cancel",
          "model.list",
          "model.test",
          "transcribe",
          "cloud.public",
          "cloud.state",
          "cloud.push",
          "cloud.pull",
          "billing.checkout",
          "billing.reconcile",
          "billing.portal",
          "billing.price",
          "account.delete",
          "account.sessions",
          "account.audit",
          "account.session.revoke",
          "account.sessions.revokeOthers",
          "account.password",
          "account.mfa.status",
          "account.mfa.begin",
          "account.mfa.confirm",
          "account.mfa.disable",
          "desktop.login",
          "desktop.mfa",
          "desktop.logout",
          "desktop.refresh",
          "desktop.heartbeat",
          "purchase.checkout",
          "purchase.reconcile",
          "purchase.history",
          "account.entitlement",
          "account.desktops",
          "account.desktop.revoke",
          "admin.overview",
          "admin.users",
          "admin.user",
          "admin.entitlement.grant",
          "admin.entitlement.revoke",
          "admin.entitlement.extend",
          "admin.entitlement.setExpiration",
          "admin.payment.refund",
          "admin.user.suspend",
          "admin.user.unsuspend",
          "admin.desktop.revoke",
          "admin.audit",
        ].includes(action)
      )
        throw new Error("Unknown cloud action.");
      if (action === "cloud.state" && !config.token)
        return {
          user: null,
          serverUrl: config.url,
          ...(configurationError ? { configurationError } : {}),
        };
      const requested = { ...config },
        requestRevision = revision;
      if (action === "auth.logout" || action === "desktop.logout") {
        const next = { ...config, token: "", refreshToken: "", desktopSessionId: "" };
        persist(next);
        config = next;
        revision++;
        try {
          const result = await fetchImpl(requested.url + "/api/" + action, {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              "X-LensDesk-Client": "desktop",
              ...(requested.token
                ? { Authorization: "Bearer " + requested.token }
                : {}),
            },
            body: "{}",
            signal: AbortSignal.timeout(5000),
          });
          return { ok: true, serverRevoked: result.ok };
        } catch {
          return { ok: true, serverRevoked: false };
        }
      }
      let response;
      try {
        response = await fetchImpl(requested.url + "/api/" + action, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "X-LensDesk-Client": "desktop",
            ...(requested.token
              ? { Authorization: "Bearer " + requested.token }
              : {}),
          },
          body: JSON.stringify({
            ...payload,
            ...(action === "chat" && options.onEvent ? { stream: true } : {}),
          }),
          signal: AbortSignal.any([
            ...(options.signal ? [options.signal] : []),
            AbortSignal.timeout(
              ["cloud.state", "state"].includes(action) ? 5000 : 90000,
            ),
          ]),
        });
      } catch {
        if (options.signal?.aborted) throw new Error("Request canceled.");
        throw new Error(
          "Could not reach your cloud server. Check the server address and your connection.",
        );
      }
      if (requestRevision !== revision)
        throw new Error(
          "Cloud connection changed during this request. Retry using the current connection.",
        );
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const { readEventStream } = await import("../server/event-stream.mjs");
        return readEventStream(response, options.onEvent, options.signal);
      }
      let data;
      try {
        data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid response");
      } catch {
        throw new Error("The cloud server returned an invalid response.");
      }
      if (requestRevision !== revision)
        throw new Error(
          "Cloud connection changed during this request. Retry using the current connection.",
        );
      if (!response.ok) {
        if (response.status === 401 && config.token) {
          const next = {
            ...config,
            token: "",
            refreshToken: "",
            desktopSessionId: "",
          };
          persist(next);
          config = next;
          revision++;
        }
        const error = new Error(data.error || "Cloud request failed.");
        error.code = data.code;
        error.current = data.current;
        error.existing = data.existing;
        error.purchaseUrl = data.purchaseUrl;
        error.status = response.status;
        throw error;
      }
      if (
        ["auth.login", "auth.register", "auth.mfa"].includes(action) &&
        data.user &&
        !data.token
      )
        throw new Error(
          "The server did not issue a desktop session. Update the hosted server, then sign in again.",
        );
      if (
        data.token &&
        [
          "auth.login",
          "auth.register",
          "auth.mfa",
          "account.password",
        ].includes(action)
      ) {
        const next = { ...config, token: data.token };
        persist(next);
        config = next;
        revision++;
      }
      // Desktop session tokens rotate and are persisted encrypted in the
      // OS-backed store; they are never handed to the renderer.
      if (
        data.accessToken &&
        ["desktop.login", "desktop.mfa", "desktop.refresh"].includes(action)
      ) {
        const next = {
          ...config,
          token: data.accessToken,
          refreshToken: data.refreshToken || config.refreshToken,
          desktopSessionId: data.session?.id || null,
          tokenIssuedAt: Date.now(),
        };
        persist(next);
        config = next;
      }
      delete data.accessToken;
      delete data.refreshToken;
      delete data.token;
      if (
        action === "account.delete" ||
        data.signedOut ||
        (action === "cloud.state" && !data.user)
      ) {
        const next = {
          ...config,
          token: "",
          refreshToken: "",
          desktopSessionId: "",
        };
        persist(next);
        config = next;
        revision++;
      }
      return data;
    },
    // Read-only views and rotation helpers for the main-process gate
    // service. Credentials stay inside the main process.
    tokens() {
      const serverUrl =
        config.url || (defaultUrl ? normalizeUrl(defaultUrl) : "");
      return {
        hasSession: Boolean(config.token && config.refreshToken),
        token: config.token,
        refreshToken: config.refreshToken,
        desktopSessionId: config.desktopSessionId || "",
        tokenIssuedAt: config.tokenIssuedAt || 0,
        serverUrl,
      };
    },
    replaceTokens({ token, refreshToken, desktopSessionId, tokenIssuedAt }) {
      config = {
        ...config,
        token,
        refreshToken,
        desktopSessionId: desktopSessionId || null,
        tokenIssuedAt: tokenIssuedAt || Date.now(),
      };
      persist(config);
    },
    clearDesktopCredentials() {
      const next = {
        ...config,
        token: "",
        refreshToken: "",
        desktopSessionId: "",
      };
      persist(next);
      config = next;
      revision++;
    },
  };
}
module.exports = { createCloudClient };
