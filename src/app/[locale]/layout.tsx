import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { notFound } from "next/navigation";
import "../globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { ThemeScript } from "@/components/ThemeScript";
import { TickerStrip } from "@/components/TickerStrip";
import { WatchlistSync } from "@/components/WatchlistSync";
import { Analytics } from "@/components/Analytics";
import { getDict, isLocale, LOCALES } from "@/lib/i18n";
import { getSession } from "@/lib/auth/session";
import { cryptoEnabled } from "@/lib/flags";
import { siteUrl } from "@/lib/site";
import { VN30 } from "@/lib/providers/vnstock";

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
  const title = locale === "vi"
    ? "VN Terminal — Chứng khoán, Vàng, Crypto"
    : "VN Terminal — Vietnam Stocks, Gold, Crypto";
  const description = locale === "vi"
    ? "Bảng giá chứng khoán Việt Nam, giá vàng SJC/DOJI/PNJ và thị trường crypto trên một màn hình. Dữ liệu cập nhật liên tục, miễn phí."
    : "Vietnam stock board, SJC/DOJI/PNJ gold prices and the crypto market on one screen. Continuously updated, free.";

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
  const session = await getSession();

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
        <Header locale={locale} dict={dict} email={session?.email ?? null} tier={session?.tier ?? "anon"} symbols={[...VN30]} cryptoEnabled={cryptoEnabled()} />
        <TickerStrip locale={locale} />
        <WatchlistSync email={session?.email ?? null} />
        <Analytics />
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6">
          {children}
        </main>
        <Footer dict={dict} locale={locale} />
      </body>
    </html>
  );
}
