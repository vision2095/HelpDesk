/** Connect local-first desktop storage to account-funded hosted AI without exposing credentials. */
export function createDesktopBridge({ service, cloud }) {
  const pending = new Set();
  let remoteState = null,
    checkedAt = 0;

  async function remote(force = false) {
    if (!force && Date.now() - checkedAt < 30000 && remoteState) return remoteState;
    checkedAt = Date.now();
    try {
      const account = await cloud.request("cloud.state");
      remoteState = account?.user ? await cloud.request("state") : null;
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
        const local = await service.dispatch("state");
        const hosted = await remote();
        if (!hosted) {
          return {
            ...local,
            cloudConnected: false,
          };
        }

        // Merge keys and owned keys
        const mergedKeys = {
          ...(local.keys || {}),
          ...(hosted.keys || {}),
        };
        const mergedOwnedKeys = {
          ...(local.ownedKeys || {}),
          ...(hosted.ownedKeys || {}),
        };

        // Determine effective provider & model:
        // If local provider does not have a key, but hosted does (e.g. user added Gemini on web),
        // adopt the hosted provider and model seamlessly.
        let effectiveSettings = { ...local.settings };
        const localHasKey = Boolean(local.keys?.[local.settings?.provider] || local.ownedKeys?.[local.settings?.provider]);
        const hostedHasKey = Boolean(hosted.keys?.[hosted.settings?.provider] || hosted.ownedKeys?.[hosted.settings?.provider]);

        if (!localHasKey && hostedHasKey) {
          effectiveSettings.provider = hosted.settings.provider;
          effectiveSettings.model = hosted.settings.model;
        } else if (!localHasKey) {
          // If neither current local nor current hosted matches, check if any provider in mergedKeys has a key
          const anyActiveProvider = Object.keys(mergedKeys).find((p) => Boolean(mergedKeys[p]));
          if (anyActiveProvider && anyActiveProvider !== "local") {
            effectiveSettings.provider = anyActiveProvider;
            if (hosted.settings?.provider === anyActiveProvider) {
              effectiveSettings.model = hosted.settings.model;
            }
          }
        }

        // Adopt hosted systemPrompt if hosted has custom instructions and local is blank/default
        if (
          hosted.settings?.systemPrompt &&
          hosted.settings.systemPrompt !== local.settings?.systemPrompt &&
          (!local.settings?.systemPrompt ||
            local.settings.systemPrompt.startsWith("Give clear, practical answers"))
        ) {
          effectiveSettings.systemPrompt = hosted.settings.systemPrompt;
        }

        // Merge profiles: prefer hosted custom profiles combined with local
        const profileMap = new Map();
        for (const p of hosted.profiles || []) profileMap.set(p.id, p);
        for (const p of local.profiles || []) profileMap.set(p.id, p);
        const mergedProfiles = Array.from(profileMap.values());

        // Merge sessions: combine hosted and local sessions by id
        const sessionMap = new Map();
        for (const s of hosted.sessions || []) sessionMap.set(s.id, s);
        for (const s of local.sessions || []) sessionMap.set(s.id, s);
        const mergedSessions = Array.from(sessionMap.values()).sort(
          (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""),
        );

        return {
          ...local,
          settings: effectiveSettings,
          cloudConnected: true,
          keys: mergedKeys,
          ownedKeys: mergedOwnedKeys,
          profiles: mergedProfiles,
          sessions: mergedSessions,
        };
      }

      if (action === "key.save") {
        const localResult = await service.dispatch("key.save", payload, options);
        try {
          await cloud.request("key.save", payload, options);
        } catch {}
        checkedAt = 0;
        remoteState = null;
        return localResult;
      }

      if (action === "settings.save") {
        const { version, ...cleanPayload } = payload || {};
        await service.dispatch("settings.save", cleanPayload, options);
        try {
          await cloud.request("settings.save", cleanPayload, options);
        } catch {}
        checkedAt = 0;
        remoteState = null;
        return this.dispatch("state");
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

      const local = await service.dispatch("state");
      let provider =
        action === "chat"
          ? local.settings.provider
          : local.settings.transcriptionProvider;

      if (action === "chat" && provider === "local")
        return service.dispatch(action, payload, options);

      if (await service.dispatch("key.owned", { provider }))
        return service.dispatch(action, payload, options);

      const hosted = await remote(true);
      if (!hosted) return service.dispatch(action, payload, options);

      // Determine active provider for cloud chat:
      // If local.settings.provider has no key in hosted, but hosted has a key configured for its provider (e.g. Gemini),
      // use the configured provider so the chat never fails on a missing key.
      if (action === "chat") {
        const hasKeyForCurrent = Boolean(hosted.keys?.[provider] || hosted.ownedKeys?.[provider]);
        if (!hasKeyForCurrent) {
          if (hosted.keys?.[hosted.settings?.provider] || hosted.ownedKeys?.[hosted.settings?.provider]) {
            provider = hosted.settings.provider;
          } else {
            const anyActive = Object.keys(hosted.keys || {}).find(
              (p) => Boolean(hosted.keys[p] || hosted.ownedKeys?.[p]),
            );
            if (anyActive) provider = anyActive;
          }
        }
      }

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

        const activeModel =
          provider === hosted.settings.provider
            ? hosted.settings.model
            : local.settings.model;

        await cloud.request("settings.save", {
          ...hosted.settings,
          ...local.settings,
          provider,
          model: activeModel,
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
