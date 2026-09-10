/**
 * The one place the brief's figures are gathered.
 *
 * The live page and the cron each had their own copy of this block, with a
 * comment in the cron asking the next reader to keep them identical by hand.
 * They are the same document — the email links to the page — so a paragraph
 * that appears in one and not the other is the email contradicting the page.
 * Now there is nothing to keep in sync.
 *
 * Every feed is settled independently: a gold outage must degrade the gold
 * paragraph, not lose the whole brief.
 */
import { cryptoEnabled } from "../flags.ts";
import { getCoins } from "../providers/crypto.ts";
import { getGold, headlineRow, premium } from "../providers/gold.ts";
import { getBoard, getIndexSparks, getIndices } from "../providers/vnstock.ts";
import type { BriefInputs } from "./snapshot.ts";

/** Displayed alongside the premium so a reader can see the assumption. */
const USD_VND = Number(process.env.NEXT_PUBLIC_USD_VND ?? 26_300);

export async function loadBriefInputs(options: { sparks?: boolean } = {}): Promise<BriefInputs> {
  const [indicesR, boardR, goldR, coinsR] = await Promise.allSettled([
    getIndices(),
    getBoard(),
    getGold(),
    cryptoEnabled() ? getCoins(20) : Promise.resolve([]),
  ]);
  const indices = indicesR.status === "fulfilled" ? indicesR.value : [];
  const board = boardR.status === "fulfilled" ? boardR.value : [];
  const gold = goldR.status === "fulfilled" ? goldR.value : null;
  const coins = coinsR.status === "fulfilled" ? coinsR.value : [];

  const goldHeadline = gold ? headlineRow(gold.rows) : undefined;
  const premiumPct = gold?.world && goldHeadline
    ? premium(gold.world.buy, goldHeadline.sell, USD_VND).pct
    : undefined;

  // One extra request, and only for the indices sparkline.
  const sparks = options.sparks && indices.length
    ? await getIndexSparks(indices.map((i) => i.symbol)).catch(() => ({} as Record<string, number[]>))
    : undefined;

  return { indices, board, gold, goldHeadline, coins, premiumPct, ...(sparks ? { sparks } : {}) };
}
