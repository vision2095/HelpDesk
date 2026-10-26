import { useEffect, useRef } from "react";

export interface GamepadActions {
  onGetAnswer?: () => void;
  onCancelAnswer?: () => void;
  onCaptureScreenshot?: () => void;
  onTypeAnswer?: () => void;
  onUndoShot?: () => void;
  onRegionSnip?: () => void;
  onOpacityUp?: () => void;
  onOpacityDown?: () => void;
  onToggleOverlay?: () => void;
  onToggleKeys?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  onToggleBrowser?: () => void;
}

export function useGamepadController(actions: GamepadActions, enabled = true) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Track button pressed state to prevent auto-repeating on a single press
  const pressedRef = useRef<{ [buttonIndex: number]: boolean }>({});
  const lastPressTime = useRef<{ [buttonIndex: number]: number }>({});

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let animId: number;

    const pollGamepad = () => {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gamepads.find((g) => g && g.connected);

      if (gp) {
        const now = Date.now();
        const handleButton = (btnIdx: number, callback?: () => void, debounceMs = 280) => {
          const isDown = gp.buttons[btnIdx]?.pressed;
          const wasDown = pressedRef.current[btnIdx];

          if (isDown) {
            if (!wasDown || now - (lastPressTime.current[btnIdx] || 0) > debounceMs) {
              lastPressTime.current[btnIdx] = now;
              callback?.();
            }
          }
          pressedRef.current[btnIdx] = isDown;
        };

        // Standard Xbox / XInput Mappings:
        // 0: A (Face Down) -> Get Answer
        handleButton(0, actionsRef.current.onGetAnswer);

        // 1: B (Face Right) -> Stop / Cancel Answer
        handleButton(1, actionsRef.current.onCancelAnswer);

        // 2: X (Face Left) -> Capture Screenshot
        handleButton(2, actionsRef.current.onCaptureScreenshot);

        // 3: Y (Face Up) -> Auto-type Answer
        handleButton(3, actionsRef.current.onTypeAnswer);

        // 4: LB (Left Bumper) -> Undo Shot
        handleButton(4, actionsRef.current.onUndoShot);

        // 5: RB (Right Bumper) -> Snip Region
        handleButton(5, actionsRef.current.onRegionSnip);

        // 6: LT (Left Trigger) -> Opacity Down
        handleButton(6, actionsRef.current.onOpacityDown, 180);

        // 7: RT (Right Trigger) -> Opacity Up
        handleButton(7, actionsRef.current.onOpacityUp, 180);

        // 8: Back / Select / View -> Toggle Cheat Sheet / Keys
        handleButton(8, actionsRef.current.onToggleKeys);

        // 9: Start / Menu -> Toggle Overlay Visibility
        handleButton(9, actionsRef.current.onToggleOverlay);

        // 12: Dpad Up -> Scroll Answer Up
        handleButton(12, actionsRef.current.onScrollUp, 120);

        // 13: Dpad Down -> Scroll Answer Down
        handleButton(13, actionsRef.current.onScrollDown, 120);

        // Right Stick Click (11) -> Toggle In-Overlay Browser
        handleButton(11, actionsRef.current.onToggleBrowser);
      }

      animId = requestAnimationFrame(pollGamepad);
    };

    animId = requestAnimationFrame(pollGamepad);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [enabled]);
}
