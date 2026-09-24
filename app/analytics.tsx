"use client";

import { useEffect } from "react";
import { initDataFast } from "datafast";
import type { PostHog } from "posthog-js";

type DataFast = Awaited<ReturnType<typeof initDataFast>>;
let client: Promise<DataFast> | null = null;
let posthog: Promise<PostHog> | null = null;

/** The DataFast client, created once per page. Resolves to null when analytics is off. */
export function analytics(websiteId?: string): Promise<DataFast | null> {
  if (!websiteId || typeof window === "undefined") return Promise.resolve(null);
  client ||= initDataFast({ websiteId, autoCapturePageviews: true });
  return client;
}

/** Records a product event in every analytics tool that is configured; a no-op otherwise. */
export function trackEvent(name: string, props?: Record<string, string | number | boolean | undefined>) {
  const clean = Object.fromEntries(Object.entries(props || {}).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>;
  client?.then((c) => c.track(name, clean)).catch(() => undefined);
  posthog?.then((p) => p.capture(name, clean)).catch(() => undefined);
}

// Every link that leaves the site: a project's website, "Message on X", the X composer.
function onOutboundClick(e: MouseEvent) {
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  let url: URL; try { url = new URL(a.href, location.href); } catch { return; }
  if (url.origin === location.origin || !/^https?:$/.test(url.protocol)) return;
  trackEvent("outbound_click", { host: url.hostname, campaign: url.searchParams.get("utm_campaign") || (/^(x|twitter)\.com$/.test(url.hostname) ? "x" : "other"), from: location.pathname });
}
let outboundListening = false;
function listenForOutbound() {
  if (outboundListening || typeof document === "undefined") return;
  outboundListening = true;
  document.addEventListener("click", onOutboundClick, true);
}

// Mounted once in the root layout. Pageviews are captured on load and on every route change.
export function DataFastAnalytics({ websiteId }: { websiteId: string }) {
  useEffect(() => { listenForOutbound(); analytics(websiteId).catch(() => undefined); }, [websiteId]);
  return null;
}

// Loaded on demand so the library stays out of the server render and the first bundle.
// "history_change" records a pageview on load and on every client-side navigation.
export function PostHogAnalytics({ apiKey, host }: { apiKey: string; host: string }) {
  useEffect(() => {
    listenForOutbound();
    posthog ||= import("posthog-js").then(({ default: ph }) => {
      ph.init(apiKey, { api_host: host, capture_pageview: "history_change", person_profiles: "identified_only" });
      return ph;
    });
    posthog.catch(() => undefined);
  }, [apiKey, host]);
  return null;
}
