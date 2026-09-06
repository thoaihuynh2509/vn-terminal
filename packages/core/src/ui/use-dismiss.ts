"use client";

import { useEffect, type RefObject } from "react";

/**
 * Close a popover on Escape or on a click outside `ref`. Shared by every menu
 * on the site so they all dismiss the same way.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, close, ref]);
}
