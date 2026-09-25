import { z } from "zod/v4";
import { llmSource, structured } from "./llm";
import {
  cities, helpWithOptions, interestOptions, lookingForOptions, roleGroupOf, roleGroupOptions,
  isOpenToCoffee, isCoffeeThisWeek, whereOf, type HelpWith, type LookingFor, type Maker, type RoleGroup,
} from "@/app/profile";
import { looksLikeLookup, quickFind } from "./quick-find";

export type AskFilters = {
  roleGroup?: RoleGroup;
  city?: string;
  country?: string;
  tags: string[];
  lookingFor: LookingFor[];
  canHelpWith: HelpWith[];
  coffee?: boolean;
};

export type AskResult = { handle: string; reason: string };
export type AskAnswer = { filters: AskFilters; results: AskResult[]; summary: string; source: "claude" | "rules" };

const AnswerSchema = z.object({
  summary: z.string(),
  filters: z.object({
    roleGroup: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    tags: z.array(z.string()).nullable(),
    lookingFor: z.array(z.string()).nullable(),
    canHelpWith: z.array(z.string()).nullable(),
    coffee: z.boolean().nullable(),
  }),
  results: z.array(z.object({ handle: z.string(), reason: z.string() })).nullable(),
});

const SYSTEM = `You help people search a community atlas of makers. Given a natural-language request and the roster, do two things:
1. Turn the request into filters (role group, city, country, interest tags, what they're looking for, what they can help with, open to coffee). Use null or empty when the request doesn't mention something. Only use tags, lookingFor, and canHelpWith values that appear in the roster's vocabulary.
2. Rank the best matching people from the roster, at most 6, best first, each with a one-line reason grounded in their profile. Only include people who genuinely fit. If nobody fits, return an empty list and say so in the summary.
The summary is one short sentence describing what you looked for. No exclamation marks, no emojis.`;

function roster(pool: Maker[]): string {
  return pool.map((m) => [
    `@${m.handle}`, m.name, `${m.role} (${roleGroupOf(m.role)})`, whereOf(m),
    m.project ? `building ${m.project}${m.description ? `: ${m.description}` : ""}` : "",
    m.tags.length ? `interests: ${m.tags.join(", ")}` : "",
    m.lookingFor.length ? `looking for: ${m.lookingFor.join(", ")}` : "",
    m.canHelpWith.length ? `can help with: ${m.canHelpWith.join(", ")}` : "",
    m.skills.length ? `skills: ${m.skills.join(", ")}` : "",
    isOpenToCoffee(m) ? "open to coffee" : "",
  ].filter(Boolean).join(" | ")).join("\n");
}

// Keyword fallback when there's no API key. Good enough to be useful, not clever.
const roleWords: [RegExp, RoleGroup][] = [
  [/\b(designer|design|motion|graphic|illustrat|brand)/i, "Designers"],
  [/\b(developer|dev|engineer|coder|programmer|technical|cto)/i, "Developers"],
  [/\b(creator|content|community|writer|newsletter|youtube|podcast|video)/i, "Creators"],
  [/\b(marketer|marketing|growth|sales|product manager|\bpm\b|investor|operator|business|consultant)/i, "Business"],
  [/\b(founder|cofounder|co-founder|indie hacker|solo)/i, "Founders"],
];
const lookingWords: [RegExp, LookingFor][] = [
  [/\b(cofounder|co-founder|technical partner)/i, "Cofounder"],
  [/\bfeedback\b/i, "Feedback"],
  [/\b(customers?|users|clients)\b/i, "Customers"],
  [/\b(friends|peers|other founders|community)\b/i, "Founder friends"],
  [/\bcoffee\b/i, "Coffee"],
];

