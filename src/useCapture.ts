import { useState, useCallback } from "react";

export interface CaptureError {
  code:
    | "PERMISSION_REQUIRED"
    | "RESTART_REQUIRED"
    | "NO_SOURCES"
    | "CAPTURE_FAILED"
    | "OK";
  status: string;
}

export function useCapture() {
  const [error, setError] = useState<CaptureError | null>(null);
  const [loading, setLoading] = useState(false);

  const grab = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    setError(null);
    const lens = (window as any).lens;
    if (!lens) {
      setError({ code: "CAPTURE_FAILED", status: "unsupported" });
      setLoading(false);
      return null;
    }

    try {
      const res = await lens.capture();
      if (res && res.ok && res.dataUrl) {
        setError(null);
        setLoading(false);
        return res.dataUrl;
      }

      const errState: CaptureError = {
        code: res?.code || "CAPTURE_FAILED",
        status: res?.status || "unknown",
      };
      setError(errState);

      if (errState.code === "PERMISSION_REQUIRED") {
        await lens.openScreenSettings?.();
      }

      setLoading(false);
      return null;
    } catch (err: any) {
      const errState: CaptureError = {
        code: "CAPTURE_FAILED",
        status: err?.message || "error",
      };
      setError(errState);
      setLoading(false);
      return null;
    }
  }, []);

  const restart = useCallback(async () => {
    const lens = (window as any).lens;
    await lens?.relaunch?.();
  }, []);

  return { grab, error, loading, restart };
}

export default useCapture;
// Decision: Auto-invoking openScreenSettings on PERMISSION_REQUIRED ensures prompt registration.
