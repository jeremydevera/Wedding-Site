import React from "react";
import { useStore } from "@/lib/store.jsx";
import { featureVisible } from "@/lib/roles.js";
import { cropTransform, mediaUrl } from "@/lib/media.js";
const { useState, useEffect, useRef } = React;

// ============================================================================
// Music — ONE shared audio engine (a single <Audio> element). The home vinyl
// player is the only UI; the engine also keeps playing across route changes.
// Module-level pub/sub so the player reads live playback state.
// ============================================================================
let _audio = null;
let _tracks = [];
let _loadedUrl = null;
let _loadedId = null; // stable identity of the loaded track (id); url is the fallback key
let _st = { playing: false, time: 0, duration: 0, index: 0 };
let _vol = 1; // 0..1, adjusted by the device player's wheel; vinyl skin has no volume UI
const _subs = new Set();
const _emit = () => _subs.forEach((f) => f());

function el() {
  if (_audio || typeof window === "undefined") return _audio;
  _audio = new window.Audio();
  _audio.preload = "metadata";
  _audio.volume = _vol;
  _audio.ontimeupdate = () => { _st = { ..._st, time: _audio.currentTime }; _emit(); };
  _audio.onloadedmetadata = () => { _st = { ..._st, duration: _audio.duration || 0 }; _emit(); };
  _audio.onplay = () => { _st = { ..._st, playing: true }; _emit(); };
  _audio.onpause = () => { _st = { ..._st, playing: false }; _emit(); };
  _audio.onended = () => nextTrack();
  return _audio;
}
function load(i) {
  const t = _tracks[i]; if (!t) return;
  const a = el();
  if (_loadedUrl !== t.url) { a.src = mediaUrl(t.url); _loadedUrl = t.url; _st = { ..._st, duration: 0 }; }
  _loadedId = t.id != null ? t.id : null;
  _st = { ..._st, index: i, time: 0 }; _emit();
}
export function setTracks(tracks) {
  _tracks = tracks || [];
  if (_st.index >= _tracks.length) { _st = { ..._st, index: 0 }; _loadedUrl = null; _loadedId = null; }
  if (_tracks.length) {
    // Match the loaded track by its stable id (falling back to url only when a
    // track has no id) — url alone is ambiguous when two rows share a source.
    const matches = (t) => (_loadedId != null ? t.id === _loadedId : t.url === _loadedUrl);
    // Reload when the loaded track is no longer in the new playlist (playlist replaced).
    const loadedStillValid = _tracks.some(matches);
    if (!loadedStillValid) load(_st.index < _tracks.length ? _st.index : 0);
    else {
      // Playlist reordered but the playing track is still present — re-sync the
      // index to where the loaded track now lives so the UI's "Now Playing"
      // highlight/label follows the audio instead of pointing at a moved row.
      const li = _tracks.findIndex(matches);
      if (li >= 0 && li !== _st.index) _st = { ..._st, index: li };
    }
  } else if (_audio) { _audio.pause(); _loadedUrl = null; _loadedId = null; }
  _emit();
}
export function play() { const a = el(); if (_loadedUrl == null && _tracks[0]) load(0); if (a) a.play().catch(() => {}); }
export function pause() { if (_audio) _audio.pause(); }
export function toggle() { _st.playing ? pause() : play(); }
export function nextTrack() { if (!_tracks.length) return; load((_st.index + 1) % _tracks.length); play(); }
export function prevTrack() { if (!_tracks.length) return; load((_st.index - 1 + _tracks.length) % _tracks.length); play(); }
export function playIndex(i) { if (i === _st.index) { toggle(); return; } load(i); play(); }
export function seekFrac(f) { const a = el(); if (a && _st.duration) a.currentTime = Math.max(0, Math.min(1, f)) * _st.duration; }
export function bumpVolume(delta) { const a = el(); _vol = Math.max(0, Math.min(1, _vol + delta)); if (a) a.volume = _vol; }
function useMusic() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); _subs.add(fn); return () => _subs.delete(fn); }, []);
  return { ..._st, tracks: _tracks };
}
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// Sits at the app root: feeds the playlist to the engine and attempts autoplay
// (falling back to the first user gesture). Renders nothing — the home vinyl
// player is the only visible control.
export function MusicMount() {
  const { playlist, settings } = useStore();
  // accessV2 "none" on music silences the engine entirely (no autoplay, no
  // tracks); legacy clients and view/edit levels keep today's behavior.
  const musicOff = settings && settings.accessV2 === true && !featureVisible(settings, "music");
  const tracks = musicOff ? [] : (playlist || []);
  const n = tracks.length;
  // Autoplay is opt-out (default on). When off, the engine still has the tracks
  // loaded so the home player works — it just won't start on its own.
  // Never autoplay inside a preview iframe (the /apply theme simulator, the admin
  // theme picker) — a muted, still preview, not a concert.
  const isPreview = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("preview");
  const autoplay = !isPreview && (settings && settings.musicAutoplay) !== false;
  const playlistKey = JSON.stringify(playlist) + ":" + musicOff;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTracks(tracks); }, [playlistKey]);
  useEffect(() => {
    if (!n || !autoplay) return;
    let done = false;
    const go = () => { if (done) return; done = true; play(); off(); };
    const off = () => { window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); window.removeEventListener("scroll", go); };
    play(); // immediate attempt (usually blocked until a gesture)
    window.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", go, { once: true });
    window.addEventListener("scroll", go, { once: true, passive: true });
    return off;
  }, [n, autoplay]);
  return null;
}

