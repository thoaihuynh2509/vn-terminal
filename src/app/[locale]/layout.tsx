import type { Metadata } from "next";
import { Be_Vietnam_Pro, IBM_Plex_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { Footer } from "@/components/Footer";
import { Suspense } from "react";
import { SessionChrome, SessionChromeFallback } from "@/components/SessionChrome";
import { ThemeScript } from "@/components/ThemeScript";
import { TickerStrip, TickerStripFallback } from "@/components/TickerStrip";
import { Analytics } from "@/components/Analytics";
import { getDict, isLocale, LOCALES } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";

const SITE = siteUrl();

/**
 * The v2 design specifies Sora for the UI face. Sora ships no Vietnamese
 * subset — its Latin Extended stops short of the tone-stacked codepoints
 * (U+1EA0–1EF9) that most Vietnamese words need — so every diacritic would
 * render from a fallback family mid-word. Be Vietnam Pro is the same
 * geometric register and was drawn for these diacritics.
 */
const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-vn",
  display: "swap",
});

/** Every figure in the product: prices, deltas, axis labels, eyebrows. */
const mono = IBM_Plex_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const d = getDict(locale);
  const verification = (process.env.GOOGLE_SITE_VERIFICATION || "").trim();
  const title = locale === "vi"
    ? `${d.brand} — Chứng khoán và Vàng`
    : `${d.brand} — Vietnam Stocks and Gold`;
  const description = locale === "vi"
    ? "Bảng giá chứng khoán Việt Nam và giá vàng SJC/DOJI/PNJ trên một màn hình. Dữ liệu cập nhật liên tục, miễn phí."
    : "The Vietnam stock board and SJC/DOJI/PNJ gold prices on one screen. Continuously updated, free.";

  return {
    metadataBase: new URL(SITE),
    title: { default: title, template: `%s · ${d.brand}` },
    description,
    // hreflang pairs, mirroring the reference site's bilingual setup.
    alternates: {
      canonical: `/${locale}`,
      languages: { "vi-VN": "/vi", "en-US": "/en", "x-default": "/vi" },
    },
    openGraph: { title, description, type: "website", locale: locale === "vi" ? "vi_VN" : "en_US" },
    robots: { index: true, follow: true },
    // Search Console's meta-tag verification. Omitted entirely when unset: an
    // empty `google` value renders a meta tag with no content, which the
    // verifier reads as a failed attempt rather than an absent one. No page
    // sets `verification`, so every route inherits this.
    ...(verification ? { verification: { google: verification } } : {}),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDict(locale);

  return (
    <html lang={locale === "vi" ? "vi-VN" : "en-US"} className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          {locale === "vi" ? "Tới nội dung chính" : "Skip to content"}
        </a>
        {/* The dark index bar is the top edge of the page: it reads as the
            market itself, with the site chrome sitting underneath it. */}
        {/* Suspended for the same reason SessionChrome is, and for one more:
            `loading.tsx` sits BELOW the layout, so it cannot show a fallback
            for a layout that reads runtime data — without this boundary every
            navigation blocks on the index and gold feeds before any page-level
            loading state can appear. */}
        <Suspense fallback={<TickerStripFallback locale={locale} />}>
          <TickerStrip locale={locale} />
        </Suspense>
        {/* The chrome that depends on WHO is asking, isolated and suspended so
            the rest of the page is not held behind the session read. */}
        <Suspense fallback={<SessionChromeFallback locale={locale} dict={dict} />}>
          <SessionChrome locale={locale} dict={dict} />
        </Suspense>
        <Analytics />
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <Footer dict={dict} locale={locale} />
      </body>
    </html>
  );
}
