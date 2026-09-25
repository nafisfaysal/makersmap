"use client";

import { useMemo, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { AskFilters } from "@/lib/ask";
import { looksLikeLookup, quickFind } from "@/lib/quick-find";
import { Avatar } from "./maker-ui";
import type { Maker } from "./profile";

export type AskHit = {
  handle: string; reason: string; name?: string; role?: string; city?: string; flag?: string;
  avatar?: string; initials?: string; color?: string; project?: string;
};
export type AskOutcome = { query: string; summary: string; filters: AskFilters; results: AskHit[]; source: "claude" | "rules" };

const examples = [
  "a designer in Berlin who's into open source and wants feedback",
  "founders in Lisbon up for coffee this week",
  "someone who can help with marketing for a SaaS",
  "find me a cofounder: a developer who's into AI and wants to build a product",
  "designers in Warsaw open to meet this week",
];

export function AskAtlas({ onResult, onClear, active, people = [], onPick }: { onResult: (outcome: AskOutcome) => void; onClear: () => void; active: AskOutcome | null; people?: Maker[]; onPick?: (m: Maker) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  // Names, handles, projects: answered in the browser on every keystroke, no round trip.
  const hits = useMemo(() => quickFind(query, people), [query, people]);
  const pick = (m: Maker) => { setOpen(false); setQuery(""); onPick?.(m); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [refining, setRefining] = useState(false);
  const latest = useRef("");

  const call = async (q: string, fast: boolean) => {
    const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, fast }) });
    const data = await response.json() as Partial<AskOutcome> & { error?: string };
    if (!response.ok || !data.filters) throw new Error(data.error || "Could not search right now.");
    return { query: q, summary: data.summary || "", filters: data.filters, results: data.results || [], source: data.source || "rules" } as AskOutcome;
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    // A name or handle with a local match needs no server at all.
    if (onPick && looksLikeLookup(q) && hits.length) { pick(hits[Math.min(cursor, hits.length - 1)]); return; }
    setOpen(false);
    latest.current = q;
    setBusy(true);
    setError("");
    // Two passes: keyword matches land in a few hundred milliseconds, then the model's ranking replaces them.
    try {
      const quick = await call(q, true);
      if (latest.current !== q) return;
      onResult(quick);
      setBusy(false);
      if (looksLikeLookup(q)) return;
      setRefining(true);
      const smart = await call(q, false).catch(() => null);
      if (smart && latest.current === q && smart.source === "claude" && smart.results.length) onResult(smart);
    } catch (e) {
      if (latest.current === q) setError(e instanceof Error ? e.message : "Could not reach the atlas.");
    } finally {
      if (latest.current === q) { setBusy(false); setRefining(false); }
    }
  };

  return (
    <div className="ask-atlas">
      <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(query); }}>
        <Sparkles size={17} />
        <Input aria-label="Ask the atlas" role="combobox" aria-expanded={open && hits.length > 0} aria-controls="ask-suggest" aria-autocomplete="list" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setCursor(0); }}
          onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % hits.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + hits.length) % hits.length); }
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a name or @handle, or ask: a designer in Berlin who's into open source…" maxLength={300} />
        <button type="submit" className="ask-submit" disabled={busy || !query.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : "Ask"}</button>
      </form>
      {open && hits.length > 0 && (
        <ul id="ask-suggest" className="ask-suggest" role="listbox">
          {hits.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === cursor}>
              <button type="button" className={i === cursor ? "active" : undefined} onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setCursor(i)}>
                <Avatar maker={m} size={30} />
                <span><strong>{m.name}</strong><small>{m.handle ? `@${m.handle} · ` : ""}{m.flag} {m.city || m.country}{m.project ? ` · ${m.project}` : ""}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!active && !busy && (
        <div className="ask-examples">
          {examples.map((example) => <button key={example} type="button" onClick={() => { setQuery(example); void ask(example); }}>{example}</button>)}
        </div>
      )}
      {error && <p className="ask-error">{error}</p>}
      {active && (
        <div className="ask-results" role="region" aria-label="Ask results">
          <div className="ask-results-head">
            <p><strong>{active.summary}</strong> <span>{active.source === "claude" ? "Ranked by AI" : refining ? "Matched on profiles · refining with AI…" : "Matched on profiles"} · {active.results.length} {active.results.length === 1 ? "person" : "people"}</span></p>
            <button type="button" onClick={() => { latest.current = ""; setRefining(false); onClear(); setQuery(""); }}><X size={14} />Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
