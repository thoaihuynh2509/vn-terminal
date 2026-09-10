"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PATHS, type Dict } from "@/lib/i18n";
import { SECTOR_LABEL, sectorOf } from "@/lib/sectors";
import type { Locale } from "@/lib/types";

const OPEN_EVENT = "open:symbol-search";
/** Indices chart through the same route as an equity. */
const INDICES = ["VNINDEX", "VN30"];

/** Any button on the page can open the one search dialog. */
export function openSymbolSearch() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/**
 * Symbol search — the way to change what is on the chart.
 *
 * Mounted once, in the header, and opened by ⌘K / Ctrl+K from anywhere; a
 * scrolling list of thirty names was the alternative, and nobody scrolls when
 * they already know the ticker.
 */
export function SymbolSearch({ locale, dict, symbols }: { locale: Locale; dict: Dict; symbols: string[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const router = useRouter();

  // Closing resets the query here, at the moment of closing, rather than in an
  // effect watching `open` — the dialog unmounts anyway, so the only job is to
  // make sure the next open starts blank.
  const close = useCallback(() => { setOpen(false); setQ(""); setCursor(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape") close();
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [close]);

  const needle = q.trim().toUpperCase();
  const hits = useMemo(() => {
    const all = [...INDICES, ...symbols];
    if (!needle) return all;
    // Prefix matches first: "V" should list VCB before HDB's sector text.
    const starts = all.filter((s) => s.startsWith(needle));
    const rest = all.filter((s) => !s.startsWith(needle) && (s.includes(needle) || sectorLabel(s, locale).toUpperCase().includes(needle)));
    return [...starts, ...rest];
  }, [needle, symbols, locale]);

  const go = useCallback((sym: string) => {
    close();
    router.push(`/${locale}/${PATHS.terminal[locale]}/${sym}`);
  }, [close, locale, router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-ink/40 p-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={dict.chart.changeSymbol}
        className="mx-auto w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
        <label htmlFor="symbol-search" className="sr-only">{dict.chart.changeSymbol}</label>
        <input
          id="symbol-search" value={q} autoFocus autoComplete="off" spellCheck={false}
          placeholder={dict.chart.searchPlaceholder}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === "Enter" && hits[cursor]) { e.preventDefault(); go(hits[cursor]); }
          }}
          aria-controls="symbol-search-list" aria-activedescendant={hits[cursor] ? `sym-${hits[cursor]}` : undefined}
          className="w-full border-b border-line bg-surface px-4 py-3 text-[15px] tracking-wide text-ink outline-none placeholder:text-muted"
        />
        <ul id="symbol-search-list" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {hits.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">{dict.chart.searchNone}</li>}
          {hits.map((s, i) => (
            <li key={s} id={`sym-${s}`} role="option" aria-selected={i === cursor}>
              <button type="button" onClick={() => go(s)} onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-[13px] ${
                  i === cursor ? "bg-page text-ink" : "text-ink-2"
                }`}>
                <span className="font-semibold tracking-wide">{s}</span>
                <span className="text-[12px] text-muted">{sectorLabel(s, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function sectorLabel(sym: string, locale: Locale): string {
  if (INDICES.includes(sym)) return locale === "vi" ? "Chỉ số" : "Index";
  return SECTOR_LABEL[sectorOf(sym)][locale];
}

/** A visible way in for readers who do not know the shortcut. */
export function SymbolSearchButton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <button type="button" onClick={openSymbolSearch}
      className={`flex items-center gap-2 rounded-lg border border-line text-ink-2 hover:bg-surface-2 hover:text-ink ${
        compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px] font-medium"
      }`}>
      <span aria-hidden="true">⌕</span>
      {label}
      <kbd aria-hidden="true" className="hidden rounded-lg border border-line px-1 text-[10px] text-muted md:inline">⌘K</kbd>
    </button>
  );
}
