import type { Settings, State } from "./types";

/** Serialize local changes, retain the server revision, and reject remote edits to the same field. */
export function createSettingsWriter({
  getBase,
  read,
  save,
  onSaved,
}: {
  getBase: () => Settings;
  read: () => Promise<State>;
  save: (settings: Settings) => Promise<State>;
  onSaved: (state: State, patch: Partial<Settings>, base: Settings) => void;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    write(changes: Partial<Settings>) {
      const patch = { ...changes };
      delete patch.version;
      const task = queue.then(async () => {
        const base = { ...getBase() },
          latest = await read();
        for (const field of Object.keys(patch) as (keyof Settings)[]) {
          if (
            latest.settings[field] !== base[field] &&
            latest.settings[field] !== patch[field]
          )
            throw new Error(
              "These settings changed on another device. Reload Settings before applying this change.",
            );
        }
        const next = await save({ ...latest.settings, ...patch });
        onSaved(next, patch, base);
        return next;
      });
      queue = task.catch(() => {});
      return task;
    },
    async flush() {
      await queue;
    },
  };
}
