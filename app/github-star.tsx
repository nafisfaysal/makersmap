"use client";

import { useSyncExternalStore } from "react";
import { Star } from "lucide-react";
import { SocialIcon } from "./social-icon";
import { trackEvent } from "./analytics";

export const REPO = "nafisfaysal/makersmap";
export const REPO_URL = `https://github.com/${REPO}`;
const CACHE_KEY = "makersmap-github-stars";
const CACHE_MS = 60 * 60_000;

// One shared, cached star count for every button on the page: a single request per hour per visitor.
let stars: number | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load() {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as { n: number; at: number } | null;
    if (cached && Date.now() - cached.at < CACHE_MS) { stars = cached.n; queueMicrotask(emit); return; }
  } catch {}
  fetch(`https://api.github.com/repos/${REPO}`, { headers: { Accept: "application/vnd.github+json" } })
    .then((r) => (r.ok ? (r.json() as Promise<{ stargazers_count?: number }>) : null))
    .then((d) => {
      if (typeof d?.stargazers_count !== "number") return;
      stars = d.stargazers_count;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ n: stars, at: Date.now() })); } catch {}
      emit();
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => { listeners.delete(listener); };
}

/** Live star count from GitHub; null until it arrives (and during server render). */
function useStars(): number | null {
  return useSyncExternalStore(subscribe, () => stars, () => null);
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** The glowing "Star on GitHub" pill for the header. */
export function GithubStarButton({ from = "header" }: { from?: string }) {
  const stars = useStars();
  return (
    <a className="github-star" href={REPO_URL} target="_blank" rel="noopener" aria-label={`MakersMap is open source. Star it on GitHub${stars != null ? ` (${stars} stars)` : ""}`}
      onClick={() => trackEvent("github_star_click", { from })}>
      <span className="github-star-mark"><SocialIcon kind="GitHub" size={15} /></span>
      <span className="github-star-label"><Star size={13} className="github-star-icon" />Star</span>
      {stars != null && <span className="github-star-count">{compact(stars)}</span>}
    </a>
  );
}

/** A quiet band for the footer: says the project is open source and asks for a star. */
export function OpenSourceBand() {
  const stars = useStars();
  return (
    <section className="open-source-band" aria-label="MakersMap is open source">
      <div>
        <span className="open-source-kicker">Open source</span>
        <p>MakersMap is built in the open. If it helped you find your people, a star on GitHub helps more makers find it.</p>
      </div>
      <a className="github-star github-star-large" href={REPO_URL} target="_blank" rel="noopener" onClick={() => trackEvent("github_star_click", { from: "footer" })}>
        <span className="github-star-mark"><SocialIcon kind="GitHub" size={17} /></span>
        <span className="github-star-label"><Star size={14} className="github-star-icon" />Star on GitHub</span>
        {stars != null && <span className="github-star-count">{compact(stars)}</span>}
      </a>
    </section>
  );
}
