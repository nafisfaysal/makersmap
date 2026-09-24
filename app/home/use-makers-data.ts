"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeMaker, normalizeProject, type Maker, type Project } from "../profile";
import { useStoredState } from "../use-stored";
import { trackEvent } from "../analytics";

// Everything the home page knows about makers: the atlas dots, per-card details
// fetched on demand, the project catalogue, and the visitor's own pin and saves.

export type CatalogueRow = { maker: Maker & { projectCount?: number }; project: Project };

const parseOwn = (raw: string | null): Maker | null => {
  try {
    const o = JSON.parse(raw || "null");
    return o && typeof o.name === "string" && typeof o.lat === "number" && typeof o.lon === "number" ? normalizeMaker(o) : null;
  } catch { return null; }
};
const parseIds = (raw: string | null): number[] => {
  try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "number") : []; } catch { return []; }
};

export function useMakersData(wantCatalogue: boolean) {
  const [makers, setMakers] = useState<Maker[]>([]);
  const [makersLoaded, setMakersLoaded] = useState(false);
  const [own, setOwn] = useStoredState<Maker | null>("makersmap-own", parseOwn);
  const [saved, setSaved] = useStoredState<number[]>("makersmap-saved", parseIds);

  // The atlas payload is dots only. Card details (description, projects, links)
  // are fetched for the people on screen, 60 at a time, and kept for the visit.
  const [details, setDetails] = useState<Map<number, Maker>>(new Map());
  const detailsRef = useRef(details);
  useEffect(() => { detailsRef.current = details; }, [details]);
  const pendingDetails = useRef(new Set<number>());
  const full = useCallback((m: Maker) => details.get(m.id) ?? m, [details]);
  const ensureDetails = useCallback((ids: number[]) => {
    const missing = ids.filter((id) => !detailsRef.current.has(id) && !pendingDetails.current.has(id));
    if (!missing.length) return;
    for (const id of missing) pendingDetails.current.add(id);
    for (let i = 0; i < missing.length; i += 60) {
      const chunk = missing.slice(i, i + 60);
      fetch(`/api/makers/cards?ids=${chunk.join(",")}`).then((r) => r.json() as Promise<{ makers?: Maker[] }>).then((data) => {
        if (!Array.isArray(data.makers)) return;
        setDetails((prev) => { const next = new Map(prev); for (const m of data.makers!) next.set(m.id, normalizeMaker(m)); return next; });
      }).catch(() => undefined).finally(() => { for (const id of chunk) pendingDetails.current.delete(id); });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/makers", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { makers?: Maker[] };
      if (Array.isArray(data.makers) && data.makers.length) setMakers(data.makers.map(normalizeMaker));
    }).catch(() => undefined).finally(() => setMakersLoaded(true));
    return () => controller.abort();
  }, []);

  // The project catalogue has its own endpoint: every named project with its maker.
  const [catalogue, setCatalogue] = useState<CatalogueRow[] | null>(null);
  useEffect(() => {
    if (!wantCatalogue || catalogue) return;
    fetch("/api/projects").then((r) => r.json() as Promise<{ projects?: { maker: Record<string, unknown>; project: Project }[] }>).then((data) => {
      if (!Array.isArray(data.projects)) return;
      setCatalogue(data.projects.map((row) => {
        const maker = row.maker as unknown as Maker;
        return { maker: { ...normalizeMaker({ ...maker, lat: maker.lat ?? 0, lon: maker.lon ?? 0 }), projectCount: Number(row.maker.projectCount) || 1 }, project: normalizeProject(row.project) };
      }));
    }).catch(() => setCatalogue([]));
  }, [wantCatalogue, catalogue]);

  // The visitor's own pin sits first so they can always find themselves.
  const all = useMemo(() => (own ? [own, ...makers.filter((m) => m.id !== own.id && m.handle !== own.handle)] : makers), [own, makers]);
  const toggleSave = useCallback((m: Maker) => setSaved((s) => { const saving = !s.includes(m.id); trackEvent(saving ? "maker_saved" : "maker_unsaved", { handle: m.handle }); return saving ? [...s, m.id] : s.filter((id) => id !== m.id); }), [setSaved]);

  return { makers, makersLoaded, all, own, setOwn, saved, toggleSave, full, ensureDetails, catalogue };
}
