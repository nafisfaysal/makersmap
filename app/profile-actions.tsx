"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Bookmark, Box, Check, Clock, Coffee, Copy, ExternalLink, Info, MessageCircle, Pin, PinOff, Sparkles, Users, X } from "lucide-react";
import { money } from "./data";
import { ProductIcon } from "./maker-ui";
import { OutboundLink } from "./outbound";
import { urlHostname } from "./http";
import Link from "next/link";
import { projectPath } from "./handle";
import { ownerHeaders } from "./own-key";
import { parseIds, useHydrated, useStoredState } from "./use-stored";
import { formatRevenueDate, isCoffeeThisWeek, isOpenInPerson, isOpenToConnect, lookingForText, makerMrr, normalizeMaker, profileCompleteness, xHandleOf, xMessageUrl, type Maker, type Project } from "./profile";
import { SocialIcon } from "./social-icon";
import { trackEvent } from "./analytics";

const SAVED_KEY = "makersmap-saved";
const parseOwnRaw = (raw: string | null): string => raw || "";
const OWN_KEY = "makersmap-own";


function draftFor(maker: Maker): string {
  const reason = maker.lookingFor.length ? " You're looking for " + lookingForText(maker.lookingFor) + "." : "";
  return "Hey " + maker.name.split(" ")[0] + " — I saw " + (maker.project || "your work") + " on MakersMap." + reason + " I'd like to say hello.";
}