export function rulesAsk(query: string, pool: Maker[], limit = 6): AskAnswer {
  const q = query.toLowerCase();
  const filters: AskFilters = { tags: [], lookingFor: [], canHelpWith: [] };
  const city = [...cities].sort((a, b) => b.city.length - a.city.length).find((c) => q.includes(c.city.toLowerCase()));
  if (city) filters.city = city.city;
  const country = [...new Set(cities.map((c) => c.country))].sort((a, b) => b.length - a.length).find((c) => q.includes(c.toLowerCase()));
  if (country && !city) filters.country = country;
  // "wants feedback" is a need; "can help with design" is an offer. Detect the offer phrasing first.
  const offerMatch = q.match(/(?:help with|good at|can help|offers?|experienced in)\s+([a-z &]+)/);
  for (const option of helpWithOptions) {
    if (offerMatch && offerMatch[1].includes(option.toLowerCase().split(" ")[0])) filters.canHelpWith.push(option);
  }
  for (const [pattern, need] of lookingWords) if (pattern.test(q) && !filters.lookingFor.includes(need)) filters.lookingFor.push(need);
  for (const tag of interestOptions) if (q.includes(tag.toLowerCase())) filters.tags.push(tag);
  const role = roleWords.find(([pattern]) => pattern.test(q))?.[1];
  if (role && !(role === "Business" && filters.canHelpWith.length)) filters.roleGroup = role;
  if (/\bcoffee\b|meet up|in person|nearby/.test(q)) filters.coffee = true;

  const thisWeek = /this week|these days|right now|soon/.test(q);
  const scored = pool.map((m) => {
    let score = 0;
    const why: string[] = [];
    if (filters.city && m.city === filters.city) { score += 4; why.push(`in ${m.city}`); }
    else if (filters.country && m.country === filters.country) { score += 2; why.push(`in ${m.country}`); }
    if (filters.roleGroup && roleGroupOf(m.role) === filters.roleGroup) { score += 3; why.push(m.role.toLowerCase()); }
    for (const tag of filters.tags) if (m.tags.includes(tag)) { score += 2; why.push(`into ${tag}`); }
    for (const need of filters.lookingFor) if (m.lookingFor.includes(need)) { score += 2; why.push(`looking for ${need.toLowerCase()}`); }
    for (const help of filters.canHelpWith) if (m.canHelpWith.includes(help)) { score += 3; why.push(`can help with ${help.toLowerCase()}`); }
    if (filters.coffee && isOpenToCoffee(m)) { score += 1; why.push("open to coffee"); }
    if (filters.coffee && thisWeek && isCoffeeThisWeek(m)) { score += 3; why.push("up for coffee this week"); }
    // Free-text fallback: words from the query found in the profile.
    const hay = [m.name, m.project, m.description, m.bio, ...m.skills].join(" ").toLowerCase();
    for (const word of q.split(/[^a-z0-9]+/).filter((w) => w.length > 3)) if (hay.includes(word) && !why.length) { score += 1; }
    return { m, score, why };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);

  // A named place is a hard constraint when anyone is there. Relax it step by
  // step (city -> country -> anywhere) rather than mixing locals with strangers.
  let picked = scored;
  let note = "";
  const strong = (r: typeof scored[number]) =>
    filters.lookingFor.every((need) => r.m.lookingFor.includes(need)) &&
    filters.canHelpWith.every((help) => r.m.canHelpWith.includes(help));
  if ((filters.lookingFor.length || filters.canHelpWith.length) && scored.some(strong)) picked = scored.filter(strong);
  if (filters.city || filters.country) {
    const inCity = filters.city ? picked.filter((r) => r.m.city === filters.city) : [];
    const inCountry = picked.filter((r) => (filters.country || cities.find((c) => c.city === filters.city)?.country) === r.m.country);
    const fitsRole = (r: typeof scored[number]) => !filters.roleGroup || roleGroupOf(r.m.role) === filters.roleGroup;
    if (inCity.some(fitsRole)) picked = inCity.filter(fitsRole);
    else if (inCity.length) { picked = inCity; note = ` No ${filters.roleGroup?.toLowerCase() || "exact match"} in ${filters.city} yet, so here is who is there.`; }
    else if (inCountry.some(fitsRole)) { picked = inCountry.filter(fitsRole); note = filters.city ? ` Nobody in ${filters.city} yet, so here is the rest of ${inCountry[0].m.country}.` : ""; }
    else { note = ` Nobody in ${filters.city || filters.country} yet, so here are the closest matches elsewhere.`; }
  }
  picked = picked.slice(0, limit);

  const asked = [filters.roleGroup ? filters.roleGroup.toLowerCase() : "makers", filters.city ? `in ${filters.city}` : filters.country ? `in ${filters.country}` : "", filters.tags.length ? `into ${filters.tags.join(", ")}` : "", filters.lookingFor.length ? `looking for ${filters.lookingFor.join(", ").toLowerCase()}` : "", filters.canHelpWith.length ? `who can help with ${filters.canHelpWith.join(", ").toLowerCase()}` : ""].filter(Boolean).join(" ");
  return {
    filters,
    results: picked.map((r) => ({ handle: r.m.handle || "", reason: r.why.length ? `${r.m.name.split(" ")[0]} is ${r.why.slice(0, 3).join(", ")}.` : `${r.m.name.split(" ")[0]} mentions this in their profile.` })),
    summary: picked.length ? `Looked for ${asked}.${note}` : `Nobody matches "${query}" yet.`,
    source: "rules",
  };
}

/** A name, @handle, or project typed straight in: answered from the roster with no model call. */
export function directAsk(query: string, pool: Maker[]): AskAnswer | null {
  if (!looksLikeLookup(query)) return null;
  const hits = quickFind(query, pool);
  if (!hits.length) return null;
  return {
    filters: { tags: [], lookingFor: [], canHelpWith: [] },
    results: hits.filter((m) => m.handle).map((m) => ({ handle: m.handle as string, reason: `${m.name.split(" ")[0]} · ${m.role}${m.city ? ` in ${m.city}` : ""}${m.project ? ` · ${m.project}` : ""}.` })),
    summary: `Found ${hits.length === 1 ? hits[0].name : `${hits.length} makers matching "${query.trim()}"`}.`,
    source: "rules",
  };
}

// The model gets a shortlist, never the whole atlas: 10,000 profiles is far past any context window.
const SHORTLIST = 150;
function shortlist(query: string, pool: Maker[]): Maker[] {
  const byHandle = new Map(pool.map((m) => [m.handle, m]));
  const ranked = rulesAsk(query, pool, SHORTLIST).results.map((r) => byHandle.get(r.handle)).filter((m): m is Maker => Boolean(m));
  if (ranked.length >= SHORTLIST) return ranked;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const seen = new Set(ranked.map((m) => m.id));
  for (const m of pool) {
    if (ranked.length >= SHORTLIST) break;
    if (seen.has(m.id)) continue;
    const hay = [m.name, m.role, m.city, m.country, m.project, m.description, ...m.tags, ...m.skills].join(" ").toLowerCase();
    if (words.some((w) => hay.includes(w))) { ranked.push(m); seen.add(m.id); }
  }
  return ranked;
}

// Same question, same answer, for ten minutes: repeat asks cost nothing and return instantly.
const answers = new Map<string, { at: number; answer: AskAnswer }>();
const ANSWER_TTL_MS = 10 * 60_000;

export async function askAtlas(query: string, pool: Maker[]): Promise<AskAnswer> {
  const direct = directAsk(query, pool);
  if (direct) return direct;
  const key = query.trim().toLowerCase().replace(/\s+/g, " ");
  const hit = answers.get(key);
  if (hit && Date.now() - hit.at < ANSWER_TTL_MS) return hit.answer;
  const answer = await modelAsk(query, pool);
  // Keep only the model's answers: a keyword fallback after a hiccup shouldn't stick for ten minutes.
  if (answer.source === "claude") answers.set(key, { at: Date.now(), answer });
  if (answers.size > 500) answers.delete(answers.keys().next().value as string);
  return answer;
}

async function modelAsk(query: string, pool: Maker[]): Promise<AskAnswer> {
  if (llmSource() === "none") return rulesAsk(query, pool);
  const candidates = shortlist(query, pool);
  if (candidates.length < 3) return rulesAsk(query, pool);
  const out = await structured({
    system: SYSTEM,
    user: `REQUEST: ${query}\n\nVOCABULARY\nrole groups: ${roleGroupOptions.join(", ")}\ntags: ${interestOptions.join(", ")}\nlookingFor: ${lookingForOptions.join(", ")}\ncanHelpWith: ${helpWithOptions.join(", ")}\n\nROSTER\n${roster(candidates)}`,
    schema: AnswerSchema,
    maxTokens: 1500,
    label: "ask",
    timeoutMs: 8000,
    retries: 0,
  });
  if (!out) return rulesAsk(query, pool);
  const known = new Set(pool.map((m) => m.handle));
  return {
    summary: out.summary,
    filters: {
      roleGroup: (roleGroupOptions as string[]).includes(out.filters.roleGroup ?? "") ? (out.filters.roleGroup as AskFilters["roleGroup"]) : undefined,
      city: out.filters.city ?? undefined,
      country: out.filters.country ?? undefined,
      tags: (out.filters.tags ?? []).filter((t) => (interestOptions as string[]).includes(t)),
      lookingFor: (out.filters.lookingFor ?? []).filter((v): v is AskFilters["lookingFor"][number] => (lookingForOptions as string[]).includes(v)),
      canHelpWith: (out.filters.canHelpWith ?? []).filter((v): v is AskFilters["canHelpWith"][number] => (helpWithOptions as string[]).includes(v)),
      coffee: out.filters.coffee ?? undefined,
    },
    results: (out.results ?? []).map((r) => ({ handle: r.handle.replace(/^@/, ""), reason: r.reason })).filter((r) => known.has(r.handle)).slice(0, 6),
    source: "claude",
  };
}
