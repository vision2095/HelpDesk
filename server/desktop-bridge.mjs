/** Connect local-first desktop storage to account-funded hosted AI without exposing credentials. */
export function createDesktopBridge({ service, cloud }) {
  const pending = new Set();
  let remoteState = null,
    checkedAt = 0;
  async function remote(force = false) {
    if (!force && Date.now() - checkedAt < 30000) return remoteState;
    checkedAt = Date.now();
    try {
      const account = await cloud.request("cloud.state");
      remoteState = account.user ? await cloud.request("state") : null;
    } catch {
      remoteState = null;
    }
    return remoteState;
  }
  return {
    close() {
      service.close?.();
    },
    invalidate() {
      checkedAt = 0;
      remoteState = null;
    },
    async dispatch(action, payload = {}, options = {}) {
      if (action === "state") {
        const local = await service.dispatch("state"),
          hosted = await remote();
        return {
          ...local,
          cloudConnected: Boolean(hosted),
          keys: hosted
            ? Object.fromEntries(
                Object.keys(local.keys).map((p) => [
                  p,
                  local.keys[p] || hosted.keys[p],
                ]),
              )
            : local.keys,
        };
      }
      if (
        ["session.save", "session.delete"].includes(action) &&
        pending.has(payload.id)
      )
        throw new Error(
          "Wait for the current answer before updating this session.",
        );
      if (action === "backup.restore" && pending.size)
        throw new Error(
          "Wait for the current answer before restoring a workspace.",
        );
      if (["model.list", "model.test"].includes(action)) {
        if (payload.provider === "local")
          return service.dispatch(action, payload, options);
        if (await service.dispatch("key.owned", { provider: payload.provider }))
          return service.dispatch(action, payload, options);
        const hosted = await remote(true);
        return hosted
          ? cloud.request(action, payload, options)
          : service.dispatch(action, payload, options);
      }
      if (action !== "chat" && action !== "transcribe")
        return service.dispatch(action, payload, options);
      const local = await service.dispatch("state"),
        provider =
          action === "chat"
            ? local.settings.provider
            : local.settings.transcriptionProvider;
      if (action === "chat" && provider === "local")
        return service.dispatch(action, payload, options);
      if (await service.dispatch("key.owned", { provider }))
        return service.dispatch(action, payload, options);
      const hosted = await remote(true);
      if (!hosted) return service.dispatch(action, payload, options);
      if (action === "transcribe") {
        await cloud.request("settings.save", {
          ...local.settings,
          version: hosted.settings.version,
        });
        return cloud.request("transcribe", payload);
      }
      const session = local.sessions.find((s) => s.id === payload.sessionId);
      if (!session) throw new Error("Session not found.");
      if (pending.has(session.id))
        throw new Error("An answer is already in progress.");
      pending.add(session.id);
      try {
        const profile = local.profiles.find((p) => p.id === session.profileId);
        if (profile)
          await cloud.request("profile.save", {
            ...profile,
            version:
              hosted.profiles.find((p) => p.id === profile.id)?.version || 0,
          });
        await cloud.request("settings.save", {
          ...local.settings,
          version: hosted.settings.version,
        });
        const existing = hosted.sessions.find((s) => s.id === session.id);
        const messages = existing
          ? [
              ...new Map(
                [...existing.messages, ...session.messages].map((m) => [
                  m.id,
                  m,
                ]),
              ).values(),
            ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          : session.messages;
        await cloud.request("session.save", {
          ...session,
          messages,
          version: existing?.version || 0,
        });
        const result = await cloud.request("chat", payload, options);
        const saved = await service.dispatch("session.applyRemote", {
          session: result,
          expectedVersion: session.version,
        });
        checkedAt = 0;
        return saved;
      } finally {
        pending.delete(session.id);
      }
    },
  };
}
