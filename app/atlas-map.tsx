"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Globe2, LoaderCircle, LocateFixed, Minus, MousePointer2, Plus, Shuffle, Users, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Maker } from "./data";
import { containsPoint, type Boundary } from "@/lib/map-boundaries";
import type { FeatureCollection } from "geojson";
import { isOpenInPerson } from "./profile";
import { Avatar } from "./maker-ui";
import Link from "next/link";
import { citySlug } from "./profile";
import { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./atlas-map.css";

export type Region = "Europe" | "World" | "Americas" | "Asia Pacific";
type Place = { name: string; kind: string; lat: number; lng: number; boundary?: Boundary; members?: Maker[] };
/** What the page gets when a country, city, or cluster is selected: everyone inside it. */
export type PlaceSelection = { name: string; kind: string; makers: Maker[] };
const CITY_ZOOM = 7;
// Pins closer than this on screen collapse into one cluster bubble.
const CLUSTER_RADIUS = 52;

const regions: Record<Region, { lng: number; lat: number; zoom: number }> = {
  Europe: { lng: 13, lat: 50.2, zoom: 3.35 },
  World: { lng: 12, lat: 18, zoom: 1.45 },
  Americas: { lng: -86, lat: 19, zoom: 2.35 },
  "Asia Pacific": { lng: 122, lat: 12, zoom: 2.45 },
};

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const emptyGeo = { type: "FeatureCollection" as const, features: [] };

type Props = {
  people: Maker[];
  selected?: Maker;
  onSelect: (maker: Maker) => void;
  onMeet: (maker: Maker) => void;
  region: Region;
  setRegion: (region: Region) => void;
  mapView: string;
  onSurprise: () => void;
  focusRequest: number;
  regionRequest: number;
  /** Fires with everyone inside the selected place, or null when the selection is cleared. */
  onPlace?: (selection: PlaceSelection | null) => void;
};

// Where you were on the map, kept for the tab so coming back from a profile
// lands on the same view with the same country or cluster still selected.
const MAP_STATE_KEY = "makersmap-map";
type MapState = {
  camera?: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  click?: { lng: number; lat: number } | null;
  cluster?: { ids: number[]; name: string; lng: number; lat: number } | null;
  at: number;
};
function readMapState(): MapState | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(MAP_STATE_KEY) || "null") as MapState | null;
    if (!raw || typeof raw.at !== "number" || Date.now() - raw.at > 6 * 60 * 60 * 1000) return null;
    return raw;
  } catch { return null; }
}
function writeMapState(patch: Partial<MapState>) {
  try {
    const current = readMapState() || { at: Date.now() };
    sessionStorage.setItem(MAP_STATE_KEY, JSON.stringify({ ...current, ...patch, at: Date.now() }));
  } catch {}
}

function flyPitch(kind: string, zoom: number) {
  if (kind === "country" || kind === "water") return 6;
  if (zoom >= 6) return 38;
  if (zoom >= 4.4) return 24;
  return 12;
}

function makersAt(people: Maker[], place: Place) {
  if (place.members) { const ids = new Set(place.members.map((m) => m.id)); return people.filter((maker) => ids.has(maker.id)); }
  if (place.boundary) return people.filter((maker) => containsPoint(place.boundary!, maker.lon, maker.lat));
  return [];
}

