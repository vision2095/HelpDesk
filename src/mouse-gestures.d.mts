export interface MouseGestureConfig {
  enabled?: boolean;
  trigger?: "middle" | "right";
  holdMs?: number;
}
export function installMouseGestures(
  target: Window | HTMLElement,
  config: MouseGestureConfig,
  onOpen: (position: { x: number; y: number }) => void,
  onCancel: () => void,
): () => void;
export function radialSlotAt(options: {
  x: number;
  y: number;
  center: { x: number; y: number };
  slots?: 4 | 6 | 8;
  size?: number;
  style?: "wheel" | "flick";
}): number | null;
