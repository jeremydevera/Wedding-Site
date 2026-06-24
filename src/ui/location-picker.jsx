import React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Icon } from "@/ui/components.jsx";
const { useState, useEffect, useRef, useCallback } = React;

// ============================================================================
// location-picker.jsx — venue location picker for the admin Settings → Venue.
// Type to search (Photon / Komoot autocomplete, OSM data, no API key) and pin
// the exact spot on an interactive Leaflet map (click or drag the marker).
//
// Why Photon and not Nominatim: Nominatim's public server sends NO
// Access-Control-Allow-Origin header, so browser fetch() is blocked by CORS and
// the dropdown stays silently empty. Photon (photon.komoot.io) returns
// `Access-Control-Allow-Origin: *`, is built for as-you-type search, and is free.
//
// Emits onChange({ query, lat, lng }):
//   query — human-readable label (also kept in settings.mapQuery, shown publicly)
//   lat/lng — precise pin coordinates (settings.mapLat / settings.mapLng)
// The public Venue page + the Google embed prefer the coords when present.
// ============================================================================

// A CSS teardrop pin via divIcon — avoids Leaflet's bundler marker-image issue.
const PIN_ICON = L.divIcon({
  className: "lp-pin",
  html: '<span class="lp-pin__inner"></span>',
  iconSize: [30, 42],
  iconAnchor: [15, 40],
});

// Default view when nothing is pinned yet (Lipa, Batangas — the seed venue).
const DEFAULT_CENTER = [14.1647, 121.1413];

const PHOTON = "https://photon.komoot.io";

function isNum(n) {
  return n !== "" && n != null && Number.isFinite(parseFloat(n));
}

// Build a readable, de-duplicated label from a Photon feature's properties.
function photonLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ").trim();
  const parts = [p.name, street, p.district, p.city, p.state, p.country];
  const seen = new Set();
  return parts
    .filter(Boolean)
    .filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .join(", ");
}

// Photon GeoJSON -> normalized result rows { id, label, lat, lon }, de-duped by label.
function normalizePhoton(data) {
  const feats = (data && Array.isArray(data.features)) ? data.features : [];
  const out = [];
  const seen = new Set();
  for (const f of feats) {
    const c = f.geometry && f.geometry.coordinates;
    if (!c || c.length < 2) continue;
    const label = photonLabel(f.properties || {});
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ id: `${f.properties.osm_type || ""}${f.properties.osm_id || label}`, label, lat: c[1], lon: c[0] });
  }
  return out;
}

export function LocationPicker({ value, lat, lng, onChange }) {
  const [text, setText] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);

  const elRef = useRef(null);       // map container
  const mapRef = useRef(null);      // Leaflet map
  const markerRef = useRef(null);   // Leaflet marker
  const onChangeRef = useRef(onChange);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const blurRef = useRef(null);
  const selectingRef = useRef(false); // suppress search right after a pick

  onChangeRef.current = onChange;

  const emit = useCallback((q, la, lo) => {
    onChangeRef.current && onChangeRef.current({ query: q, lat: la, lng: lo });
  }, []);

  // Reverse-geocode a pinned point into a readable label, then emit.
  const reverseGeocode = useCallback(async (la, lo) => {
    emit(text || "", la, lo); // emit coords immediately; refine label below
    try {
      const r = await fetch(`${PHOTON}/reverse?lat=${la}&lon=${lo}&lang=en`, {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) return;
      const rows = normalizePhoton(await r.json());
      const name = rows[0] && rows[0].label;
      if (name) { setText(name); emit(name, la, lo); }
    } catch (e) { /* keep coords even if naming fails */ }
  }, [emit, text]);

  // Move the marker + recenter, optionally resolving a label from the point.
  const placePin = useCallback((la, lo, { reverse = false, zoom } = {}) => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLatLng([la, lo]);
    map.setView([la, lo], zoom || Math.max(map.getZoom(), 15), { animate: true });
    if (reverse) reverseGeocode(la, lo);
  }, [reverseGeocode]);

  // --- init the map once ----------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const pinned = isNum(lat) && isNum(lng);
    const start = pinned ? [parseFloat(lat), parseFloat(lng)] : DEFAULT_CENTER;
    const map = L.map(elRef.current, { scrollWheelZoom: true }).setView(start, pinned ? 15 : 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const marker = L.marker(start, { draggable: true, icon: PIN_ICON }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); reverseGeocode(p.lat, p.lng); });
    map.on("click", (e) => { marker.setLatLng(e.latlng); reverseGeocode(e.latlng.lat, e.latlng.lng); });
    mapRef.current = map; markerRef.current = marker;
    // tiles can render blank if the panel sized after init — nudge a reflow
    setTimeout(() => map.invalidateSize(), 60);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the input in sync if the stored label changes elsewhere
  useEffect(() => { setText(value || ""); }, [value]);

  // --- autocomplete search (debounced) --------------------------------------
  useEffect(() => {
    if (selectingRef.current) { selectingRef.current = false; return; }
    const q = text.trim();
    clearTimeout(debounceRef.current);
    if (q.length < 3) { setResults([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        if (abortRef.current) abortRef.current.abort();
        const ctrl = new AbortController(); abortRef.current = ctrl;
        // Bias toward what the operator is currently looking at for local relevance.
        const c = mapRef.current && mapRef.current.getCenter();
        const bias = c ? `&lat=${c.lat}&lon=${c.lng}` : "";
        const r = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`, {
          headers: { Accept: "application/json" }, signal: ctrl.signal,
        });
        const rows = normalizePhoton(await r.json());
        setResults(rows);
        setOpen(true); setActive(-1);
      } catch (e) {
        if (e.name !== "AbortError") { setResults([]); }
      } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [text]);

  function pick(r) {
    selectingRef.current = true;
    setText(r.label);
    setResults([]); setOpen(false); setActive(-1);
    placePin(r.lat, r.lon, { zoom: 16 });
    emit(r.label, r.lat, r.lon);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { if (active >= 0) { e.preventDefault(); pick(results[active]); } }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div className="lp">
      <div className="lp__searchwrap">
        <span className="lp__searchicon">{Icon.search({})}</span>
        <input
          className="lp__search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => { if (results.length) setOpen(true); }}
          onBlur={() => { blurRef.current = setTimeout(() => setOpen(false), 150); }}
          placeholder="Search a place, address, or venue…"
          aria-label="Search for a location"
          autoComplete="off"
        />
        {loading && <span className="lp__spin" aria-hidden="true" />}
        {open && results.length > 0 && (
          <ul className="lp__results" role="listbox">
            {results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === active}
                className={"lp__result" + (i === active ? " lp__result--active" : "")}
                onMouseDown={(e) => { e.preventDefault(); clearTimeout(blurRef.current); pick(r); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="lp__result-pin">{Icon.pin({})}</span>
                <span className="lp__result-txt">{r.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="lp__map" ref={elRef} />
      <p className="lp__hint">{Icon.pin({})} Click the map or drag the pin to set the exact spot. Saves automatically.</p>
    </div>
  );
}
