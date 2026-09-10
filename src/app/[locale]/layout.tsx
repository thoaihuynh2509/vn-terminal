import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { Footer } from "@/components/Footer";
import { Suspense } from "react";
import { SessionChrome, SessionChromeFallback } from "@/components/SessionChrome";
import { ThemeScript } from "@/components/ThemeScript";
import { TickerStrip } from "@/components/TickerStrip";
import { Analytics } from "@/components/Analytics";
import { getDict, isLocale, LOCALES } from "@/lib/i18n";
import { siteUrl } from "@/lib/site";

const SITE = siteUrl();

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", display: "swap" });

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
    <html lang={locale === "vi" ? "vi-VN" : "en-US"} className={inter.variable} suppressHydrationWarning>
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
        {/* The chrome that depends on WHO is asking, isolated and suspended so
            the rest of the page is not held behind the session read. */}
        <Suspense fallback={<SessionChromeFallback locale={locale} dict={dict} />}>
          <SessionChrome locale={locale} dict={dict} />
        </Suspense>
        <TickerStrip locale={locale} />
        <Analytics />
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6">
          {children}
        </main>
        <Footer dict={dict} locale={locale} />
      </body>
    </html>
  );
}
