"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle } from "lucide-react";
import { normalizeMaker, type Maker } from "../profile";
import { trackEvent } from "../analytics";

type Status = "claimed" | "existing" | "created" | "needs-place" | "conflict";

// After Sign in with X: remembers the pin as "mine" in this browser and shows
// what happened, with the one next step that matters.
export function JoinDone({ status, handle, name, avatarUrl }: { status: Status; handle: string; name: string; avatarUrl?: string }) {
  const [maker, setMaker] = useState<Maker | null>(null);
  const [loading, setLoading] = useState(true);
  const first = name.split(" ")[0];

  useEffect(() => {
    fetch("/api/me").then((r) => r.json() as Promise<{ maker?: Maker | null }>).then((data) => {
      if (data.maker) {
        const mine = normalizeMaker(data.maker);
        setMaker(mine);
        trackEvent("joined_with_x", { status, handle });
        try { localStorage.setItem("makersmap-own", JSON.stringify(mine)); } catch {}
      } else if (status === "needs-place") {
        // No pin yet: prefill the form with what X told us; the city is the one thing we couldn't read.
        try { localStorage.setItem("makersmap-own", JSON.stringify({ id: 100, name, handle, avatar: avatarUrl || "", city: "", lat: 0, lon: 0, claimed: false, source: "self", links: [{ kind: "X", url: `https://x.com/${handle}` }] })); } catch {}
      }
    }).catch(() => undefined).finally(() => setLoading(false));
  }, [status, handle, name, avatarUrl]);

  if (loading) return <div className="claim-done"><LoaderCircle size={24} className="spin" /><p>Setting up your pin…</p></div>;

  if (status === "conflict") {
    return (
      <div className="claim-done">
        <h1>That pin belongs to another account.</h1>
        <p>@{handle} was claimed from a different X account. If that&apos;s you on another login, sign in with that one.</p>
        <div className="project-hero-actions"><Link className="join-ghost" href="/">Back to the atlas</Link></div>
      </div>
    );
  }
  if (status === "needs-place") {
    return (
      <div className="claim-done">
        <Check size={28} />
        <h1>Welcome, {first}.</h1>
        <p>We couldn&apos;t tell which city you&apos;re in from your X profile. Pick it, add what you&apos;re building, and you&apos;re on the map.</p>
        <div className="project-hero-actions">
          <Link className="join-next" href="/?edit=1">Pick my city <ArrowUpRight size={15} /></Link>
        </div>
      </div>
    );
  }
  const where = maker ? `${maker.flag} ${maker.city}${maker.country && maker.country !== maker.city ? `, ${maker.country}` : ""}` : "";
  return (
    <div className="claim-done">
      <Check size={28} />
      <h1>{status === "existing" ? `Welcome back, ${first}.` : status === "claimed" ? `It's yours, ${first}.` : `You're on the map, ${first}.`}</h1>
      <p>
        {status === "created" && <>We built your pin from your X profile{where ? <> and placed you in <strong>{where}</strong></> : null}. Three quick questions make it useful: what you&apos;re building, what you&apos;re looking for, and whether you&apos;re up for coffee.</>}
        {status === "claimed" && <>Your listed pin is now your profile. Add a bio, what you&apos;re looking for, and your projects so people know why to say hello.</>}
        {status === "existing" && <>Your pin is ready. Edit it, share it, or go find someone to meet.</>}
      </p>
      <div className="project-hero-actions">
        <Link className="join-next" href="/?edit=1">{status === "existing" ? "Edit my pin" : "Answer the 3 questions"} <ArrowUpRight size={15} /></Link>
        <Link className="join-ghost" href={`/share/maker/${encodeURIComponent(handle)}`}>Share my pin on X</Link>
        <Link className="join-ghost" href={`/m/${handle}`}>See my page</Link>
      </div>
    </div>
  );
}
