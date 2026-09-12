"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Dict } from "@/lib/i18n";
import type { IndicatorDef } from "@/lib/ta/registry";
import type { TvRange } from "@/lib/chart/range-interval";
import type { Appearance } from "@/lib/chart/appearance";
import type { ScaleId } from "@/lib/chart/scale";
import type { DrawingKind } from "@/lib/chart/drawings";
import type { Bar, Tier } from "@/lib/types";
import type { Gate } from "../GateHint";
import type { ChartType } from "../chartShared";
import { createValueStore, type ValueStore } from "../valueStore";

export type ToolMode = "cursor" | DrawingKind;

/** What the primary chart hands the workspace's toolbars. */
export interface WorkspaceApi {
  dict: Dict;
  tier: Tier;
  symbol: string;
  tf: string;
  type: ChartType;
  setType: (t: ChartType) => void;
  scale: ScaleId;
  setScale: (s: ScaleId) => void;
  active: string[];
  toggle: (d: IndicatorDef) => void;
  limit: number;
  unlocked: boolean;
  mode: ToolMode;
  setMode: (m: ToolMode) => void;
  setPending: (p: { t: number; p: number }[]) => void;
  canDraw: boolean;
  raiseGate: (g: { gate: Gate; limit?: number; asked?: boolean }) => void;
  histFlags: { undo: boolean; redo: boolean };
  stepHistory: (dir: "undo" | "redo") => void;
  selectedId: string | null;
  deleteSelected: () => void;
  hasDrawings: boolean;
  clearDrawings: () => void;
  shown: ValueStore<number>;
  bars: ValueStore<Bar[]>;
  pickRange: (id: TvRange) => void;
  goTo: (t: number) => void;
  shoot: () => { canvas: HTMLCanvasElement; cssWidth: number } | null;
  asTable: boolean;
  setAsTable: (v: boolean) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  /** The theme's own candle colours, which an empty appearance colour stands for. */
  themeUp: string;
  themeDown: string;
  replayOn: boolean;
  toggleReplay: () => void;
}

export type WorkspaceStore = ValueStore<WorkspaceApi | null>;

export const createWorkspaceStore = (): WorkspaceStore => createValueStore<WorkspaceApi | null>(null);

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);

const idle = () => () => {};
const none = () => null;

/** The primary chart's controls, or null until it has mounted (and always outside a workspace). */
export function useWorkspace(): WorkspaceApi | null {
  const store = useContext(WorkspaceContext);
  return useSyncExternalStore(store?.subscribe ?? idle, store?.get ?? none, none);
}
