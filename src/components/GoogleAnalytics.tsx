import Script from "next/script";
import { gaId } from "@/lib/analytics/ga";

/** The Google tag for GA4; renders nothing without a valid measurement id. */
export function GoogleAnalytics() {
  const id = gaId();
  if (!id) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());var u=new URL(location.href);u.searchParams.delete('token');gtag('config','${id}',{page_location:u.href});`}
      </Script>
    </>
  );
}
