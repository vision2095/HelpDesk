import React from "react";
import { CaptureError } from "./useCapture";

export interface PermissionBannerProps {
  error: CaptureError | null;
  onOpenSettings?: () => void;
  onRestart?: () => void;
}

export const PermissionBanner: React.FC<PermissionBannerProps> = ({
  error,
  onOpenSettings,
  onRestart,
}) => {
  if (!error) return null;

  const handleOpenSettings = () => {
    if (onOpenSettings) onOpenSettings();
    const lens = (window as any).lens;
    if (typeof lens?.openScreenSettings === "function") {
      lens.openScreenSettings();
    } else if (typeof lens?.invoke === "function") {
      lens.invoke("desktop.openScreenSettings").catch(() => {});
    }
  };

  const handleRestart = () => {
    if (onRestart) onRestart();
    const lens = (window as any).lens;
    if (typeof lens?.relaunch === "function") {
      lens.relaunch();
    } else if (typeof lens?.invoke === "function") {
      lens.invoke("desktop.restart").catch(() => {});
    }
  };

  if (error.code === "PERMISSION_REQUIRED") {
    return (
      <div className="permission-banner permission-required bg-amber-500/10 border border-amber-500/30 text-amber-200 px-4 py-2 rounded flex items-center justify-between my-2">
        <span>Screen recording permission required.</span>
        <div className="flex gap-2">
          <button
            onClick={handleOpenSettings}
            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs"
          >
            Open Settings
          </button>
          <button
            onClick={handleRestart}
            className="px-2.5 py-1 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-xs"
          >
            Restart
          </button>
        </div>
      </div>
    );
  }

  if (error.code === "RESTART_REQUIRED") {
    return (
      <div className="permission-banner restart-required bg-sky-500/10 border border-sky-500/30 text-sky-200 px-4 py-2 rounded flex items-center justify-between my-2">
        <span>Restart LensDesk to apply updated screen permissions.</span>
        <button
          onClick={handleRestart}
          className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs"
        >
          Restart
        </button>
      </div>
    );
  }

  return (
    <div className="permission-banner error-code bg-red-500/10 border border-red-500/30 text-red-200 px-4 py-2 rounded my-2 text-xs">
      Capture error: {error.code} ({error.status})
    </div>
  );
};

export default PermissionBanner;
// Decision: Distinct banners guide macOS TCC permission flow and relaunch.
