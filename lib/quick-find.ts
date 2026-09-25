// Instant name / handle / project / city lookup over makers the page already has.
// No network: this runs on every keystroke.

type Findable = { id: number; name: string; handle?: string; city: string; country: string; project?: string; role: string };

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Words that mean "this is a question for the AI", not a name.
const INTENT = /\b(who|looking|wants?|need|find|someone|anyone|help|into|open to|up for|near|this week|cofounder|co-founder|designers?|developers?|founders?|makers?|people)\b/i;

/** True when the text reads like a name or handle rather than a natural-language request. */
export function looksLikeLookup(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (q.startsWith("@")) return true;
  return q.split(/\s+/).length <= 3 && !INTENT.test(q);
}

/** Best matches first: exact handle, then handle / name / project prefixes, then contains. */
export function quickFind<T extends Findable>(query: string, people: T[], limit = 6): T[] {
  const q = fold(query.trim().replace(/^@/, ""));
  if (q.length < 2) return [];
  const scored: { m: T; s: number }[] = [];
  for (const m of people) {
    const handle = fold(m.handle || "");
    const name = fold(m.name);
    const project = fold(m.project || "");
    let s = 0;
    if (handle === q) s = 100;
    else if (name === q) s = 90;
    else if (handle.startsWith(q)) s = 70;
    else if (name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))) s = 60;
    else if (project && project.startsWith(q)) s = 45;
    else if (q.length >= 3 && (handle.includes(q) || name.includes(q))) s = 30;
    else if (q.length >= 4 && project.includes(q)) s = 20;
    if (s) scored.push({ m, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.m.name.length - b.m.name.length).slice(0, limit).map((x) => x.m);
}
