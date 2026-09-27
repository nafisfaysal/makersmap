import { normalizeHandle } from "@/app/handle";
import { isMongoConfigured } from "@/db";
import { findMakerByHandle, listMakers, listPublicWhere } from "@/db/makers";
import { cache } from "react";
import { publicMaker, type Maker } from "@/app/profile";

// The public list is derived once per shared listMakers() result instead of per
// request. A per-request copy (~2 MB at 10k makers) was retained after every
// render, so a crawler walking the profiles ran a self-hosted isolate out of
// heap. Callers only read it (filter/find/map), never change it.
let derived: { from: Maker[]; list: Maker[] } | null = null;

// Wrapped in React's cache so a page that needs the list in metadata and body reads it once.
export const listPublicMakers = cache(async function listPublicMakers(): Promise<Maker[]> {
  if (isMongoConfigured()) {
    try {
      const all = await listMakers();
      if (derived?.from !== all) derived = { from: all, list: all.filter((maker) => !maker.hidden).map(publicMaker) };
      return derived.list;
    } catch {
      // Unreachable database: an empty atlas rather than a crash.
    }
  }
  return [];
});

export const resolveMakerByHandle = cache(async function resolveMakerByHandle(raw: string): Promise<Maker | null> {
  const slug = normalizeHandle(raw);
  if (!slug || !isMongoConfigured()) return null;
  try {
    const direct = await findMakerByHandle(slug);
    return direct && !direct.hidden ? publicMaker(direct) : null;
  } catch {
    return null;
  }
});

/** Visible makers in one country or city, by stored key, without loading the whole atlas. */
export const listPublicInPlace = cache(async function listPublicInPlace(kind: "country" | "city", slug: string): Promise<Maker[]> {
  if (!isMongoConfigured()) return [];
  try {
    return (await listPublicWhere(kind === "country" ? { countryKey: slug } : { cityKey: slug, "x.placeLevel": { $ne: "country" } })).map(publicMaker);
  } catch { return []; }
});
