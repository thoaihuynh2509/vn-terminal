"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { exportFilename, footerText } from "@/lib/chart/export";
import { encodeTemplate, layoutFromQuery } from "@/lib/chart/layouts";
import { track } from "@/lib/analytics/posthog";
import { focusMenu, menuKeys, usePopover } from "./usePopover";
import type { Dict } from "@/lib/i18n";

/** Copy the link or the setup, or save an image: one menu, so the toolbar still fits a grid cell. */
export function ShareButtons({ dict, symbol, tf, credit, shoot, trigger }: {
  dict: Dict;
  symbol: string;
  tf: string;
  /** False for a tier that bought a clean image. */
  credit: boolean;
  /** The chart as a canvas at device resolution, and its width in CSS pixels. */
  shoot: () => { canvas: HTMLCanvasElement; cssWidth: number } | null;
  /** An icon in place of the text label, as TradingView's camera. */
  trigger?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const { open, toggle, wrap, trigger: menuButton, close, at } = usePopover("below-end");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback(() => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      flash();
      track("chart_shared", { method: "copy_link", symbol });
    } catch {
      /* a blocked clipboard is not worth an error dialog */
    }
  }, [symbol, flash]);

  // The arrangement — symbols, grid, indicators, axis — so the recipient opens the screen that was built.
  const copyTemplate = useCallback(async () => {
    try {
      const l = layoutFromQuery("Shared", symbol, window.location.search, Date.now());
      if (!l) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tpl", encodeTemplate(l));
      await navigator.clipboard.writeText(url.toString());
      flash();
      track("chart_shared", { method: "template", symbol });
    } catch {
      /* a blocked clipboard is not worth an error dialog */
    }
  }, [symbol, flash]);

  const savePng = useCallback(() => {
    const shot = shoot();
    if (!shot) return;
    const { canvas: src, cssWidth } = shot;
    const scale = src.width / (cssWidth || src.width);
    const foot = footerText({ symbol, tf, at: new Date(), site: credit ? window.location.origin : null });
    const footH = foot ? Math.round(28 * scale) : 0;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height + footH;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const css = window.getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--tv-bg").trim();
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    if (foot) {
      ctx.fillStyle = css.getPropertyValue("--tv-text-2").trim();
      ctx.font = `${Math.round(12 * scale)}px ${css.fontFamily || "system-ui, sans-serif"}`;
      ctx.fillText(foot, Math.round(8 * scale), src.height + Math.round(18 * scale));
    }
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename({ symbol, tf, at: new Date() });
      a.click();
      URL.revokeObjectURL(url);
      track("chart_shared", { method: "image", symbol, tf });
    }, "image/png");
  }, [shoot, symbol, tf, credit]);

  const item = "block w-full px-3 py-1.5 text-left text-[13px] text-tv-text hover:bg-tv-hover";
  const btn =
    "rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50";
  return (
    <div ref={wrap} className="relative shrink-0">
      <button ref={menuButton} type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
        aria-label={copied ? dict.chart.shareCopied : dict.chart.share} title={dict.chart.share}
        className={trigger ? "grid h-8 w-8 place-items-center rounded-md hover:bg-tv-hover" : btn}>
        {trigger
          ? (copied ? <span aria-hidden="true" className="text-[15px] font-semibold text-tv-accent-text">✓</span> : trigger)
          : <>{copied ? dict.chart.shareCopied : dict.chart.share} <span aria-hidden="true" className="text-[10px]">▾</span></>}
      </button>
      {/* Always mounted, so the confirmation is announced; a changed button name is not. */}
      <span aria-live="polite" className="sr-only">{copied ? dict.chart.shareCopied : ""}</span>
      {open && (
        <div ref={focusMenu} role="menu" aria-label={dict.chart.share} onKeyDown={menuKeys} style={at}
          className="z-40 w-44 rounded-md border border-tv-border bg-tv-bg py-1 shadow-xl">
          <button type="button" role="menuitem" tabIndex={-1} aria-label={dict.chart.shareLink} onClick={() => { close(); void copyLink(); }} className={item}>
            {dict.chart.shareLink}
          </button>
          <button type="button" role="menuitem" tabIndex={-1} aria-label={dict.chart.shareSetup} onClick={() => { close(); void copyTemplate(); }} className={item}>
            {dict.chart.shareSetup}
          </button>
          <button type="button" role="menuitem" tabIndex={-1} aria-label={dict.chart.sharePng} onClick={() => { close(); savePng(); }} className={item}>
            {dict.chart.sharePng}
          </button>
        </div>
      )}
    </div>
  );
}
