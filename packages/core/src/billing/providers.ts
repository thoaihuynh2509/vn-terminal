/**
 * The payment providers and which are configured.
 *
 * Every provider drives the SAME order → grant flow: checkout writes a pending
 * order, the provider's callback (IPN / return / webhook) is the only thing
 * that flips it paid and grants the tier. Adding a provider is adding a config
 * check here and a callback route — never a change to how entitlement is set.
 */
import { momoConfig } from "./momo.ts";
import { vnpayConfig } from "./vnpay.ts";
import { sepayConfig } from "./sepay.ts";

export type Provider = "momo" | "vnpay" | "sepay";
export const PROVIDERS: readonly Provider[] = ["momo", "vnpay", "sepay"];

/** How the reader completes payment — a redirect to a gateway, or a QR to scan. */
export const PROVIDER_KIND: Record<Provider, "redirect" | "qr"> = {
  momo: "redirect",
  vnpay: "redirect",
  sepay: "qr",
};

export function isProvider(v: unknown): v is Provider {
  return v === "momo" || v === "vnpay" || v === "sepay";
}

export function providerEnabled(p: Provider): boolean {
  if (p === "momo") return momoConfig() !== null;
  if (p === "vnpay") return vnpayConfig() !== null;
  return sepayConfig() !== null;
}

export function enabledProviders(): Provider[] {
  return PROVIDERS.filter(providerEnabled);
}

/** Any provider configured at all — drives the pricing page's fail-closed state. */
export function anyProviderEnabled(): boolean {
  return enabledProviders().length > 0;
}