// The spinning disk — a pixel-exact port of VinylPlayer.dc.html's record. These
// values are NEVER themed (dark vinyl, light label, dark spindle hole); only the
// card/text/controls around it adapt to the wedding theme. Kept inline so the
// disk stays identical regardless of the active theme's CSS variables.
const DISK = { bg: "#161618", labelBg: "#d8d8d8", labelText: "#15151a", font: "'Space Grotesk', system-ui, sans-serif" };
function VinylDisk({ artist, uid, size = 230 }) {
  return (
    <div className="vinyl-disk" style={{ position: "relative", flex: "0 0 auto", width: size, height: size, borderRadius: "50%", boxShadow: "0 18px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.4)" }}>
      {/* spinning base: grooves + record gradient */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", animation: "vp-spin 3.4s linear infinite", background: "repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 0.5px, rgba(0,0,0,0) 0.6px, rgba(0,0,0,0) 2.4px), radial-gradient(circle at 50% 50%, #3a3a3d 0%, #232325 26%, #0d0d0e 27%, #131315 60%, #050506 100%)" }}>
        {/* center label with curved artist text */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "38%", height: "38%", borderRadius: "50%", background: DISK.labelBg, boxShadow: "0 0 0 1px rgba(0,0,0,0.25), inset 0 0 14px rgba(0,0,0,0.18)", overflow: "hidden" }}>
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <defs><path id={uid} d="M 22,50 A 28,28 0 1 1 78,50" fill="none" /></defs>
            <text fill={DISK.labelText} style={{ fontFamily: DISK.font, fontSize: "5.4px", fontWeight: 600, letterSpacing: "0.5px", opacity: 0.9 }}>
              <textPath href={"#" + uid} startOffset="50%" textAnchor="middle">{(artist || "").toUpperCase()}</textPath>
            </text>
          </svg>
        </div>
        {/* spindle hole */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "7%", height: "7%", borderRadius: "50%", background: DISK.bg, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 2px rgba(0,0,0,0.4)" }} />
      </div>
      {/* spinning glossy sheen */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", mixBlendMode: "screen", animation: "vp-spin 3.4s linear infinite", background: "conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.04) 16deg, rgba(255,255,255,0.20) 50deg, rgba(255,255,255,0.05) 84deg, rgba(255,255,255,0) 108deg, rgba(255,255,255,0) 180deg, rgba(255,255,255,0.04) 196deg, rgba(255,255,255,0.15) 228deg, rgba(255,255,255,0.04) 262deg, rgba(255,255,255,0) 286deg, rgba(255,255,255,0) 360deg)" }} />
      {/* fixed specular */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", mixBlendMode: "screen", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 38%)" }} />
      {/* rim + sheen edge */}
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", pointerEvents: "none", boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 -2px 6px rgba(0,0,0,0.5)" }} />
    </div>
  );
}

// Animated equalizer shown on the active track row (frozen when paused).
function Equalizer({ on }) {
  return <span className={"vinyl-eq" + (on ? " is-on" : "")} aria-hidden="true"><i /><i /><i /><i /></span>;
}

// Dispatcher: the home player renders either the vinyl skin (default) or the
// retro device, chosen by settings.playerSkin (Home → Music playlist admin).
export function VinylPlayer({ tracks }) {
  const { settings } = useStore();
  const skin = settings && settings.playerSkin === "device" ? "device" : "vinyl";
  return skin === "device" ? <DevicePlayer tracks={tracks} /> : <VinylSkin tracks={tracks} />;
}

