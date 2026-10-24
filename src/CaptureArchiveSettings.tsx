import React, { useEffect, useState } from "react";
import { api } from "./api";
type Archive = { enabled: boolean; directory: string };
export function CaptureArchiveSettings({
  value,
  onChange,
  onError,
}: {
  value: Archive;
  onChange: (next: Archive) => void;
  onError: (error: unknown) => void;
}) {
  const [status, setStatus] = useState<{
      bytes: number;
      files: number;
      directory: string;
    } | null>(null),
    [error, setError] = useState("");
  const refresh = async () => {
    try {
      setStatus(await api("desktop.captureArchive.status"));
      setError("");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Archive folder could not be read.",
      );
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section
      className="settings-section capture-archive-settings"
      aria-label="Screenshot archive"
      style={{ margin: "20px 0" }}
    >
      <h3>Screenshot archive</h3>
      <p className="field-help">
        Optionally save every desktop screenshot as a PNG in a folder you
        choose. Files stay on this computer and are readable by anyone with
        access to that folder. Limit: 200 MB of LensDesk captures; move or
        remove older files to free space.
      </p>
      <p className="field-help">
        {value.directory || "No archive folder selected."}
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={async () => {
          try {
            const result = await api("desktop.captureArchive.choose");
            if (!result.canceled)
              onChange({ ...value, directory: result.directory });
          } catch (error) {
            onError(error);
          }
        }}
      >
        Choose archive folder
      </button>
      <label className="checkbox-row">
        <input
          type="checkbox"
          aria-label="Save screenshots to disk"
          disabled={!value.directory}
          checked={value.enabled}
          onChange={(event) =>
            onChange({ ...value, enabled: event.target.checked })
          }
        />
        <span>Save screenshots to disk</span>
      </label>
      <p className="field-help">
        Save Desktop Settings to apply the folder and save preference. Existing
        files are retained when you turn saving off.
      </p>
      <div className="toggle-row">
        <button
          type="button"
          className="text-button"
          disabled={!status?.directory}
          onClick={() => api("desktop.captureArchive.open").catch(onError)}
        >
          Open screenshot archive
        </button>
        <button type="button" className="text-button" onClick={refresh}>
          Refresh archive usage
        </button>
      </div>
      {error ? (
        <p role="status" className="field-help">
          {error}
        </p>
      ) : (
        status && (
          <p role="status" className="field-help">
            {status.files} saved captures ·{" "}
            {(status.bytes / 1024 / 1024).toFixed(2)} MB used
          </p>
        )
      )}
    </section>
  );
}
