"use client";

/**
 * Focus-trap hook for modal dialogs — M24d a11y pass.
 *
 * When `active` is true:
 *   1. Records the element that had focus when the modal opened.
 *   2. Moves focus to the first focusable element inside the modal
 *      container (or the container itself if none exist).
 *   3. Traps Tab / Shift+Tab inside the container.
 *   4. Restores focus to step (1) when `active` flips false.
 *
 * Hand-rolled (no dependency) and tiny on purpose — every modal we
 * have today (Onboarding / PageTour / PromoteToDraft / AddNode) is a
 * simple linear form, so the focusable-element query is enough.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the trap on next frame so children have time to mount.
    const id = window.requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? root).focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (current === first || !root.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (current === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
      previousFocusRef.current?.focus?.();
    };
  }, [active]);

  return ref;
}
