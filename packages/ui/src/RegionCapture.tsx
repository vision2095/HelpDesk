import { useEffect, useRef, useState } from "react";

/** Select from a frozen, user-requested screenshot; coordinates use the real image size. */
export function RegionCapture({
  image,
  onCancel,
  onCapture,
}: {
  image: string;
  onCancel: () => void;
  onCapture: (image: string) => Promise<void>;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [region, setRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy, onCancel]);
  const position = (event: React.PointerEvent) => {
    const bounds = imageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  async function confirm() {
    const source = imageRef.current;
    if (!source || !region || region.width < 0.002 || region.height < 0.002)
      return;
    setBusy(true);
    setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(
        1,
        Math.round(region.width * source.naturalWidth),
      );
      canvas.height = Math.max(
        1,
        Math.round(region.height * source.naturalHeight),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image cropping is unavailable.");
      ctx.drawImage(
        source,
        Math.round(region.x * source.naturalWidth),
        Math.round(region.y * source.naturalHeight),
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      await onCapture(canvas.toDataURL("image/png"));
    } catch (error: any) {
      setError(error.message || "Could not crop the screenshot.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" style={{ zIndex: 12000 }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Select screenshot region"
        className="modal"
        style={{ maxWidth: "90vw", width: 1100 }}
      >
        <h2>Select screenshot region</h2>
        <p>
          Drag a rectangle over the image, then attach the selection. Escape
          cancels.
        </p>
        <div
          style={{
            position: "relative",
            width: "fit-content",
            maxWidth: "100%",
            margin: "auto",
            touchAction: "none",
            cursor: "crosshair",
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || busy) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = position(event);
            setRegion(null);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            const end = position(event);
            setRegion({
              x: Math.min(start.current.x, end.x),
              y: Math.min(start.current.y, end.y),
              width: Math.abs(end.x - start.current.x),
              height: Math.abs(end.y - start.current.y),
            });
          }}
          onPointerUp={() => {
            start.current = null;
          }}
          onPointerCancel={() => {
            start.current = null;
            setRegion(null);
          }}
        >
          <img
            ref={imageRef}
            src={image}
            draggable={false}
            alt="Screenshot to crop"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: "65vh",
              userSelect: "none",
            }}
          />
          {region && (
            <div
              data-testid="capture-region"
              style={{
                position: "absolute",
                pointerEvents: "none",
                border: "2px solid #36b7ef",
                background: "#36b7ef22",
                boxSizing: "border-box",
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel selection
          </button>
          <button
            className="primary"
            onClick={confirm}
            disabled={
              busy || !region || region.width < 0.002 || region.height < 0.002
            }
          >
            {busy ? "Attaching…" : "Attach selected region"}
          </button>
        </div>
      </section>
    </div>
  );
}
