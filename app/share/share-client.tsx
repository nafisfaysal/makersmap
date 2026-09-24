"use client";

import { useRef, useState } from "react";
import { useHydrated } from "../use-stored";
import { Check, Copy, Download, LoaderCircle, Orbit } from "lucide-react";
import { toPng } from "html-to-image";
import { SocialIcon } from "../social-icon";
import { trackEvent } from "../analytics";

export type Face = { avatar: string; initials: string; color: string; name: string };
export type ShareData = {
  kicker: string;          // "MAKER / 3672", "BERLIN", "POLAND"
  title: string;           // "Luis Rieke", "Berlin.", "Poland is #14"
  subtitle?: string;       // "@luisbu1lds · Berlin, Germany · Founder"
  lines: string[];         // up to three short facts
  faces: Face[];           // up to five
  stat?: { value: string; label: string };
  accent: string;
  path: string;            // makersmap.net/…
  postText: string;        // what to post with it
  fileName: string;
};

// One 1200x630 card that renders in the browser and downloads as a PNG, so
// people can post it on X. Variants differ only in data, not in code.
export function ShareClient({ data }: { data: ShareData }) {
  const card = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const hydrated = useHydrated();
  const origin = hydrated ? window.location.origin : "";
  const url = `${origin}${data.path}`;
  const postText = `${data.postText} ${url}`;

  const download = async () => {
    if (!card.current) return;
    setBusy(true); setError("");
    try {
      const dataUrl = await toPng(card.current, { pixelRatio: 2, cacheBust: true, backgroundColor: "#f4f6ec" });
      const link = document.createElement("a");
      link.download = `${data.fileName}.png`;
      link.href = dataUrl;
      link.click();
      trackEvent("share_card_downloaded", { card: data.fileName });
    } catch {
      setError("Couldn't render the image here. Try a different browser, or screenshot the card.");
    } finally { setBusy(false); }
  };
  const copyPost = async () => {
    try { await navigator.clipboard.writeText(postText); trackEvent("share_post_copied", { card: data.fileName }); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="card-wrap">
      <div className="card-stage">
        <div ref={card} className="share-card share-generic" style={{ ["--accent" as string]: data.accent }}>
          <div className="share-card-left">
            <div className="share-faces">
              {data.faces.slice(0, 5).map((f, i) => f.avatar
                ? <img key={i} src={f.avatar} alt="" crossOrigin="anonymous" />
                : <span key={i} className="share-card-initials" style={{ background: f.color }}>{f.initials}</span>)}
            </div>
            {data.stat && <div className="share-stat"><strong>{data.stat.value}</strong><span>{data.stat.label}</span></div>}
            <span className="share-card-number">{data.kicker}</span>
          </div>
          <div className="share-card-right">
            <div className="share-card-brand"><Orbit size={26} strokeWidth={1.8} />makersmap.</div>
            <h1>{data.title}</h1>
            {data.subtitle && <p className="share-card-handle">{data.subtitle}</p>}
            {data.lines.map((line) => <p key={line} className="share-card-place">{line}</p>)}
            <p className="share-card-url">makersmap.net{data.path}</p>
          </div>
        </div>
      </div>
      <div className="card-actions">
        <button type="button" className="join-next" onClick={() => void download()} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}Download PNG</button>
        <button type="button" className="join-ghost" onClick={() => void copyPost()}>{copied ? <><Check size={15} />Copied</> : <><Copy size={15} />Copy a post to go with it</>}</button>
        <a className="join-ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(postText)}`} target="_blank" rel="noopener"><SocialIcon kind="X" size={14} />Open X composer</a>
      </div>
      {error && <p className="ask-error">{error}</p>}
      <p className="claim-fine">Download the image, then attach it to the post. X shows attached images far more than link previews.</p>
    </div>
  );
}
