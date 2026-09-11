"use client";

import { useCallback, useRef, useState } from "react";
import { exportFilename, footerText } from "@/lib/chart/export";
import { encodeTemplate, layoutFromQuery } from "@/lib/chart/layouts";
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

  /**
   * Share the SETUP rather than the address.
   *
   * A plain link carries whatever the reader is looking at right now; a template
   * carries the arrangement — symbols, grid, indicators, axis — so the recipient
   * opens the screen the sender built, not a default chart of the same symbol.
   * Opening one needs no account and no slot; only saving it does.
   */
  const copyTemplate = useCallback(async () => {
    try {
      const l = layoutFromQuery("Shared", symbol, window.location.search, Date.now());
      if (!l) return;
      const url = new URL(window.location.href);
      url.searchParams.set("tpl", encodeTemplate(l));
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      track("chart_shared", { method: "template", symbol });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      /* a blocked clipboard is not worth an error dialog */
    }
  }, [symbol]);

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
      // A pane's plot is a canvas and an overlay beneath its SVG, clipped to the
      // plot and wider than it; the picture needs all three, placed where they
      // sit on screen, or it exports the axis with nothing on it.
      const plots = await Promise.all(panes.map(async (p) => {
        const wrap = p.parentElement;
        const origin = p.getBoundingClientRect();
        const at = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
        };
        const clip = wrap?.querySelector("[data-plot-clip]") ?? null;
        const layer = wrap?.querySelector<HTMLCanvasElement>("canvas[data-pane-layer]") ?? null;
        const over = wrap?.querySelector<SVGSVGElement>("svg[data-plot-overlay]") ?? null;
        return {
          clip: clip ? at(clip) : null,
          layer: layer ? { el: layer, ...at(layer) } : null,
          over: over ? { img: await svgToImage(freeze(over)), ...at(over) } : null,
        };
      }));
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
      images.forEach((img, i) => {
        const { clip, layer, over } = plots[i];
        ctx.save();
        if (clip) { ctx.beginPath(); ctx.rect(clip.x, y + clip.y, clip.w, clip.h); ctx.clip(); }
        if (layer) ctx.drawImage(layer.el, layer.x, y + layer.y, layer.w, layer.h);
        if (over) ctx.drawImage(over.img, over.x, y + over.y, over.w, over.h);
        ctx.restore();
        ctx.drawImage(img, 0, y, img.width, img.height);
        y += img.height;
      });

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
    "rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50";

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" onClick={copyLink} className={btn} aria-label={dict.chart.shareLink}>
        {copied ? dict.chart.shareCopied : dict.chart.shareLink}
      </button>
      <button type="button" onClick={copyTemplate} className={btn} aria-label={dict.chart.shareSetup}>
        {dict.chart.shareSetup}
      </button>
      <button type="button" onClick={savePng} disabled={busy} className={btn} aria-label={dict.chart.sharePng}>
        {dict.chart.sharePng}
      </button>
    </span>
  );
}
