"use client";

import { useCallback, useRef, useState } from "react";
import { exportFilename, footerText } from "@/lib/chart/export";
import { track } from "@/lib/analytics/posthog";
import type { Dict } from "@/lib/i18n";

/**
 * Copy the link, or save the chart as a picture.
 *
 * The link is whatever the address bar holds, which — since the view now lives
 * in the URL — is the chart actually on screen.
 *
 * The image is drawn from the panes themselves rather than a screenshot API, so
 * it works everywhere and needs no permission. The one hard part is colour: the
 * chart paints with CSS variables and `currentColor`, and an SVG loaded into an
 * `<img>` is isolated from the document, so none of that resolves and the export
 * would come out black. Every element's COMPUTED fill and stroke is copied onto
 * the clone first, which collapses both var() and currentColor to literals.
 */
function freeze(src: SVGSVGElement): SVGSVGElement {
  const clone = src.cloneNode(true) as SVGSVGElement;
  const from = [src, ...Array.from(src.querySelectorAll("*"))];
  const to = [clone, ...Array.from(clone.querySelectorAll("*"))];
  from.forEach((el, i) => {
    const dst = to[i] as SVGElement | undefined;
    if (!dst) return;
    const cs = window.getComputedStyle(el as Element);
    if (cs.fill && cs.fill !== "none") dst.setAttribute("fill", cs.fill);
    if (cs.stroke && cs.stroke !== "none") dst.setAttribute("stroke", cs.stroke);
    if (cs.fontSize) dst.setAttribute("font-size", cs.fontSize);
    // The app ships one family; naming it keeps the export from falling back to
    // a serif that looks nothing like the chart on screen.
    dst.setAttribute("font-family", "Inter, system-ui, sans-serif");
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement> {
  const markup = new XMLSerializer().serializeToString(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg render failed"));
    img.src = url;
  });
}

export function ShareMenu({
  dict,
  getPanes,
  symbol,
  tf,
  /** Null for a tier that bought a clean image. */
  site,
}: {
  dict: Dict;
  getPanes: () => SVGSVGElement[];
  symbol: string;
  tf: string;
  site: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      track("chart_shared", { method: "copy_link", symbol });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* a blocked clipboard is not worth an error dialog */
    }
  }, [symbol]);

  const savePng = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const panes = getPanes();
      if (!panes.length) return;

      const images = await Promise.all(panes.map((p) => svgToImage(freeze(p))));
      const width = Math.max(...images.map((i) => i.width));
      const chartHeight = images.reduce((h, i) => h + i.height, 0);
      const foot = footerText({ symbol, tf, at: new Date(), site });
      const footH = foot ? 28 : 0;

      // Rendered at device resolution: a chart exported at CSS pixels looks
      // soft the moment it is opened on a phone.
      const scale = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = (chartHeight + footH) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);

      // The panes are transparent, so the image needs the page's own ground or
      // it saves as a chart floating on black in most viewers.
      const page = window.getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
      ctx.fillStyle = page || "#ffffff";
      ctx.fillRect(0, 0, width, chartHeight + footH);

      let y = 0;
      for (const img of images) {
        ctx.drawImage(img, 0, y, img.width, img.height);
        y += img.height;
      }

      if (foot) {
        const muted = window.getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
        ctx.fillStyle = muted || "#8a8f98";
        ctx.font = "12px Inter, system-ui, sans-serif";
        ctx.fillText(foot, 8, chartHeight + 18);
      }

      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename({ symbol, tf, at: new Date() });
      a.click();
      URL.revokeObjectURL(url);
      track("chart_shared", { method: "image", symbol, tf });
    } catch {
      /* export is a convenience; a failure must not break the chart */
    } finally {
      setBusy(false);
    }
  }, [busy, getPanes, symbol, tf, site]);

  const btn =
    "rounded border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50";

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={copyLink} className={btn} aria-label={dict.chart.shareLink}>
        {copied ? dict.chart.shareCopied : dict.chart.shareLink}
      </button>
      <button type="button" onClick={savePng} disabled={busy} className={btn} aria-label={dict.chart.sharePng}>
        {dict.chart.sharePng}
      </button>
    </span>
  );
}
