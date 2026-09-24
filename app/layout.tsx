import type { Metadata } from "next";
import { JsonLd } from "./json-ld";
import { SiteFooter } from "./site-footer";
import { readEnv } from "@/db";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, OG_IMAGE, SITE_NAME, siteUrl, websiteJsonLd } from "@/lib/seo";
import "./globals.css";
import "./globe.css";
import { DataFastAnalytics, PostHogAnalytics } from "@/app/analytics";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: DEFAULT_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["makers", "founders", "atlas", "indie hackers", "city map", "builders"],
  authors: [{ name: SITE_NAME }],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: siteUrl(),
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <JsonLd data={websiteJsonLd()} />
        {children}
        <SiteFooter />
        {readEnv("DATAFAST_WEBSITE_ID") && <DataFastAnalytics websiteId={readEnv("DATAFAST_WEBSITE_ID")!} />}
        {readEnv("POSTHOG_KEY") && (
          <PostHogAnalytics apiKey={readEnv("POSTHOG_KEY")!} host={readEnv("POSTHOG_HOST") || "https://us.i.posthog.com"} />
        )}
        {readEnv("PLAUSIBLE_DOMAIN") && (
          <script defer data-domain={readEnv("PLAUSIBLE_DOMAIN")} src="https://plausible.io/js/script.js" />
        )}
      </body>
    </html>
  );
}