function motionOk() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function duration(ms: number) {
  return motionOk() ? ms : 1;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function paint(map: MapLibreMap, id: string, property: string, value: string | number | object) {
  try {
    if (map.getLayer(id)) (map.setPaintProperty as (layer: string, name: string, next: unknown) => void)(id, property, value);
  } catch {}
}

function styleAtlas(map: MapLibreMap, view: string) {
  try {
    map.setProjection({ type: view === "map" ? "mercator" : "globe" });
  } catch {}
  try {
    map.setSky({
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.72, 4.2, 0.32, 7.5, 0],
    });
  } catch {}
  // The relief raster has white ocean pixels. Use vector land/water instead.
  paint(map, "background", "background-color", "#2a5f7a");
  if (map.getLayer("natural_earth")) map.setLayoutProperty("natural_earth", "visibility", "none");
  for (const layer of map.getStyle().layers) {
    if (layer.type === "fill" && layer["source-layer"] === "water") map.setPaintProperty(layer.id, "fill-color", "#2a5f7a");
    if (layer.type === "line" && layer["source-layer"] === "waterway") map.setPaintProperty(layer.id, "line-color", "#2a5f7a");
  }
  if (!map.getSource("countries")) {
    map.addSource("countries", { type: "geojson", data: "/countries.geojson" });
    map.addLayer({ id: "country-land", type: "fill", source: "countries", paint: { "fill-color": "#b9cda5" } }, map.getStyle().layers.find((layer) => layer.type !== "background")?.id);
    const labels = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addLayer({ id: "country-outlines", type: "line", source: "countries", maxzoom: 7, paint: { "line-color": "#56765d", "line-width": 0.8 } }, labels);
    for (const id of ["hover-area", "selected-area"]) {
      map.addSource(id, { type: "geojson", data: emptyGeo });
      map.addLayer({ id: `${id}-fill`, type: "fill", source: id, paint: { "fill-color": "#d4ee76", "fill-opacity": id === "selected-area" ? 0.38 : 0.16 } }, labels);
      map.addLayer({ id: `${id}-line`, type: "line", source: id, paint: { "line-color": "#e7f8a8", "line-width": id === "selected-area" ? 2.5 : 1 } }, labels);
    }
  }
}

