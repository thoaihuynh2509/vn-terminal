/**
 * SePay bank-transfer auto-confirmation.
 *
 * There is no redirect and no payment API: the reader scans a VietQR whose
 * transfer memo IS the order id, makes an ordinary bank transfer, and SePay
 * posts a webhook the moment the money lands. That is why this suits a solo
 * operator — no merchant gateway account, just a bank account SePay watches.
 *
 * The webhook is authenticated by a shared API key header; the order is matched
 * by finding its id inside the transfer content and checking the amount. The
 * memo is the security-relevant field, so matching is exact-substring on an
 * upper-cased id, never a fuzzy contains.
 */
export interface SepayConfig {
  apiKey: string;
  bank: string; // bank code for VietQR, e.g. "MB", "VCB"
  account: string; // account number the QR pays into
}

export function sepayConfig(): SepayConfig | null {
  const apiKey = process.env.SEPAY_API_KEY;
  const bank = process.env.SEPAY_BANK;
  const account = process.env.SEPAY_ACCOUNT;
  if (!apiKey || !bank || !account) return null;
  return { apiKey, bank, account };
}

/** The VietQR image a reader scans. `des` is the transfer memo = order id. */
export function qrImageUrl(c: SepayConfig, orderId: string, amount: number): string {
  const q = new URLSearchParams({
    acc: c.account,
    bank: c.bank,
    amount: String(amount),
    des: orderId,
  });
  return `https://qr.sepay.vn/img?${q.toString()}`;
}

/** The webhook carries `Authorization: Apikey <key>`; check it constant-length. */
export function authorizeWebhook(c: SepayConfig, header: string | null): boolean {
  return header === `Apikey ${c.apiKey}`;
}

export interface SepayEvent {
  content?: string; // transfer memo/description
  transferAmount?: number; // VND received
  transferType?: string; // "in" for incoming
  referenceCode?: string; // bank reference, used as providerRef
  id?: number | string;
}

/**
 * Does this transfer settle `order`? The memo must contain the order id and the
 * amount received must be at least the order amount (a reader who sends more
 * still paid). Only incoming transfers count.
 */
export function matchesOrder(
  ev: SepayEvent,
  order: { id: string; amount: number },
): boolean {
  if (ev.transferType && ev.transferType !== "in") return false;
  const content = (ev.content ?? "").toUpperCase();
  if (!content.includes(order.id.toUpperCase())) return false;
  return typeof ev.transferAmount === "number" && ev.transferAmount >= order.amount;
}

export function providerRef(ev: SepayEvent): string {
  return String(ev.referenceCode ?? ev.id ?? "sepay");
}