// Home vinyl player: a themed card (wedding tokens) wrapping the unchanged dark
// disk, plus — when there is more than one song — a themed playlist below.
// Its own titled section; wired to the shared audio engine.
function VinylSkin({ tracks }) {
  const { settings: hs } = useStore(); // home header override source
  const st = useMusic();
  const uid = "vp-" + React.useId().replace(/:/g, "");
  const listRef = useRef(null);
  const activeRef = useRef(null);
  const list = tracks || [];
  // keep the playing track centred in the scrollable playlist
  useEffect(() => {
    const ol = listRef.current, li = activeRef.current;
    if (!ol || !li) return;
    const o = ol.getBoundingClientRect(), r = li.getBoundingClientRect();
    const top = ol.scrollTop + (r.top - o.top) - (ol.clientHeight - li.clientHeight) / 2;
    ol.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [st.index, list.length]);
  if (!list.length) return null;
  const cur = list[st.index] || list[0];
  const frac = st.duration ? st.time / st.duration : 0;
  const many = list.length > 1;
  const mh = ((hs || {}).homeHeads || {}).music || {}; // Home → Music header override
  return (
    <section className="block" id="home-playlist">
      <div className="container">
        <div className="sec-head sec-head--center">
          <div className="eyebrow">{(mh.eyebrow || "").trim() || "Our Song"}</div>
          <h2 className="sec-head__title">{(mh.title || "").trim() || (many ? "Our Playlist" : "Press Play")}</h2>
        </div>
        <div className={"vinyl-card" + (many ? " vinyl-card--row" : "")}>
          <div className="vinyl-main">
          <VinylDisk artist={cur.artist} uid={uid} />
          <div className="vinyl-meta">
            <div className="vinyl-kicker">Now Playing</div>
            <div className="vinyl-title">{cur.title}</div>
            <div className="vinyl-artist">{cur.artist || " "}</div>
            <div className="vinyl-progress">
              <div className="vinyl-track" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekFrac((e.clientX - r.left) / r.width); }} role="progressbar" aria-valuenow={Math.round(frac * 100)}>
                <span className="vinyl-fill" style={{ width: (frac * 100) + "%" }} />
              </div>
              <div className="vinyl-times"><span>{fmt(st.time)}</span><span>{fmt(st.duration)}</span></div>
            </div>
            <div className="vinyl-controls">
              <button className="vinyl-btn" onClick={prevTrack} disabled={!many} aria-label="Previous">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9 12z" /></svg>
              </button>
              <button className="vinyl-btn vinyl-btn--play" onClick={toggle} aria-label={st.playing ? "Pause" : "Play"}>
                {st.playing
                  ? <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
              </button>
              <button className="vinyl-btn" onClick={nextTrack} disabled={!many} aria-label="Next">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l11 6-11 6z" /></svg>
              </button>
            </div>
          </div>
          </div>

          {many && (
            <div className="vinyl-aside">
              <div className="vinyl-aside__head">Playlist</div>
            <ol className="vinyl-list" ref={listRef}>
              {list.map((t, i) => {
                const active = i === st.index;
                return (
                  <li key={t.id || i} ref={active ? activeRef : null} className={"vinyl-list__item" + (active ? " is-active" : "")}>
                    <button onClick={() => playIndex(i)} aria-label={(active && st.playing ? "Pause " : "Play ") + t.title}>
                      <span className="vinyl-list__num">
                        {active ? <Equalizer on={st.playing} /> : <span className="vinyl-list__n">{i + 1}</span>}
                        <svg className="vinyl-list__cue" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </span>
                      <span className="vinyl-list__text">
                        <span className="vinyl-list__title">{t.title}</span>
                        {t.artist ? <span className="vinyl-list__artist">{t.artist}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// Retro-device skin: a fluid matte player with a click wheel, wired to the same
// shared audio engine. Layout scales via container-query units (see .device-*
// in styles.css) so it fits the responsive site — unlike the fixed-px original.
// Screen art is a themed gradient (tracks carry audio + title/artist, no cover).
function DevicePlayer({ tracks }) {
  const { settings: hs } = useStore(); // home header override source
  const st = useMusic();
  const listRef = useRef(null);
  const activeRef = useRef(null);
  const [tilt, setTilt] = useState("");     // wheel lean: "" | left | right | up | down
  const [pressed, setPressed] = useState(false); // centre play button
  const list = tracks || [];
  useEffect(() => {
    const ol = listRef.current, li = activeRef.current;
    if (!ol || !li) return;
    const o = ol.getBoundingClientRect(), r = li.getBoundingClientRect();
    ol.scrollTo({ top: Math.max(0, ol.scrollTop + (r.top - o.top) - (ol.clientHeight - li.clientHeight) / 2), behavior: "smooth" });
  }, [st.index, list.length]);
  if (!list.length) return null;
  const cur = list[st.index] || list[0];
  const frac = st.duration ? st.time / st.duration : 0;
  const many = list.length > 1;
  const mh = ((hs || {}).homeHeads || {}).music || {}; // Home → Music header override
  const clearWheel = () => { setTilt(""); setPressed(false); };
  // Per-track cover: uploaded image/gif (as bg) or mp4 (as <video>); else the
  // themed gradient (CSS default). Scanlines are hidden over a real cover.
  const artUrl = cur.art ? mediaUrl(cur.art) : null;
  const artIsVideo = !!cur.art && /\.(mp4|webm|mov|m4v)$/i.test(cur.art);
  return (
    <section className="block" id="home-playlist">
      <div className="container">
        <div className="sec-head sec-head--center">
          <div className="eyebrow">{(mh.eyebrow || "").trim() || "Our Song"}</div>
          <h2 className="sec-head__title">{(mh.title || "").trim() || (many ? "Our Playlist" : "Press Play")}</h2>
        </div>
        <div className="device-player">
          <div className="dp-frame">
          <div className="dp-body">
            <div className={"dp-screen" + (artUrl ? " dp-screen--art" : "")}>
              {artUrl && (artIsVideo
                ? <video className="dp-media" src={artUrl} muted loop autoPlay playsInline aria-hidden="true" style={cropTransform(cur.artCrop)} />
                : <img className="dp-media" src={artUrl} alt="" aria-hidden="true" />)}
              <div className="dp-reflection" aria-hidden="true" />
              <div className="dp-screen__text">
                <div className="dp-kicker">Now Playing</div>
                <div className="dp-title">{cur.title}</div>
                <div className="dp-artist">{cur.artist || " "}</div>
              </div>
              <div className="dp-progress" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekFrac((e.clientX - r.left) / r.width); }} role="progressbar" aria-valuenow={Math.round(frac * 100)}>
                <span className="dp-fill" style={{ width: (frac * 100) + "%" }} />
              </div>
            </div>

            <div className="dp-wheel">
              <div className={"dp-overlay" + (tilt ? " " + tilt : "")} onPointerUp={clearWheel} onPointerLeave={clearWheel} onPointerCancel={clearWheel}>
                <button className="dp-w dp-up" aria-label="Volume up"
                  onPointerDown={() => setTilt("up")} onClick={() => bumpVolume(0.1)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13 4a1 1 0 0 0-2 0v7H4a1 1 0 1 0 0 2h7v7a1 1 0 1 0 2 0v-7h7a1 1 0 1 0 0-2h-7z" /></svg>
                </button>
                <button className="dp-w dp-prev" aria-label="Previous track" disabled={!many}
                  onPointerDown={() => setTilt("left")} onClick={prevTrack}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12L9 12z" /></svg>
                </button>
                <button className="dp-w dp-next" aria-label="Next track" disabled={!many}
                  onPointerDown={() => setTilt("right")} onClick={nextTrack}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l11 6-11 6z" /></svg>
                </button>
                <button className="dp-w dp-down" aria-label="Volume down"
                  onPointerDown={() => setTilt("down")} onClick={() => bumpVolume(-0.1)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 11h16a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2z" /></svg>
                </button>
                <button className={"dp-play" + (pressed ? " pressed" : "")} aria-label={st.playing ? "Pause" : "Play"}
                  onPointerDown={() => setPressed(true)} onPointerUp={() => setPressed(false)} onClick={toggle}>
                  {st.playing
                    ? <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1" /><rect x="13.5" y="5" width="4" height="14" rx="1" /></svg>
                    : <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}
                </button>
              </div>
            </div>
          </div>
          </div>

          {many && (
            <div className="vinyl-aside device-aside">
              <div className="vinyl-aside__head">Playlist</div>
              <ol className="vinyl-list" ref={listRef}>
                {list.map((t, i) => {
                  const active = i === st.index;
                  return (
                    <li key={t.id || i} ref={active ? activeRef : null} className={"vinyl-list__item" + (active ? " is-active" : "")}>
                      <button onClick={() => playIndex(i)} aria-label={(active && st.playing ? "Pause " : "Play ") + t.title}>
                        <span className="vinyl-list__num">
                          {active ? <Equalizer on={st.playing} /> : <span className="vinyl-list__n">{i + 1}</span>}
                          <svg className="vinyl-list__cue" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                        </span>
                        <span className="vinyl-list__text">
                          <span className="vinyl-list__title">{t.title}</span>
                          {t.artist ? <span className="vinyl-list__artist">{t.artist}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
