import assert from "node:assert/strict";
import test from "node:test";
import type { PriceAlert } from "../alerts/alerts.ts";
import { alertEmail, alertSymbols, briefEmail, renewalDue, renewalEmail, runUserAlerts, teaserEmail, type QuoteLite } from "./run.ts";
import type { Brief } from "../brief.ts";

const alert = (over: Partial<PriceAlert> = {}): PriceAlert => ({
  id: over.id ?? "a1",
  symbol: over.symbol ?? "VNM",
  condition: over.condition ?? "above",
  price: over.price ?? 60000,
  createdAt: 0,
  ...(over.triggeredAt !== undefined ? { triggeredAt: over.triggeredAt } : {}),
});

const quotes = (list: QuoteLite[]) => new Map(list.map((q) => [q.symbol.toUpperCase(), q]));

test("alertSymbols returns distinct, upper-cased symbols of untriggered alerts only", () => {
  const set = [alert({ id: "1", symbol: "vnm" }), alert({ id: "2", symbol: "VNM" }), alert({ id: "3", symbol: "HPG", triggeredAt: 1 })];
  assert.deepEqual(alertSymbols(set), ["VNM"]);
});

test("an 'above' alert fires when price reaches the level and is marked triggered", () => {
  const { next, fired } = runUserAlerts([alert({ price: 60000 })], quotes([{ symbol: "VNM", price: 61000 }]), 123);
  assert.equal(fired.length, 1);
  assert.equal(next[0].triggeredAt, 123);
});

test("an alert whose symbol has no quote this run is left untouched", () => {
  const { next, fired } = runUserAlerts([alert({ symbol: "HPG" })], quotes([{ symbol: "VNM", price: 61000 }]), 1);
  assert.equal(fired.length, 0);
  assert.equal(next[0].triggeredAt, undefined);
});

test("an already-triggered alert never fires again", () => {
  const { fired } = runUserAlerts([alert({ triggeredAt: 5, price: 1 })], quotes([{ symbol: "VNM", price: 999 }]), 9);
  assert.equal(fired.length, 0);
});

test("cross_up needs a real crossing from the previous close, not just a level", () => {
  const a = alert({ condition: "cross_up", price: 60000 });
  const below = runUserAlerts([a], quotes([{ symbol: "VNM", price: 61000, prevClose: 62000 }]), 1);
  assert.equal(below.fired.length, 0, "already above at prevClose: no crossing");
  const crossing = runUserAlerts([a], quotes([{ symbol: "VNM", price: 61000, prevClose: 59000 }]), 1);
  assert.equal(crossing.fired.length, 1, "prev below, now above: a crossing");
});

test("the email names the symbol, condition and level; batches summarise", () => {
  const q = quotes([{ symbol: "VNM", price: 61000 }]);
  const one = alertEmail([alert({ price: 60000 })], q, "vi");
  assert.match(one.subject, /VNM/);
  assert.match(one.text, /60/);
  const many = alertEmail([alert({ id: "1" }), alert({ id: "2", symbol: "HPG" })], q, "en");
  assert.match(many.subject, /2 price alerts/);
});

test("the brief email carries the headline as subject and every section in the body", () => {
  const brief: Brief = {
    headline: "Thị trường phiên hôm nay",
    standfirst: "VNINDEX tăng nhẹ.",
    paragraphs: [
      { id: "indices", heading: "Chỉ số", sentences: ["VNINDEX +0,5%."] },
      { id: "gold", heading: "Vàng", sentences: ["SJC đi ngang."] },
    ],
  };
  const { subject, text } = briefEmail(brief, "vi");
  assert.equal(subject, "Thị trường phiên hôm nay");
  assert.match(text, /VNINDEX tăng nhẹ/);
  assert.match(text, /Chỉ số/);
  assert.match(text, /Vàng/);
});

test("renewalDue is true only in the final window and only once per term", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const in3 = new Date(now.getTime() + 3 * 86_400_000);
  const in30 = new Date(now.getTime() + 30 * 86_400_000);
  const past = new Date(now.getTime() - 86_400_000);
  assert.equal(renewalDue(in3, null, now), true, "3 days out, not reminded");
  assert.equal(renewalDue(in30, null, now), false, "outside the 7-day window");
  assert.equal(renewalDue(in3, now, now), false, "already reminded this term");
  assert.equal(renewalDue(past, null, now), false, "already expired");
  assert.equal(renewalDue(null, null, now), false, "no subscription");
});

test("renewalEmail names the tier and the expiry date", () => {
  const { subject, text } = renewalEmail("pro", new Date("2026-06-08T00:00:00Z"), "vi");
  assert.match(subject, /Pro/);
  assert.match(text, /08\/06\/2026/);
});

test("the teaser email always carries the pricing and unsubscribe links", () => {
  const { subject, text } = teaserEmail("vi", { pricingUrl: "https://x.test/vi/goi-dich-vu", unsubUrl: "https://x.test/api/unsubscribe?t=1" });
  assert.ok(subject.length > 0);
  assert.match(text, /goi-dich-vu/);
  assert.match(text, /unsubscribe/, "an unsubscribe link is mandatory");
});