export default function AtlasMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<number, Marker>());
  const clusters = useRef<Marker[]>([]);
  const relayout = useRef<() => void>(() => undefined);
  const latest = useRef(props);
  const firstView = useRef(true);
  const firstRegion = useRef(true);
  const hintRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectionStatus, setSelectionStatus] = useState("");
  const [selectionMode, setSelectionMode] = useState("country");
  const [place, setPlace] = useState<Place | null>(null);
  const pendingCluster = useRef<{ ids: number[]; name: string; lng: number; lat: number } | null>(null);
  // Handlers registered once on the map read the newest props through this ref.
  useLayoutEffect(() => { latest.current = props; });

  useEffect(() => {
    const pending = pendingCluster.current;
    if (!pending || !ready || !props.people.length) return;
    const ids = new Set(pending.ids);
    const members = props.people.filter((m) => ids.has(m.id));
    pendingCluster.current = null;
    if (members.length) setPlace({ name: pending.name, kind: "area", lat: pending.lat, lng: pending.lng, members });
  }, [props.people, ready]);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    const markerMap = markers.current;
    const clusterList = clusters;
    let observer: ResizeObserver | undefined;
    let hoverFrame = 0;
    let placeRequest = 0;
    let geocode: AbortController | undefined;
    let countries: Boundary[] = [];
    const cityCache: Boundary[] = [];
    const countryController = new AbortController();
    let tryRestore: () => void = () => {};
    fetch("/countries.geojson", { signal: countryController.signal }).then((response) => response.json()).then((data) => { countries = (data as FeatureCollection).features as Boundary[]; tryRestore(); }).catch(() => undefined);
    const boot = () => {
      if (cancelled || !host.current) return;
      setReady(false);
      const start = regions[latest.current.region];
      const globe = latest.current.mapView !== "map";
      const saved = readMapState();
      if (saved?.cluster) pendingCluster.current = saved.cluster;
      map = new MapLibreMap({
        container: host.current,
        style: STYLE,
        center: saved?.camera ? saved.camera.center : [start.lng, start.lat],
        zoom: saved?.camera ? saved.camera.zoom : globe ? Math.min(start.zoom, 2.15) : start.zoom,
        pitch: saved?.camera?.pitch ?? 0,
        bearing: saved?.camera?.bearing ?? 0,
        minZoom: 0.6,
        maxZoom: 14,
        maxPitch: 60,
        fadeDuration: 280,
        attributionControl: { compact: true },
        canvasContextAttributes: { antialias: true },
        dragRotate: true,
        dragPan: { linearity: 0.32, maxSpeed: 1600, deceleration: 2600 },
        touchPitch: true,
        doubleClickZoom: true,
        keyboard: true,
      });
      mapRef.current = map;
      const canvas = map.getCanvas();
      const stage = host.current.parentElement;
      const tip = document.createElement("div");
      tip.className = "atlas-hover-tip";
      tip.hidden = true;
      host.current.appendChild(tip);

      const setCursor = (value: string) => { canvas.style.cursor = value; };
      const areaSource = (id: string) => map?.getSource(id) as GeoJSONSource | undefined;
      const areaAt = (lng: number, lat: number) => {
        const boundaries = map && map.getZoom() >= CITY_ZOOM ? cityCache : countries;
        return boundaries.find((boundary) => containsPoint(boundary, lng, lat));
      };
      const selectArea = (boundary: Boundary, lng: number, lat: number, kind: string) => {
        areaSource("selected-area")?.setData(boundary);
        setPlace({ name: boundary.properties.name, kind, lng, lat, boundary });
        setSelectionStatus("");
        writeMapState({ click: { lng, lat }, cluster: null });
      };
      // Select whatever is at a point: a country, or a city once zoomed in (fetched on demand).
      const selectAt = async (lng: number, lat: number) => {
        if (!map) return;
        const request = ++placeRequest;
        geocode?.abort();
        const cityMode = map.getZoom() >= CITY_ZOOM;
        const boundary = areaAt(lng, lat);
        if (boundary) {
          selectArea(boundary, lng, lat, cityMode ? boundary.properties.kind || "city / municipality" : "country");
          return;
        }
        areaSource("selected-area")?.setData(emptyGeo);
        setPlace(null);
        if (!cityMode) {
          setSelectionStatus(countries.length ? "Click land to select a country. Zoom in to select a city." : "Country boundaries are loading. Please try again.");
          return;
        }
        // Only user clicks request boundaries. Hover never calls the service.
        const controller = new AbortController();
        geocode = controller;
        setSelectionStatus("Loading the city boundary…");
        try {
          const response = await fetch(`/api/boundaries/city?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, { signal: controller.signal });
          const data = await response.json() as { boundary?: Boundary; error?: string };
          if (cancelled || request !== placeRequest) return;
          if (!response.ok || !data.boundary) {
            setSelectionStatus(data.error || "No city boundary is available here.");
            return;
          }
          cityCache.push(data.boundary);
          if (cityCache.length > 50) cityCache.shift();
          selectArea(data.boundary, lng, lat, data.boundary.properties.kind || "city / municipality");
        } catch {
          if (!cancelled && request === placeRequest) setSelectionStatus("City boundaries couldn’t load. Please try again.");
        }
      };
      let mapLoaded = false;
      let restored = false;
      tryRestore = () => {
        if (!map || !mapLoaded || !countries.length || restored || cancelled) return;
        restored = true;
        const state = readMapState();
        if (state?.click) void selectAt(state.click.lng, state.click.lat);
      };

      const applyLook = () => {
        if (!map) return;
        try { styleAtlas(map, latest.current.mapView); } catch {}
        setCursor("grab");
      };

      const pulse = (x: number, y: number) => {
        if (!host.current) return;
        const ring = document.createElement("span");
        ring.className = "atlas-click-pulse";
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        host.current.appendChild(ring);
        ring.addEventListener("animationend", () => ring.remove());
      };

      map.on("style.load", () => {
        if (cancelled) return;
        applyLook();
        map?.resize();
        setFailed(false);
        setReady(true);

      });
      map.on("load", () => {
        if (cancelled) return;
        applyLook();
        map?.resize();
        setFailed(false);
        setReady(true);
        mapLoaded = true;
        tryRestore();
      });
      const observerInstance = new ResizeObserver(() => map?.resize());
      observerInstance.observe(host.current);
      observer = observerInstance;
      map.on("error", (event) => {
        const message = String((event as { error?: { message?: string } }).error?.message || "");
        if (message.includes("style") || message.includes("Failed to fetch")) setFailed(true);
      });
      canvas.addEventListener("mouseenter", () => setCursor("grab"));
      canvas.addEventListener("mouseleave", () => {
        tip.hidden = true;
        areaSource("hover-area")?.setData(emptyGeo);
      });
      map.on("dragstart", () => {
        stage?.classList.add("is-dragging");
        setCursor("grabbing");
        tip.hidden = true;

      });
      map.on("dragend", () => {
        stage?.classList.remove("is-dragging");
        setCursor("grab");

      });
      // MapLibre stops camera animations when a gesture begins. Calling stop()
      // here also resets its active gesture handlers, cancelling drag and zoom.
      map.on("movestart", (event) => {
        tip.hidden = true;
        if (event.originalEvent) {
          placeRequest += 1;
          geocode?.abort();
          setSelectionStatus("");
        }
      });
      map.on("zoomend", () => setSelectionMode(map!.getZoom() >= CITY_ZOOM ? "city" : "country"));
      map.on("moveend", () => {
        relayout.current();
        if (!map) return;
        const c = map.getCenter();
        writeMapState({ camera: { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } });
      });
      map.on("mousemove", (event) => {
        if (hoverFrame) return;
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (!map || cancelled || map.isMoving()) return;
          const target = event.originalEvent.target as HTMLElement | null;
          if (target?.closest(".atlas-pin, .atlas-cluster")) {
            tip.hidden = true;
            setCursor("pointer");
            return;
          }
          const lng = event.lngLat.lng;
          const lat = event.lngLat.lat;
          const boundary = areaAt(lng, lat);
          const cityMode = map.getZoom() >= CITY_ZOOM;
          setCursor(boundary || cityMode ? "pointer" : "grab");
          areaSource("hover-area")?.setData(boundary || emptyGeo);
          tip.hidden = !boundary;
          if (boundary) {
            tip.innerHTML = `<em>${cityMode ? "city / municipality" : "country"}</em><strong>${escapeHtml(boundary.properties.name)}</strong><small>Click to select the whole area</small>`;
            tip.style.transform = `translate(${event.point.x + 18}px, ${event.point.y + 16}px)`;
          }
          if (hintRef.current) {
            hintRef.current.textContent = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}  ·  ${Math.abs(lng).toFixed(2)}° ${lng >= 0 ? "E" : "W"}`;
          }
        });
      });
      map.on("click", (event) => {
        if ((event.originalEvent.target as HTMLElement | null)?.closest(".atlas-pin, .atlas-cluster") || !map) return;
        const lng = ((event.lngLat.lng + 180) % 360 + 360) % 360 - 180;
        pulse(event.point.x, event.point.y);
        void selectAt(lng, event.lngLat.lat);
      });
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a failed map boot is reported once, from this effect
    try { boot(); } catch { if (!cancelled) setFailed(true); }
    return () => {
      cancelled = true;
      geocode?.abort();
      countryController.abort();
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      observer?.disconnect();
      markerMap.forEach((marker) => marker.remove());
      markerMap.clear();
      clusterList.current.forEach((marker) => marker.remove());
      clusterList.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (firstView.current) { firstView.current = false; return; }
    try {
      map.stop();
      styleAtlas(map, props.mapView);
      if (props.mapView === "map") {
        map.easeTo({ pitch: Math.min(map.getPitch(), 16), bearing: 0, zoom: Math.max(map.getZoom(), 3.1), duration: duration(800), easing: easeOut });
      } else {
        map.easeTo({ zoom: 1.75, pitch: 0, bearing: 0, duration: duration(800), easing: easeOut });
      }
    } catch {}
  }, [props.mapView, ready]);

  useEffect(() => {
    if (!ready) return;
    if (firstRegion.current) { firstRegion.current = false; return; }
    const map = mapRef.current;
    if (!map) return;
    const view = regions[props.region];
    try {
      map.stop();
      map.flyTo({
        center: [view.lng, view.lat],
        zoom: props.mapView === "globe" ? Math.min(view.zoom, 2.2) : view.zoom,
        pitch: 0,
        bearing: 0,
        duration: duration(1100),
        curve: 1.4,
        easing: easeOut,
      });
    } catch {}
  // Fires on an explicit region request, not on every region read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.regionRequest, ready]);

  useEffect(() => {
    if (!ready || !props.selected) return;
    const map = mapRef.current;
    if (!map) return;
    const zoom = Math.max(map.getZoom(), props.mapView === "globe" ? 4.5 : 6.4);
    try {
      map.stop();
      map.flyTo({
        center: [props.selected.lon, props.selected.lat],
        zoom,
        pitch: flyPitch("city", zoom),
        duration: duration(1000),
        curve: 1.4,
        easing: easeOut,
      });
    } catch {}
  // Flies on selection or an explicit focus request; mapView only affects the zoom floor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected?.id, props.focusRequest, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // One DOM marker per maker on screen, created on demand and removed when
    // they scroll out of view. Overlapping pins collapse into cluster bubbles.
    // Grouping uses a screen-space grid (each pin only looks at neighbouring
    // cells), so it stays linear in the number of pins, and it only runs after
    // the camera settles (moveend), so drags feel like ordinary markers.
    const makeMarker = (maker: Maker): Marker => {
      const el = document.createElement("button");
      el.className = "atlas-pin";
      el.type = "button";
      el.setAttribute("aria-label", maker.name + " in " + maker.city);
      const photo = document.createElement("span");
      photo.className = "atlas-pin-photo";
      if (maker.avatar) {
        const img = document.createElement("img");
        img.src = maker.avatar;
        img.alt = "";
        img.width = 42;
        img.height = 42;
        img.loading = "lazy";
        img.draggable = false;
        photo.appendChild(img);
      } else {
        photo.textContent = maker.initials;
      }
      const label = document.createElement("span");
      label.className = "atlas-pin-city";
      const name = document.createElement("b");
      name.textContent = maker.name;
      label.appendChild(name);
      label.appendChild(document.createTextNode(maker.city));
      el.appendChild(photo);
      el.appendChild(label);
      if (isOpenInPerson(maker)) {
        const badge = document.createElement("span");
        badge.className = "atlas-pin-meet";
        badge.textContent = "•";
        el.appendChild(badge);
      }
      el.addEventListener("pointerenter", () => { el.classList.add("hot"); });
      el.addEventListener("pointerleave", () => { el.classList.remove("hot"); });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        const current = latest.current.people.find((person) => person.id === maker.id) || maker;
        latest.current.onSelect(current);
        latest.current.onMeet(current);
      });
      return new Marker({ element: el, anchor: "center" }).setLngLat([maker.lon, maker.lat]);
    };

    const layout = () => {
      const current = mapRef.current;
      if (!current) return;
      clusters.current.forEach((cluster) => cluster.remove());
      clusters.current = [];
      const { people, selected: active } = latest.current;
      const canvas = current.getCanvas();
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const margin = 160;

      // Only pins near the viewport take part; the rest have no DOM presence at all.
      const onScreen: { maker: Maker; x: number; y: number }[] = [];
      for (const maker of people) {
        const point = current.project([maker.lon, maker.lat]);
        if (point.x < -margin || point.y < -margin || point.x > width + margin || point.y > height + margin) continue;
        onScreen.push({ maker, x: point.x, y: point.y });
      }

      // Grid bucketing: a pin can only overlap pins in its own or adjacent cells.
      const cell = CLUSTER_RADIUS;
      const buckets = new Map<string, number[]>();
      onScreen.forEach((p, i) => {
        const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
        const list = buckets.get(key);
        if (list) list.push(i); else buckets.set(key, [i]);
      });
      const grouped = new Set<number>();
      const groups: Maker[][] = [];
      onScreen.forEach((a, i) => {
        if (grouped.has(a.maker.id) || a.maker.id === active?.id) return;
        const members = [a.maker];
        const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          for (const j of buckets.get(`${cx + dx}:${cy + dy}`) || []) {
            if (j === i) continue;
            const b = onScreen[j];
            if (grouped.has(b.maker.id) || b.maker.id === active?.id) continue;
            if (Math.hypot(a.x - b.x, a.y - b.y) < CLUSTER_RADIUS) members.push(b.maker);
          }
        }
        if (members.length < 2) return;
        members.forEach((member) => grouped.add(member.id));
        groups.push(members);
      });

      // Reconcile DOM markers with what should be visible on its own.
      const wanted = new Set<number>();
      for (const { maker } of onScreen) if (!grouped.has(maker.id)) wanted.add(maker.id);
      if (active && !wanted.has(active.id) && people.some((m) => m.id === active.id)) wanted.add(active.id);
      markers.current.forEach((marker, id) => {
        if (wanted.has(id)) return;
        marker.remove();
        markers.current.delete(id);
      });
      for (const maker of people) {
        if (!wanted.has(maker.id)) continue;
        let marker = markers.current.get(maker.id);
        if (!marker) { marker = makeMarker(maker).addTo(current); markers.current.set(maker.id, marker); }
        else marker.setLngLat([maker.lon, maker.lat]);
        const el = marker.getElement();
        el.classList.toggle("selected", maker.id === active?.id);
        el.setAttribute("aria-pressed", String(maker.id === active?.id));
      }

      for (const members of groups) {
        const lon = members.reduce((sum, m) => sum + m.lon, 0) / members.length;
        const lat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;
        const cities = [...new Set(members.map((m) => m.city))];
        const el = document.createElement("button");
        el.className = "atlas-cluster";
        el.type = "button";
        el.setAttribute("aria-label", `${members.length} makers near ${cities.slice(0, 2).join(" and ")}. Zoom in to see them.`);
        const photos = document.createElement("span");
        photos.className = "atlas-cluster-photos";
        for (const member of members.slice(0, 3)) {
          const photo = document.createElement("span");
          photo.className = "atlas-cluster-photo";
          if (member.avatar) {
            const img = document.createElement("img");
            img.src = member.avatar;
            img.alt = "";
            img.loading = "lazy";
            img.draggable = false;
            photo.appendChild(img);
          } else {
            photo.textContent = member.initials;
          }
          photos.appendChild(photo);
        }
        const count = document.createElement("span");
        count.className = "atlas-cluster-count";
        count.textContent = String(members.length);
        const label = document.createElement("span");
        label.className = "atlas-pin-city";
        const title = document.createElement("b");
        title.textContent = `${members.length} makers`;
        label.appendChild(title);
        label.appendChild(document.createTextNode(cities.slice(0, 3).join(" · ") + (cities.length > 3 ? " · …" : "")));
        el.appendChild(photos);
        el.appendChild(count);
        el.appendChild(label);
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          // Selecting the bubble lists its members under the map; zooming in still separates them on the map.
          const name = cities.slice(0, 2).join(" & ") + (cities.length > 2 ? ` +${cities.length - 2}` : "");
          setPlace({ name, kind: "area", lat, lng: lon, members });
          writeMapState({ cluster: { ids: members.map((m) => m.id), name, lng: lon, lat }, click: null });
          try { (current.getSource("selected-area") as GeoJSONSource | undefined)?.setData(emptyGeo); } catch {}
          const lons = members.map((m) => m.lon), lats = members.map((m) => m.lat);
          const spread = Math.max(...lons) - Math.min(...lons) + Math.max(...lats) - Math.min(...lats);
          current.stop();
          if (spread < 0.01) {
            current.easeTo({ center: [lon, lat], zoom: Math.min(current.getZoom() + 2.5, 12), duration: duration(700), easing: easeOut });
          } else {
            current.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 140, maxZoom: 9.5, duration: duration(900), easing: easeOut });
          }
        });
        const cluster = new Marker({ element: el, anchor: "center" }).setLngLat([lon, lat]).addTo(current);
        clusters.current.push(cluster);
      }
    };
    relayout.current = layout;
    layout();
  }, [props.people, props.selected?.id, ready]);

  const selected = props.selected;
  const nearby = place ? makersAt(props.people, place) : [];
  useEffect(() => {
    latest.current.onPlace?.(place ? { name: place.name, kind: place.kind, makers: makersAt(latest.current.people, place) } : null);
  }, [place, props.people]);
  const countryCount = new Set(props.people.map((m) => m.country)).size;

  const clearPlace = () => {
    setPlace(null);
    writeMapState({ click: null, cluster: null });
    try { (mapRef.current?.getSource("selected-area") as GeoJSONSource | undefined)?.setData(emptyGeo); } catch {}
  };

  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.stop();
      map.easeTo({ zoom: map.getZoom() + delta, duration: duration(420), easing: easeOut });
    } catch {}
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    const view = regions[props.region];
    try {
      map.stop();
      map.flyTo({
        center: [view.lng, view.lat],
        zoom: props.mapView === "globe" ? Math.min(view.zoom, 2.2) : view.zoom,
        pitch: 0,
        bearing: 0,
        duration: duration(900),
        easing: easeOut,
      });
    } catch {}
  };

  return (
    <section className="atlas-map-stage" aria-label="Interactive maker map">
      <div ref={host} className="atlas-map-canvas" />
      {!ready && !failed && <div className="atlas-map-loading" role="status"><LoaderCircle size={24} /><span>Finding the world…</span></div>}
      {failed && <div className="atlas-map-loading" role="status"><Globe2 size={28} /><span>The map couldn’t load. Check your connection and try again.</span></div>}
      <div className="globe-toolbar">
        <Select value={props.region} onValueChange={(v) => props.setRegion(v as Region)}>
          <SelectTrigger className="globe-region" aria-label="Map region"><Globe2 size={15} /><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(regions) as Region[]).map((r) => <SelectItem key={r} value={r}>{r === "World" ? "Whole world" : r}</SelectItem>)}</SelectContent>
        </Select>
        {props.people.length > 0 && (
          <div className="globe-count" aria-label={`${props.people.length} makers in ${countryCount} countries on the map`}>
            <span className="globe-count-dot" aria-hidden="true" />
            <strong>{props.people.length.toLocaleString("en-US")}</strong><span>makers</span>
            <i aria-hidden="true" />
            <strong>{countryCount}</strong><span>countries</span>
          </div>
        )}
      </div>
      <div className="globe-context">
        <span className="globe-overline">MEET THE MAKERS</span>
        <h2 className={props.region === "Asia Pacific" ? "two-line" : undefined}>{props.region === "Asia Pacific" ? <>Asia<br />Pacific<span>.</span></> : <>{props.region}<span>.</span></>}</h2>
        <p>{props.people.length} {props.people.length === 1 ? "maker" : "makers"} · {countryCount} {countryCount === 1 ? "country" : "countries"}<br />{selectionMode === "country" ? "Click a country · zoom in for cities" : "Click to select a whole city"}</p>
      </div>
      <div className="globe-navigation">
        <button className="globe-shuffle" aria-label="Discover a random maker" onClick={props.onSurprise} disabled={!props.people.length}><Shuffle size={16} /><span>Surprise me</span></button>
        <div className="globe-navigation-row">
          <div className="globe-zoom">
            <button aria-label="Zoom in" onClick={() => zoomBy(1.15)} disabled={!ready}><Plus size={18} /></button>
            <span />
            <button aria-label="Zoom out" onClick={() => zoomBy(-1.15)} disabled={!ready}><Minus size={18} /></button>
          </div>
          <button className="globe-tool" aria-label="Reset map view" onClick={resetView} disabled={!ready}><LocateFixed size={18} /></button>
        </div>
      </div>
      {selectionStatus && <div className="atlas-selection-status" role="status">{selectionStatus}</div>}
      {place && (
        <section key={place.name + place.kind} className="atlas-place-card" aria-label={`Selected ${place.kind}: ${place.name}`}>
          <div className="atlas-place-head">
            <div>
              <span className="atlas-place-kicker">{place.kind}</span>
              <strong>{place.name}</strong>
            </div>
            <span className="atlas-place-count">{nearby.length ? `${nearby.length} maker${nearby.length === 1 ? "" : "s"}` : "No makers yet"}</span>
            {place.kind !== "country" && nearby.length > 0 && <Link className="atlas-place-city" href={`/city/${citySlug(nearby[0].city)}`} aria-label={`Open the ${nearby[0].city} city page`}><ArrowUpRight size={15} /></Link>}
            <button type="button" className="atlas-place-close" aria-label="Clear selection" onClick={clearPlace}><X size={15} /></button>
          </div>
          {nearby.length ? (
            <button type="button" className="atlas-place-all" onClick={() => document.getElementById("place-people")?.scrollIntoView({ behavior: motionOk() ? "smooth" : "instant", block: "start" })}>
              <span className="atlas-place-faces">
                {nearby.slice(0, 6).map((maker) => <Avatar key={maker.id} maker={maker} size={26} />)}
                {nearby.length > 6 && <em>+{nearby.length - 6}</em>}
              </span>
              <span>See all {nearby.length} below <ArrowDown size={14} /></span>
            </button>
          ) : (
            <p className="atlas-place-empty">Nobody has pinned themselves here yet. Keep exploring, or be the first.</p>
          )}
        </section>
      )}
      {selected && (
        <button className="globe-person-chip" onClick={() => props.onMeet(selected)}>
          {selected.avatar ? <img src={selected.avatar} alt="" width="38" height="38" /> : <span className="globe-initials">{selected.initials}</span>}
          <span><strong>{selected.name}</strong><small>{selected.flag} {selected.city} · Building {selected.project}</small></span>
          {isOpenInPerson(selected) ? <Users size={16} /> : <ArrowUpRight size={20} />}
        </button>
      )}
      <div className="globe-hint"><MousePointer2 size={14} /><span ref={hintRef}>Drag · scroll · click</span></div>
      <span className="atlas-map-copy">© OpenFreeMap · OpenMapTiles · OpenStreetMap · Natural Earth</span>
    </section>
  );
}
