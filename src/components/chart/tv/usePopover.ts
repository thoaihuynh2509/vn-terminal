"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useDismiss } from "@/lib/ui/use-dismiss";

/** Where a popover opens against its trigger. */
export type Anchor = "below-start" | "below-end" | "above-start";

const GAP = 4;
const EDGE = 8;

/**
 * A toolbar popover, dismissed like every menu on the site.
 *
 * The toolbars scroll sideways on a narrow screen, and a scroller clips anything absolutely positioned
 * inside it, so the popover is fixed to the viewport at its trigger and closes when the page moves
 * under it. Closing hands focus back to the trigger when it was inside: the element that had it is
 * gone, and focus would otherwise fall to the page.
 */
export function usePopover<T extends HTMLElement = HTMLButtonElement>(anchor: Anchor = "below-start", width = 0) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<CSSProperties>({});
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<T>(null);
  const close = useCallback(() => {
    const inside = !!wrap.current?.contains(document.activeElement);
    // A modal popover leaves its trigger inert until it has closed.
    wrap.current?.querySelector("dialog")?.close();
    setOpen(false);
    if (inside) trigger.current?.focus();
  }, []);
  const show = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const vw = window.innerWidth;
      const left = Math.max(EDGE, Math.min(r.left, vw - EDGE - width));
      setAt(anchor === "below-end" ? { position: "fixed", top: r.bottom + GAP, right: Math.max(EDGE, vw - r.right) }
        : anchor === "above-start" ? { position: "fixed", bottom: window.innerHeight - r.top + GAP, left }
        : { position: "fixed", top: r.bottom + GAP, left });
    }
    setOpen(true);
  }, [anchor, width]);
  const toggle = useCallback(() => (open ? close() : show()), [open, close, show]);
  useDismiss(wrap, open, close);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && wrap.current?.contains(e.target))) close(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);
  return { open, setOpen, show, toggle, close, wrap, trigger, at };
}

/** Arrow keys, Home and End move between a menu's items, as the menu role promises a screen reader. */
export function menuKeys(e: KeyboardEvent<HTMLElement>): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  if (!items.length) return;
  const i = items.findIndex((x) => x === document.activeElement);
  const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
  if (to === null) return;
  e.preventDefault();
  items[(to + items.length) % items.length].focus({ preventScroll: true });
}

/** A menu's ref: focus lands on the chosen item as it opens, or on the first. */
export function focusMenu(el: HTMLElement | null): void {
  if (!el) return;
  const item = el.querySelector<HTMLElement>('[aria-checked="true"], [aria-current="page"]') ?? el.querySelector<HTMLElement>('[role^="menuitem"]');
  item?.focus({ preventScroll: true });
}

/** A menu's ref when its component keeps its own state: pins it below its wrapper, clear of a scroller's clip. */
export function pinBelow(el: HTMLElement | null): void {
  const r = el?.parentElement?.getBoundingClientRect();
  if (!el || !r) return;
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - el.offsetWidth));
  Object.assign(el.style, { position: "fixed", top: `${r.bottom + GAP}px`, left: `${left}px`, right: "auto" });
}
