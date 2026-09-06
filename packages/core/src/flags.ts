/**
 * Feature flags — env-driven so a surface can be toggled from the Vercel
 * dashboard without a code change or redeploy of source.
 */

/**
 * Crypto section (home BTC tile, ticker BTC/ETH, the Crypto nav + pages).
 * Default OFF — the CoinGecko feed is rate-limited/unreliable from some hosts,
 * so it is hidden until explicitly turned on with CRYPTO_ENABLED=true.
 */
export function cryptoEnabled(): boolean {
  return process.env.CRYPTO_ENABLED === "true";
}
