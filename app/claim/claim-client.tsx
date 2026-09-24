"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { SocialIcon } from "../social-icon";
import { profilePath } from "../handle";
import { trackEvent } from "../analytics";

type Pin = {
  name: string; handle: string; city: string; country: string; flag: string; role: string;
  avatar: string; initials: string; color: string; claimed: boolean; postText: string; postUrl: string; listedFromX: boolean;
};

export function ClaimClient({ handle, configured, error, session, pin }: {
  handle: string; configured: boolean; error: string;
  session: { username: string; name: string; email?: string } | null; pin: Pin | null;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(error);
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState(session?.email || "");

  const claim = async () => {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, email: email.trim() || undefined }) });
      const data = await response.json() as { maker?: unknown; error?: string };
      if (!response.ok || !data.maker) { setProblem(data.error || "Could not claim the pin."); return; }
      try { localStorage.setItem("makersmap-own", JSON.stringify(data.maker)); } catch {}
      trackEvent("pin_claimed", { handle, withEmail: Boolean(email.trim()) });
      setDone(true);
    } catch {
      setProblem("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const signInHref = `/api/auth/x/start?next=${encodeURIComponent(`/claim${handle ? `?handle=${encodeURIComponent(handle)}` : ""}`)}`;

  if (done && pin) {
    return (
      <div className="claim-done">
        <Check size={28} />
        <h1>It&apos;s yours, {pin.name.split(" ")[0]}.</h1>
        <p>Your pin is claimed. Add a bio, what you&apos;re looking for, and your projects so people know why to say hello.</p>
        <div className="project-hero-actions">
          <Link className="join-next" href={`/share/maker/${encodeURIComponent(pin.handle)}`}>Share my pin on X <ArrowUpRight size={15} /></Link>
          <Link className="join-ghost" href="/?edit=1">Finish my profile</Link>
          <Link className="join-ghost" href={profilePath(pin.handle)}>See my page</Link>
        </div>
        <p className="claim-fine">The share card shows your city and your number on the map. Posting it is how your friends find their own pins.</p>
      </div>
    );
  }

  return (
    <div className="claim">
      <div className="claim-intro">
        <span className="section-kicker">Claim your pin</span>
        <h1>{pin ? `Is this you, ${pin.name.split(" ")[0]}?` : "Find your pin"}</h1>
        <p>Pins listed from public intro posts show only your name, handle, city, and the post. Claiming makes it your profile: you control every word, and it becomes searchable.</p>
      </div>

      {pin ? (
        <div className="claim-pin">
          {pin.avatar ? <img className="avatar" src={pin.avatar} alt="" width={64} height={64} /> : <span className="avatar initials" style={{ width: 64, height: 64, background: pin.color }}>{pin.initials}</span>}
          <div>
            <strong>{pin.name}</strong>
            <small>@{pin.handle} · {pin.flag} {pin.city}{pin.country ? `, ${pin.country}` : ""} · {pin.role}</small>
            {pin.postText && <blockquote>{pin.postText}</blockquote>}
          </div>
        </div>
      ) : handle ? (
        <p className="ask-error">No pin found for @{handle}. If you posted an intro recently it may not be imported yet, or you can <Link href="/?edit=1">add yourself</Link>.</p>
      ) : null}

      {problem && <p className="ask-error">{problem}</p>}

      {pin?.claimed ? (
        <p className="claim-note"><ShieldCheck size={16} />This pin is already claimed. <Link href={profilePath(pin.handle)}>See the profile</Link>.</p>
      ) : !configured ? (
        <p className="claim-note">Sign in with X isn&apos;t set up on this server yet, so claiming is paused. Ask the operator to add the X app credentials.</p>
      ) : session ? (
        <div className="claim-actions">
          <p className="claim-note">Signed in as <strong>@{session.username}</strong>.</p>
          <label className="claim-email">
            Your email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" maxLength={120} />
            <small>Private. Only for messages about your pin and the people who want to meet you. Never shown on the site.</small>
          </label>
          {pin && !pin.claimed && (
            <button type="button" className="join-next" disabled={busy} onClick={() => void claim()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Yes, claim this pin
            </button>
          )}
          <form method="post" action="/api/auth/x/logout"><button type="submit" className="join-ghost">Not you? Sign out</button></form>
        </div>
      ) : (
        <div className="claim-actions">
          <a className="join-next" href={signInHref}><SocialIcon kind="X" size={15} />Sign in with X to claim</a>
          <p className="claim-fine">We only read which account you are. Nothing is posted, followed, or stored beyond your user id.</p>
        </div>
      )}

      {pin && !pin.claimed && pin.listedFromX && (
        <p className="claim-remove">Don&apos;t want to be on the map? <Link href={`/remove?handle=${encodeURIComponent(pin.handle)}`}>Remove this pin</Link>. No sign-in needed.</p>
      )}
    </div>
  );
}
