"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isOpenInPerson, roleGroupOf, type Maker } from "../profile";
import { rankShelf } from "../shelf";
import { useStoredState } from "../use-stored";
import type { AskOutcome } from "../ask-atlas";
import { trackEvent } from "../analytics";

// The filters on the atlas and the ranked, windowed "Meet someone interesting"
// list they produce. Ask results keep the model's order; otherwise people are
// ranked by how complete they are, what the browser knows about the visitor,
// a daily shuffle, and a spread across countries.

const PAGE = 36;
const parseSeen = (raw: string | null): string[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-60) : []; } catch { return []; }
};

export type Filters = { query: string; role: string; nearby: boolean; savedOnly: boolean; tag: string; helpWanted: boolean };
const defaultFilters: Filters = { query: "", role: "All makers", nearby: false, savedOnly: false, tag: "Any interest", helpWanted: false };

export function useShelf(all: Maker[], saved: number[], own: Maker | null) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [asked, setAsked] = useState<AskOutcome | null>(null);
  const [seen, setSeen] = useStoredState<string[]>("makersmap-seen", parseSeen);
  const patch = useCallback((change: Partial<Filters>) => { trackEvent("filter_changed", { keys: Object.keys(change).join(",") }); setFilters((f) => ({ ...f, ...change })); }, []);
  const clearFilters = useCallback(() => { setFilters(defaultFilters); setAsked(null); }, []);

  const askedHandles = useMemo(() => (asked ? new Set(asked.results.map((r) => r.handle)) : null), [asked]);
  const filtered = useMemo(() => all.filter((m) => {
    if (askedHandles) return Boolean(m.handle) && askedHandles.has(m.handle as string);
    const q = filters.query.trim().toLowerCase();
    const hay = q ? [m.name, m.city, m.country, m.project, m.description, ...m.tags, ...m.lookingFor].join(" ").toLowerCase() : "";
    return (!q || hay.includes(q))
      && (filters.role === "All makers" || roleGroupOf(m.role) === filters.role)
      && (!filters.nearby || isOpenInPerson(m))
      && (!filters.savedOnly || saved.includes(m.id))
      && (filters.tag === "Any interest" || m.tags.includes(filters.tag))
      && (!filters.helpWanted || m.lookingFor.includes("Feedback") || m.canHelpWith.includes("Design"));
  }), [all, filters, saved, askedHandles]);

  const ranked = useMemo(() => {
    if (asked) {
      const rank = new Map(asked.results.map((r, i) => [r.handle, i]));
      return [...filtered].sort((a, b) => (rank.get(a.handle || "") ?? 99) - (rank.get(b.handle || "") ?? 99));
    }
    if (filters.savedOnly) return filtered;
    const savedMakers = all.filter((m) => saved.includes(m.id));
    return rankShelf(filtered, { own, savedIds: saved, savedMakers, seenHandles: seen });
  }, [filtered, asked, filters.savedOnly, all, saved, own, seen]);

  // The window resets whenever the filters change; derived from a key rather than an effect.
  const filterKey = JSON.stringify([filters, asked?.results.map((r) => r.handle)]);
  const [window, setWindow] = useState({ key: filterKey, limit: PAGE });
  const limit = window.key === filterKey ? window.limit : PAGE;
  const shelf = useMemo(() => ranked.slice(0, limit), [ranked, limit]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || ranked.length <= limit) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setWindow({ key: filterKey, limit: Math.min(limit + PAGE, ranked.length) });
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ranked.length, limit, filterKey]);

  const noteSeen = useCallback((m: Maker) => { if (m.handle) setSeen((prev) => [...prev.filter((h) => h !== m.handle), m.handle as string].slice(-60)); }, [setSeen]);
  const askReason = useCallback((m: Maker) => asked?.results.find((r) => r.handle === m.handle)?.reason, [asked]);
  const activeFilters = (filters.tag !== "Any interest" ? 1 : 0) + (filters.helpWanted ? 1 : 0);

  return { filters, patch, clearFilters, asked, setAsked, filtered, ranked, shelf, sentinel, noteSeen, askReason, activeFilters };
}
