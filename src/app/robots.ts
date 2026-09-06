import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

const SITE = siteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Login is a form with nothing to index; everything else that used to
        // be listed here now redirects into the chart.
        disallow: ["/api/", "/vi/dang-nhap", "/en/login"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
