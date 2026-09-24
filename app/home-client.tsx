"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Bookmark, Box, Globe2, Map as MapIcon, Plus, Search, SlidersHorizontal, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import AtlasMap, { type PlaceSelection, type Region } from "./atlas-map";
import { AskAtlas, type AskOutcome } from "./ask-atlas";
import { JoinMap } from "./join-map";
import { isPlaced, normalizeMaker, roleGroupOptions, type Maker } from "./profile";
import { profilePath } from "./handle";
import { ownerHeaders, storeEditKey } from "./own-key";
import { useHydrated } from "./use-stored";
import { useMakersData } from "./home/use-makers-data";
import { useShelf } from "./home/use-shelf";
import { MakerCard } from "./home/maker-card";
import { PlacePeople } from "./home/place-people";
import { ProjectsTab } from "./home/projects-tab";
import { FiltersDialog } from "./home/filters-dialog";
import { BrandMark } from "@/app/brand";
import { trackEvent } from "@/app/analytics";

const regionFor = (m: Maker): Region => (m.lon < -25 ? "Americas" : m.lon > 60 ? "Asia Pacific" : "Europe");
const makerHref = (m: Maker) => (m.handle ? profilePath(m.handle) : "/");

// The home page: the atlas tab (map, filters, people list, discovery grid) and
// the projects tab. Data lives in useMakersData, filtering and ranking in useShelf.
export function HomeClient({ tab: initialTab = "explore" }: { tab?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useHydrated();
  const [tab, setTab] = useState(initialTab);
  const data = useMakersData(tab === "projects");
  const { all, own, setOwn, saved, toggleSave, full, ensureDetails, makersLoaded } = data;
  const shelfState = useShelf(all, saved, own);
  const { filters, patch, clearFilters, asked, setAsked, filtered, ranked, shelf, sentinel, noteSeen, askReason, activeFilters } = shelfState;

  // Map state
  const mapAnchor = useRef<HTMLDivElement>(null);
  const [mapView, setMapView] = useState("globe");
  const [region, setRegion] = useState<Region>("World");
  const [focusRequest, setFocusRequest] = useState(0);
  const [regionRequest, setRegionRequest] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [placeSelection, setPlaceSelection] = useState<PlaceSelection | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const placed = useMemo(() => filtered.filter(isPlaced), [filtered]);
  // Nobody is highlighted until someone picks a maker on the map, a card, or "Surprise me".
  const selected = selectedId == null ? undefined : placed.find((m) => m.id === selectedId);

  const select = useCallback((m: Maker) => { setSelectedId(m.id); setFocusRequest((n) => n + 1); setRegion(regionFor(m)); }, []);
  const selectFromShelf = (m: Maker) => { noteSeen(m); select(m); mapAnchor.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); };
  const surprise = () => {
    const options = filtered.filter((m) => m.id !== selectedId);
    const pick = options[Math.floor(Math.random() * options.length)] || filtered[0];
    if (pick) select(pick); else toast("Clear a filter to find someone new.");
  };
  const applyAsk = (outcome: AskOutcome) => {
    clearFilters();
    setAsked(outcome);
    trackEvent("ask_atlas", { query: outcome.query.slice(0, 120), results: outcome.results.length, source: outcome.source });
    setTab("explore");
    const first = all.find((m) => m.handle === outcome.results[0]?.handle);
    if (first) select(first);
  };

  // Card details for the visible grid.
  useEffect(() => { ensureDetails(shelf.map((m) => m.id)); }, [shelf, ensureDetails]);

  // Links into the atlas: /?maker=handle focuses a pin, /?edit=1 opens the form, /?invite=handle remembers who sent you.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    if (openedFromUrl.current || !makersLoaded || !hydrated || initialTab !== "explore") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("invite")) {
      try { localStorage.setItem("makersmap-invite", params.get("invite") as string); } catch {}
      window.history.replaceState(null, "", window.location.pathname);
      toast(`You were invited by @${params.get("invite")}. Add yourself to appear next to them.`);
      return;
    }
    if (params.has("edit")) {
      openedFromUrl.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the form is the whole point of the ?edit link
      setAddOpen(true);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    const wanted = params.get("maker")?.toLowerCase();
    if (!wanted) return;
    openedFromUrl.current = true;
    const match = all.find((m) => m.handle === wanted);
    if (!match) return;
    clearFilters();
    select(match);
    window.history.replaceState(null, "", window.location.pathname);
  }, [makersLoaded, hydrated, all, initialTab, clearFilters, select]);

  // Back and forward buttons move between the tabs' URLs.
  useEffect(() => {
    const onPop = () => setTab(window.location.pathname.startsWith("/projects") ? "projects" : "explore");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Keep the selected card in view when the selection comes from the map.
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = grid.current?.querySelector<HTMLElement>(".maker-card.selected");
    if (!card) return;
    const item = card.getBoundingClientRect();
    if (item.top < 0 || item.bottom > window.innerHeight) card.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [selected?.id, tab]);

  const saveOwn = async (m: Maker) => {
    let savedPin = normalizeMaker({ ...m, claimed: true, source: "self" });
    try {
      const response = await fetch("/api/makers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({
          id: own?.id && own.id !== 100 ? own.id : undefined,
          name: savedPin.name, email: savedPin.email, city: savedPin.city, country: savedPin.country, flag: savedPin.flag, lat: savedPin.lat, lon: savedPin.lon,
          role: savedPin.role, tags: savedPin.tags, project: savedPin.project, description: savedPin.description, website: savedPin.website, bio: savedPin.bio,
          lookingFor: savedPin.lookingFor, canHelpWith: savedPin.canHelpWith, stage: savedPin.stage, connect: savedPin.connect, openToMeeting: savedPin.openToMeeting,
          coffee: savedPin.coffee, color: savedPin.color, avatar: savedPin.avatar, handle: savedPin.handle, projects: savedPin.projects, links: savedPin.links,
          skills: savedPin.skills, workSamples: savedPin.workSamples,
          invitedBy: (() => { try { return localStorage.getItem("makersmap-invite") || undefined; } catch { return undefined; } })(),
          claimed: true, source: "self",
        }),
      });
      const result = await response.json() as { maker?: Maker; editKey?: string; error?: string };
      if (response.status === 409 || response.status === 403) throw new Error(result.error || "That handle is already taken.");
      if (response.ok && result.maker) {
        if (result.editKey) storeEditKey(result.editKey);
        savedPin = normalizeMaker(result.maker);
        toast.success(savedPin.handle ? `You're on the map as @${savedPin.handle}` : "Your pin is on the atlas.");
      } else {
        toast.success("Your pin is on this device. The public page will appear once the atlas is reachable.");
      }
    } catch (cause) {
      if (cause instanceof Error && /already taken|own this pin|belongs to/i.test(cause.message)) throw cause;
      toast.success("Your pin is on this device.");
    }
    setOwn(savedPin);
    clearFilters();
    select(savedPin);
    setTab("explore");
    setAddOpen(false);
    router.push("/");
  };

  return (
    <div className="app-shell">
      <Tabs value={tab} onValueChange={(value) => {
        // Both tabs render this same component, so switching is a state change plus a URL update,
        // not a navigation. That keeps it instant and avoids the router aborting an in-flight request.
        const href = value === "projects" ? "/projects" : "/";
        setTab(value);
        trackEvent("tab_opened", { tab: value });
        if (pathname !== href) window.history.pushState(null, "", href);
        document.title = value === "projects" ? "Projects · MakersMap" : "MakersMap — A world of good company";
      }}>
        <header className="app-header">
          <Link className="brand" href="/" onClick={() => { setTab("explore"); clearFilters(); }} aria-label="MakersMap home">
            <BrandMark />makersmap<span className="brand-period">.</span>
          </Link>
          <TabsList className="main-nav" aria-label="Main navigation">
            <TabsTrigger value="explore"><Globe2 size={16} />Atlas</TabsTrigger>
            <TabsTrigger value="projects"><Box size={16} />Projects</TabsTrigger>
          </TabsList>
          <Link className="header-link" href="/leaderboard" aria-label="Leaderboard"><Trophy size={16} /><span>Leaderboard</span></Link>
          <Button className="primary add-button" aria-label={own ? "Edit your pin" : "Find your place"} onClick={() => { if (own) setAddOpen(true); else router.push("/join"); }}>
            <span>{own ? "Edit your pin" : "Find your place"}</span><Plus size={18} />
          </Button>
        </header>

        <TabsContent className="app-panel" value={tab}>
          {tab === "explore" ? (
            <main className="atlas-page">
              <div className="atlas-heading">
                <div className="atlas-title">
                  <span className="section-kicker">THE COMMUNITY ATLAS</span>
                  <h1>A world of good company</h1>
                </div>
              </div>

              <AskAtlas onResult={applyAsk} onClear={() => setAsked(null)} active={asked} />

              <div className="atlas-filters">
                <ToggleGroup type="single" value={filters.role} onValueChange={(role) => { if (role) patch({ role }); }} className="role-filters" aria-label="Filter by role">
                  {["All makers", ...roleGroupOptions].map((r) => (
                    <ToggleGroupItem key={r} value={r}>{r === "All makers" ? "Everyone" : r}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className="filter-divider" />
                <button className={"filter-chip" + (filters.nearby ? " active" : "")} aria-pressed={filters.nearby} onClick={() => patch({ nearby: !filters.nearby })}><Users size={16} />Meet nearby</button>
                <button className={"filter-chip" + (filters.savedOnly ? " active" : "")} aria-pressed={filters.savedOnly} onClick={() => patch({ savedOnly: !filters.savedOnly })}><Bookmark size={15} />Saved{saved.length > 0 && <span>{saved.length}</span>}</button>
                <button className={"filter-chip more-filters" + (activeFilters ? " active" : "")} aria-haspopup="dialog" aria-expanded={filterOpen} onClick={() => setFilterOpen(true)}><SlidersHorizontal size={16} />Filters{activeFilters > 0 && <span>{activeFilters}</span>}</button>
              </div>

              <div ref={mapAnchor} className={"map-stage " + (mapView === "globe" ? "view-globe" : "view-flat")}>
                <ToggleGroup type="single" value={mapView} onValueChange={(v) => { if (v) setMapView(v); }} aria-label="Map view" className="map-view-switch">
                  <ToggleGroupItem value="globe" aria-label="3D globe"><Globe2 size={15} />Globe</ToggleGroupItem>
                  <ToggleGroupItem value="map" aria-label="2D map"><MapIcon size={15} />Map</ToggleGroupItem>
                </ToggleGroup>
                <AtlasMap
                  people={placed}
                  selected={selected}
                  onSelect={select}
                  onMeet={(m) => router.push(makerHref(m))}
                  region={region}
                  setRegion={(r) => { setRegion(r); setRegionRequest((n) => n + 1); }}
                  mapView={mapView}
                  onSurprise={surprise}
                  focusRequest={focusRequest}
                  regionRequest={regionRequest}
                  onPlace={(s) => { setPlaceSelection(s); if (s) trackEvent("place_selected", { place: s.name, kind: s.kind, makers: s.makers.length }); }}
                />
              </div>

              {placeSelection && <PlacePeople selection={placeSelection} onClose={() => setPlaceSelection(null)} onHover={select} />}

              <section className="discovery-section" aria-label="Discover makers">
                <div className="discovery-heading">
                  <h2>{asked ? "Your best matches" : filters.savedOnly ? "Your people" : "Meet someone interesting"}<span>{filtered.length.toString().padStart(2, "0")}</span></h2>
                  <div className="shelf-controls"><span>Select a maker to find them on the globe</span></div>
                </div>
                <div className="maker-shelf" ref={grid}>
                  {shelf.map(full).map((m) => (
                    <MakerCard key={m.id} maker={m} selected={selected?.id === m.id} isOwn={Boolean(own && m.id === own.id)} saved={saved.includes(m.id)} reason={askReason(m)} onSelect={selectFromShelf} onToggleSave={toggleSave} onOpen={(m) => { noteSeen(m); trackEvent("profile_opened", { handle: m.handle, from: "cards" }); }} />
                  ))}
                </div>
                {ranked.length > shelf.length && (
                  <div ref={sentinel} className="shelf-sentinel" aria-live="polite">Showing {shelf.length} of {ranked.length} · loading more as you scroll</div>
                )}
                {!filtered.length && (
                  <div className="empty-state">
                    <Search size={24} />
                    <h3>{asked ? "Nobody matches that yet." : "No makers match just yet."}</h3>
                    <p>{asked ? "Try asking for a role, a city, or an interest." : "Try another place, project, or interest."}</p>
                    <Button variant="outline" onClick={clearFilters}>Reset filters</Button>
                  </div>
                )}
              </section>
              <footer className="atlas-footer">
                <span>Independent minds. Shared coordinates.</span>
                <Link href="/about">Listed from public intro posts · claim yours<ArrowUpRight size={13} /></Link>
              </footer>
            </main>
          ) : tab === "projects" ? (
            <ProjectsTab catalogue={data.catalogue} saved={saved} onToggleSave={toggleSave} />
          ) : null}
        </TabsContent>
      </Tabs>

      <FiltersDialog open={filterOpen} onOpenChange={setFilterOpen} filters={filters} patch={patch} clear={clearFilters} count={filtered.length} />
      <JoinMap open={addOpen} onOpenChange={setAddOpen} initial={own} onSave={saveOwn} />
      <Toaster position="bottom-center" theme="light" />
    </div>
  );
}
