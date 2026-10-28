import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { LensDeskSettingsModal } from "../../src/LensDeskSettingsModal";
import { LensDeskAuthModal } from "../../src/LensDeskAuthModal";
import "../../src/styles.css";
function Fixture() {
  const [settings, setSettings] = useState(
    JSON.parse(localStorage.getItem("modal-settings")!),
  );
  const [open, setOpen] = useState(true),
    [auth, setAuth] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open fixture settings</button>
      <button onClick={() => setAuth(true)}>Open fixture auth</button>
      <output id="closed">{String(!open)}</output>
      <LensDeskSettingsModal
        isOpen={open}
        onClose={() => setOpen(false)}
        initialTab="Model"
        settings={settings}
        onSaveSettings={async (patch) => {
          await window.lens!.invoke("settings.save", patch);
          const next = { ...settings, ...patch };
          setSettings(next);
          localStorage.setItem("modal-settings", JSON.stringify(next));
        }}
        onSaveDesktopPreferences={async (preferences) => {
          await window.lens!.invoke("desktop.preferences.save", preferences);
        }}
      />
      <LensDeskAuthModal
        isOpen={auth}
        onClose={() => setAuth(false)}
        onSuccess={() => {
          (window as any).authSucceeded = true;
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
