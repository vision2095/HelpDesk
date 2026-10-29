import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Camera,
  Keyboard,
  RotateCcw,
  Eye,
  Crop,
  Search,
  Sliders,
  X,
} from "lucide-react";
import { radialSlotAt } from "./mouse-gestures.mjs";
export interface RadialSlot {
  id: number;
  action: string;
  label: string;
  icon?: string;
}
export interface RadialActionWheelProps {
  visible: boolean;
  onClose: () => void;
  onSelectAction: (action: string) => void;
  slotsCount?: 4 | 6 | 8;
  size?: number;
  opacity?: number;
  style?: "wheel" | "flick";
  slotActions?: Record<number, string>;
  mousePosition?: { x: number; y: number } | null;
  triggerButton?: number;
}
const ACTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  getAnswer: { label: "Get Answer", icon: <Sparkles size={22} /> },
  capture: { label: "Capture", icon: <Camera size={22} /> },
  autoType: { label: "Type", icon: <Keyboard size={22} /> },
  undo: { label: "Undo Shot", icon: <RotateCcw size={22} /> },
  hide: { label: "Hide/Show", icon: <Eye size={22} /> },
  snip: { label: "Snip", icon: <Crop size={22} /> },
  browser: { label: "Browser", icon: <Search size={22} /> },
  settings: { label: "Settings", icon: <Sliders size={22} /> },
};
export const DEFAULT_RADIAL_MAPPINGS: Record<number, string> = {
  1: "getAnswer",
  2: "capture",
  3: "autoType",
  4: "undo",
  5: "hide",
  6: "snip",
  7: "browser",
  8: "settings",
};
export function RadialActionWheel({
  visible,
  onClose,
  onSelectAction,
  slotsCount = 6,
  size = 100,
  opacity = 85,
  style = "wheel",
  slotActions = DEFAULT_RADIAL_MAPPINGS,
  mousePosition,
  triggerButton,
}: RadialActionWheelProps) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [position, setPosition] = useState({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  const handlers = useRef({ onClose, onSelectAction });
  handlers.current = { onClose, onSelectAction };
  const released = useRef(false);
  const scale = Math.max(50, Math.min(150, Number(size) || 100)) / 100;
  const outer = 135 * scale,
    inner = 45 * scale;
  const count = [4, 6, 8].includes(slotsCount) ? slotsCount : 6;
  useEffect(() => {
    if (!visible) return;
    setPosition(
      mousePosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    );
    setActiveSlot(null);
    released.current = false;
  }, [visible, mousePosition?.x, mousePosition?.y]);
  useEffect(() => {
    if (!visible) return;
    const pick = (x: number, y: number) =>
      radialSlotAt({ x, y, center: position, slots: count, size, style });
    const move = (event: MouseEvent) =>
      setActiveSlot(pick(event.clientX, event.clientY));
    const release = (event: MouseEvent) => {
      if (
        released.current ||
        (triggerButton !== undefined &&
          event.button !== triggerButton &&
          event.button !== 0)
      )
        return;
      released.current = true;
      event.preventDefault();
      const slot = pick(event.clientX, event.clientY);
      const action =
        slot === null
          ? undefined
          : slotActions[slot] || DEFAULT_RADIAL_MAPPINGS[slot];
      if (action && ACTION_META[action])
        handlers.current.onSelectAction(action);
      handlers.current.onClose();
    };
    const cancel = () => {
      if (!released.current) {
        released.current = true;
        handlers.current.onClose();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", release);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", release);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, [
    visible,
    position.x,
    position.y,
    count,
    size,
    style,
    slotActions,
    triggerButton,
  ]);
  if (!visible) return null;
  const select = (slot: number) => {
    if (released.current) return;
    released.current = true;
    const action = slotActions[slot] || DEFAULT_RADIAL_MAPPINGS[slot];
    if (action && ACTION_META[action]) onSelectAction(action);
    onClose();
  };
  const polar = (radius: number, degrees: number) => ({
    x: outer + radius * Math.cos(((degrees - 90) * Math.PI) / 180),
    y: outer + radius * Math.sin(((degrees - 90) * Math.PI) / 180),
  });
  return (
    <div
      className={`radial-wheel-backdrop radial-style-${style}`}
      role="menu"
      aria-label={`Radial action ${style}`}
      onContextMenu={(event) => event.preventDefault()}
      style={{ opacity: Math.max(10, Math.min(100, opacity)) / 100 }}
    >
      <div
        className="radial-wheel-center"
        style={{
          left: position.x,
          top: position.y,
          width: outer * 2,
          height: outer * 2,
          transform: "translate(-50%, -50%)",
        }}
      >
        <svg
          className="radial-wheel-svg"
          width={outer * 2}
          height={outer * 2}
          viewBox={`0 0 ${outer * 2} ${outer * 2}`}
        >
          {Array.from({ length: count }, (_, index) => {
            const slot = index + 1,
              start = (index * 360) / count - 180 / count,
              end = start + 360 / count;
            const points = [
              polar(outer, start),
              polar(outer, end),
              polar(inner, end),
              polar(inner, start),
            ];
            const path = `M ${points[0].x} ${points[0].y} A ${outer} ${outer} 0 0 1 ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} A ${inner} ${inner} 0 0 0 ${points[3].x} ${points[3].y} Z`;
            const point = polar((inner + outer) / 2, (index * 360) / count);
            const meta = ACTION_META[
              slotActions[slot] || DEFAULT_RADIAL_MAPPINGS[slot]
            ] || { label: `Slot ${slot}`, icon: <Sparkles size={22} /> };
            return (
              <g
                key={slot}
                role="menuitem"
                aria-label={meta.label}
                tabIndex={0}
                className={`radial-slice-group ${activeSlot === slot ? "active" : ""}`}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(slot);
                  }
                }}
              >
                <path
                  d={path}
                  className={`radial-slice ${activeSlot === slot ? "hovered" : ""}`}
                  style={{
                    fill:
                      activeSlot === slot
                        ? "var(--accent, #38bdf8)"
                        : "var(--panel, #192537)",
                    stroke: "var(--line, #475569)",
                  }}
                />
                <foreignObject
                  x={point.x - 42 * scale}
                  y={point.y - 30 * scale}
                  width={84 * scale}
                  height={60 * scale}
                  className="radial-slice-content"
                >
                  <div
                    className={`radial-slot-item ${activeSlot === slot ? "hovered" : ""}`}
                    style={{
                      color: "var(--ink, #e2eaf5)",
                      fontSize: 11 * scale,
                    }}
                  >
                    <div className="radial-slot-icon">{meta.icon}</div>
                    <span className="radial-slot-label">{meta.label}</span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
          <circle
            cx={outer}
            cy={outer}
            r={38 * scale}
            className="radial-hub"
            style={{ fill: "var(--panel, #192537)" }}
          />
        </svg>
        <button
          type="button"
          className="radial-hub-content"
          aria-label="Cancel mouse gesture"
          style={{
            width: 70 * scale,
            height: 70 * scale,
            pointerEvents: "auto",
          }}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
