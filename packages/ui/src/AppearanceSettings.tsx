import React from "react";
import type { Settings } from "./types";

export function AppearanceSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  return (
    <fieldset className="appearance-controls">
      <legend>Appearance</legend>
      <p className="field-help">
        Choose readable text colors for each theme and the layout for your
        session. Save settings to apply changes.
      </p>
      <div className="theme-color-fields">
        {(["light", "dark"] as const).map((theme) => {
          const key = theme === "light" ? "lightTextColor" : "darkTextColor";
          return (
            <label key={key}>
              {theme === "light" ? "Light theme text" : "Dark theme text"}
              <div className="theme-color-input">
                <input
                  type="color"
                  aria-label={`${theme} theme text color`}
                  value={
                    settings[key] || (theme === "light" ? "#24384c" : "#e2eaf5")
                  }
                  onChange={(event) =>
                    onChange({ ...settings, [key]: event.target.value })
                  }
                />
                <code>
                  {settings[key] || (theme === "light" ? "#24384c" : "#e2eaf5")}
                </code>
              </div>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="text-button"
        onClick={() =>
          onChange({
            ...settings,
            lightTextColor: "#24384c",
            darkTextColor: "#e2eaf5",
          })
        }
      >
        Reset text colors
      </button>
      <label>
        Session layout
        <select
          aria-label="Session layout"
          value={settings.interviewLayout || "full"}
          onChange={(event) =>
            onChange({
              ...settings,
              interviewLayout: event.target.value as "full" | "compact",
            })
          }
        >
          <option value="full">
            Full — transcript and answers side by side
          </option>
          <option value="compact">
            Compact — single-line transcript, full-width answers
          </option>
        </select>
      </label>
      <p className="field-help">
        Compact keeps audio and transcript controls available. The floating
        window uses the same layout preference.
      </p>
    </fieldset>
  );
}