// Save, say hello, and remove-my-pin need browser state, so they live in a
// client island on the otherwise server-rendered public page. The hello draft
// expands inline rather than opening a dialog.
export function ProfileActions({ maker }: { maker: Maker }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [coffeeWeek, setCoffeeWeek] = useState<string | undefined>(maker.coffeeWeek);
  const [savingCoffee, setSavingCoffee] = useState(false);
  const [pinned, setPinned] = useState(maker.x?.pinned !== false);
  const [savingPin, setSavingPin] = useState(false);
  const [pinError, setPinError] = useState("");

  // Owner only: the intro post stays on the profile until they unpin it. The
  // server checks the X session, so this only works for the account that posted it.
  const togglePinned = async () => {
    setSavingPin(true); setPinError("");
    try {
      const response = await fetch("/api/makers/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: maker.handle, pinned: !pinned }) });
      const data = await response.json() as { pinned?: boolean; error?: string };
      if (!response.ok) { setPinError(data.error || "Couldn't change the pinned post."); return; }
      setPinned(Boolean(data.pinned));
      trackEvent("post_pin_toggled", { handle: maker.handle, pinned: Boolean(data.pinned) });
      router.refresh();
    } catch { setPinError("Couldn't change the pinned post."); }
    finally { setSavingPin(false); }
  };

  const [savedIds, setSavedIds] = useStoredState<number[]>(SAVED_KEY, parseIds);
  const [ownRaw] = useStoredState<string>(OWN_KEY, parseOwnRaw);
  const saved = savedIds.includes(maker.id);
  const own = (() => {
    try {
      const raw = JSON.parse(ownRaw || "null");
      if (!raw || typeof raw.name !== "string") return false;
      const mine = normalizeMaker(raw);
      return mine.id === maker.id || (Boolean(mine.handle) && mine.handle === maker.handle);
    } catch { return false; }
  })();

  const signal = (kind: "save" | "message") => { trackEvent(kind === "message" ? "message_clicked" : "profile_saved_to_shelf", { handle: maker.handle }); if (maker.handle) fetch("/api/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: maker.handle, kind }), keepalive: true }).catch(() => undefined); };
  const toggleSave = () => {
    if (!saved) signal("save");
    setSavedIds((list) => (list.includes(maker.id) ? list.filter((id) => id !== maker.id) : [...list, maker.id]));
  };

  const startHello = () => {
    if (!open) {
      setMessage(draftFor(maker));
      setCopied(false);
    }
    setOpen(!open);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  // Owner only: flips the "up for coffee this week" flag and saves the whole pin,
  // the same way the join form does, so nothing else about the profile changes.
  const toggleCoffeeWeek = async () => {
    const next = isCoffeeThisWeek({ coffeeWeek }) ? null : new Date().toISOString().slice(0, 10);
    setSavingCoffee(true);
    try {
      const payload = {
        id: maker.id !== 100 ? maker.id : undefined,
        name: maker.name, city: maker.city, country: maker.country, flag: maker.flag, lat: maker.lat, lon: maker.lon,
        role: maker.role, tags: maker.tags, bio: maker.bio, lookingFor: maker.lookingFor, canHelpWith: maker.canHelpWith,
        openToMeeting: maker.openToMeeting, coffee: maker.coffee, color: maker.color, avatar: maker.avatar, handle: maker.handle,
        projects: maker.projects, links: maker.links, skills: maker.skills, workSamples: maker.workSamples,
        latestUpdate: maker.latestUpdate, connect: maker.connect, stage: maker.stage, claimed: true, source: "self",
        coffeeWeek: next,
      };
      const response = await fetch("/api/makers", { method: "POST", headers: { "Content-Type": "application/json", ...ownerHeaders() }, body: JSON.stringify(payload) });
      const data = await response.json() as { maker?: Maker; error?: string };
      if (!response.ok || !data.maker) { setPinError(data.error || "Couldn't save that. Sign in with X if this is your pin."); return; }
      const saved = normalizeMaker(data.maker);
      trackEvent("profile_updated", { handle: saved.handle });
      setCoffeeWeek(saved.coffeeWeek);
      try { localStorage.setItem(OWN_KEY, JSON.stringify(saved)); } catch {}
      router.refresh();
    } catch {
      setPinError("Couldn't reach the server.");
    } finally {
      setSavingCoffee(false);
    }
  };

  const removePin = () => {
    try { localStorage.removeItem(OWN_KEY); } catch {}
    router.push("/");
  };

  return (
    <div className="public-profile-actions">
      <p className="passport-availability">
        {isCoffeeThisWeek({ coffeeWeek }) ? <><Coffee size={17} />Up for coffee this week</> : isOpenInPerson(maker) ? <><Users size={17} />Open to meet in person</> : isOpenToConnect(maker) ? <><MessageCircle size={17} />Open to connect</> : <><Box size={17} />Building in public</>}
      </p>
      {own && (
        <button type="button" className={"coffee-week-toggle" + (isCoffeeThisWeek({ coffeeWeek }) ? " on" : "")} onClick={toggleCoffeeWeek} disabled={savingCoffee} aria-pressed={isCoffeeThisWeek({ coffeeWeek })}>
          <Coffee size={15} />{savingCoffee ? "Saving…" : isCoffeeThisWeek({ coffeeWeek }) ? "I'm up for coffee this week" : "Say you're up for coffee this week"}
        </button>
      )}
      {xHandleOf(maker) && (
        <a className="join-next full-width public-profile-hello" href={xMessageUrl(maker, draftFor(maker))} target="_blank" rel="noopener" onClick={() => signal("message")}>
          <SocialIcon kind="X" size={15} />
          Message {maker.name.split(" ")[0]} on X
        </a>
      )}
      <button type="button" className={(xHandleOf(maker) ? "join-ghost" : "join-next") + " full-width public-profile-hello"} onClick={startHello} aria-expanded={open}>
        <MessageCircle size={16} />
        {open ? "Close the draft" : xHandleOf(maker) ? "Write a draft first" : `Say hello to ${maker.name.split(" ")[0]}`}
      </button>
      {open && (
        <div className="public-profile-draft">
          <label>
            A conversation starter. Add your voice before sending.
            <textarea aria-label="Your introduction" rows={6} value={message} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <div className="public-profile-draft-actions">
            <button type="button" className="join-next" onClick={copy} disabled={!message.trim()}>
              {copied ? <><Check size={15} />Copied</> : <><Copy size={15} />Copy introduction</>}
            </button>
            <button type="button" className="join-ghost" onClick={() => setOpen(false)}><X size={15} />Cancel</button>
          </div>
          <p className="form-note">This is a draft only. Nothing is sent from MakersMap.</p>
        </div>
      )}
      <button type="button" className={"passport-save" + (saved ? " is-saved" : "")} onClick={toggleSave} aria-pressed={saved}>
        <Bookmark size={16} />
        {saved ? "Saved to your people" : "Save this maker"}
      </button>
      <span className="passport-demo">
        {maker.claimed ? "This pin is claimed" : maker.source === "x-intro" ? "Listed from a public intro post. Not claimed yet." : own ? "Your local preview" : "Community pin"}
      </span>
      {own && maker.x?.postText && (
        <button type="button" className="coffee-week-toggle" onClick={togglePinned} disabled={savingPin} aria-pressed={pinned}>
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}{savingPin ? "Saving…" : pinned ? "Unpin my intro post" : "Pin my intro post again"}
        </button>
      )}
      {pinError && <p className="ask-error">{pinError}</p>}
      {own && maker.handle && <OwnerTools handle={maker.handle} emailUpdates={maker.emailUpdates} />}
      {own && <CompletenessNudge maker={maker} />}
      {own && (
        <button type="button" className="remove-pin" onClick={removePin}>Remove my pin</button>
      )}
    </div>
  );
}

// Owner-only: the share card and a personal invite link.
function OwnerTools({ handle, emailUpdates }: { handle: string; emailUpdates?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [updates, setUpdates] = useState(emailUpdates !== false);
  const [updatesNote, setUpdatesNote] = useState("");
  const toggleUpdates = async () => {
    const next = !updates;
    try {
      const response = await fetch("/api/makers/email-updates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, enabled: next }) });
      const data = await response.json() as { enabled?: boolean; hasEmail?: boolean; error?: string };
      if (!response.ok) { setUpdatesNote(data.error || "Couldn't change this."); return; }
      setUpdates(Boolean(data.enabled));
      setUpdatesNote(data.enabled && !data.hasEmail ? "Add an email on your profile to receive it." : "");
    } catch { setUpdatesNote("Couldn't reach the server."); }
  };
  const hydrated = useHydrated();
  const origin = hydrated ? window.location.origin : "";
  const inviteUrl = `${origin}/?invite=${encodeURIComponent(handle)}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch {}
  };
  return (
    <div className="owner-tools">
      <Link className="join-ghost" href={`/m/${handle}/card`}><Sparkles size={14} />Share my card</Link>
      <button type="button" className="join-ghost" onClick={() => void copy()}>{copied ? <><Check size={14} />Invite link copied</> : <><Copy size={14} />Copy my invite link</>}</button>
      <label className="owner-toggle">
        <input type="checkbox" checked={updates} onChange={() => void toggleUpdates()} />
        Weekly email: who looked at my pin, who&apos;s new nearby
      </label>
      {updatesNote && <small className="owner-note">{updatesNote}</small>}
    </div>
  );
}

// Shown only to the owner. Says what to add next rather than just a percentage.
function CompletenessNudge({ maker }: { maker: Maker }) {
  const { score, missing } = profileCompleteness(maker);
  if (score >= 100) return null;
  const next = missing.slice(0, 2).join(" and ");
  return (
    <div className="profile-nudge" role="status">
      <div className="profile-nudge-bar" aria-hidden="true"><span style={{ width: `${score}%` }} /></div>
      <p><strong>{score}% complete.</strong> Add {next} so people know why to say hello.</p>
      <Link href="/?edit=1">Edit my pin</Link>
    </div>
  );
}

// Local time renders on the client because the server doesn't know the viewer's clock.
export function LocalTime({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      try {
        setNow(new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date()));
      } catch {
        setNow(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, [timezone]);
  let offset = "";
  try {
    offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value || "";
  } catch {}
  if (!now) return null;
  return <span className="public-profile-time"><Clock size={13} />{now} local{offset ? ` · ${offset}` : ""}</span>;
}

export function ProjectCard({ maker, project, index }: { maker: Maker; project: Project; index: number }) {
  const mrr = project.revenue?.mrr ?? null;
  const label = project.revenue?.kind === "verified" ? "Verified" : "Self-reported";
  const when = project.revenue?.updatedAt ? formatRevenueDate(project.revenue.updatedAt) : "";
  const site = urlHostname(project.website);
  return (
    <article className={"project-card" + (index === 0 ? " primary" : "")}>
      <header className="project-card-head">
        <ProductIcon maker={maker} size={46} name={project.name} color={project.color} logo={project.logo} />
        <div className="project-card-title">
          <h2>{maker.handle ? <Link href={projectPath(maker.handle, project.id)}>{project.name}</Link> : project.name}</h2>
          {project.tagline && <p className="project-pitch">{project.tagline}</p>}
          <p>{project.description || "No description yet."}</p>
        </div>
        {project.stage && <span className="stage-tag">{project.stage}</span>}
      </header>
      <div className="project-card-links">
        {project.website && (
          <OutboundLink className="project-card-site" href={project.website} maker={maker} referral="project">
            {site || "Project website"} <ExternalLink size={13} />
          </OutboundLink>
        )}
        {maker.handle && (
          <Link className="project-card-site" href={projectPath(maker.handle, project.id)}>
            Project page <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
      {mrr !== null ? (
        <div className="project-card-revenue">
          <div className="project-card-numbers">
            <div><span>Monthly recurring</span><strong>{money(mrr)}</strong><small>MRR / USD</small></div>
            {/* Trend and growth are illustrative and only exist for demo profiles. Real makers report a single number. */}
          </div>
          <p className="project-card-source"><Info size={12} />{label}{when ? ` · updated ${when}` : ""}</p>
        </div>
      ) : (
        <div className="project-card-early"><Sparkles size={16} />Pre-revenue · {project.stage ? project.stage.toLowerCase() : "building"} in public</div>
      )}
    </article>
  );
}

export function ProjectsSection({ maker }: { maker: Maker }) {
  const [activeId, setActiveId] = useState(maker.projects[0]?.id);
  const total = makerMrr(maker);
  const count = maker.projects.length;
  if (!count) return null;
  const active = maker.projects.find((p) => p.id === activeId) || maker.projects[0];
  const activeIndex = maker.projects.indexOf(active);
  const withRevenue = maker.projects.filter((p) => p.revenue?.mrr != null).length;
  return (
    <section className="public-profile-projects">
      <div className="public-projects-head">
        <span className="section-kicker">{count > 1 ? `Building ${count} projects` : "Currently building"}</span>
        {count > 1 && total !== null && (
          <span className="public-projects-total"><strong>{money(total)}</strong> MRR across {withRevenue} {withRevenue === 1 ? "project" : "projects"}</span>
        )}
      </div>
      {count > 1 && (
        <div className="project-tabs" role="tablist" aria-label="Projects">
          {maker.projects.map((project) => {
            const selected = project.id === active.id;
            return (
              <button
                key={project.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={"project-tab" + (selected ? " selected" : "")}
                onClick={() => setActiveId(project.id)}
              >
                <ProductIcon maker={maker} size={30} name={project.name} color={project.color} logo={project.logo} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.revenue?.mrr != null ? `${money(project.revenue.mrr)} MRR` : project.stage || "Pre-revenue"}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div role={count > 1 ? "tabpanel" : undefined} key={active.id} className="project-panel">
        <ProjectCard maker={maker} project={active} index={activeIndex} />
      </div>
    </section>
  );
}
