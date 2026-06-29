import React from "react";
import { useStore } from "@/lib/store.jsx";
const { useState, useEffect } = React;

// ============================================================================
// Music — ONE shared audio engine (a single <Audio> element) driving two views:
// the floating mini-player (persists across routes) and the home vinyl player.
// Module-level pub/sub so both views read the same playback state.
// ============================================================================
let _audio = null;
let _tracks = [];
let _loadedUrl = null;
let _st = { playing: false, time: 0, duration: 0, index: 0 };
const _subs = new Set();
const _emit = () => _subs.forEach((f) => f());

function el() {
  if (_audio || typeof window === "undefined") return _audio;
  _audio = new window.Audio();
  _audio.preload = "metadata";
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
  if (_loadedUrl !== t.url) { a.src = t.url; _loadedUrl = t.url; }
  _st = { ..._st, index: i, time: 0 }; _emit();
}
export function setTracks(tracks) {
  _tracks = tracks || [];
  if (_st.index >= _tracks.length) _st = { ..._st, index: 0 };
  if (_tracks.length && _loadedUrl == null) load(0);
  if (!_tracks.length && _audio) { _audio.pause(); _loadedUrl = null; }
  _emit();
}
export function play() { const a = el(); if (_loadedUrl == null && _tracks[0]) load(0); if (a) a.play().catch(() => {}); }
export function pause() { if (_audio) _audio.pause(); }
export function toggle() { _st.playing ? pause() : play(); }
export function nextTrack() { if (!_tracks.length) return; load((_st.index + 1) % _tracks.length); play(); }
export function prevTrack() { if (!_tracks.length) return; load((_st.index - 1 + _tracks.length) % _tracks.length); play(); }
export function playIndex(i) { load(i); play(); }
export function seekFrac(f) { const a = el(); if (a && _st.duration) a.currentTime = Math.max(0, Math.min(1, f)) * _st.duration; }
function useMusic() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force((n) => n + 1); _subs.add(fn); return () => _subs.delete(fn); }, []);
  return { ..._st, tracks: _tracks };
}
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

// Sits at the app root: feeds the playlist to the engine, attempts autoplay
// (falling back to the first user gesture), and renders the floating mini-player.
export function MusicMount() {
  const { playlist } = useStore();
  const n = (playlist || []).length;
  useEffect(() => { setTracks(playlist || []); }, [playlist]);
  useEffect(() => {
    if (!n) return;
    let done = false;
    const go = () => { if (done) return; done = true; play(); off(); };
    const off = () => { window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); window.removeEventListener("scroll", go); };
    play(); // immediate attempt (usually blocked until a gesture)
    window.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", go, { once: true });
    window.addEventListener("scroll", go, { once: true, passive: true });
    return off;
  }, [n]);
  return <FloatingPlayer />;
}

function FloatingPlayer() {
  const st = useMusic();
  if (!st.tracks.length) return null;
  const cur = st.tracks[st.index] || st.tracks[0];
  return (
    <div className={"music-player" + (st.playing ? " is-playing" : "")} aria-label="Background music">
      <button className="music-player__btn" onClick={toggle} aria-label={st.playing ? "Pause music" : "Play music"}>{st.playing ? "❚❚" : "►"}</button>
      <div className="music-player__meta">
        <span className="music-player__title">{cur.title}</span>
        {cur.artist ? <span className="music-player__artist">{cur.artist}</span> : null}
      </div>
      {st.tracks.length > 1 && <button className="music-player__next" onClick={nextTrack} aria-label="Next track">⏭</button>}
    </div>
  );
}

// Home vinyl player: spinning record (when playing) + now-playing title/artist,
// live progress (seekable), controls, and a compact track list for multi-track.
export function VinylPlayer({ tracks }) {
  const st = useMusic();
  const list = tracks || [];
  if (!list.length) return null;
  const cur = list[st.index] || list[0];
  const frac = st.duration ? st.time / st.duration : 0;
  const initial = (cur.title || "♪").trim().charAt(0).toUpperCase() || "♪";
  return (
    <section className="block" id="home-playlist">
      <div className="container container--narrow">
        <div className="sec-head sec-head--center"><div className="eyebrow">Press Play</div><h2 className="sec-head__title">Our Song</h2></div>
        <div className="vinyl">
          <div className="vinyl__disc" aria-hidden="true">
            <div className={"vinyl__platter" + (st.playing ? " is-spinning" : "")}>
              <div className="vinyl__label"><span>{initial}</span></div>
              <div className="vinyl__hole" />
            </div>
            <div className="vinyl__specular" />
          </div>
          <div className="vinyl__info">
            <div className="vinyl__kicker">Now Playing</div>
            <h3 className="vinyl__title">{cur.title}</h3>
            <div className="vinyl__artist">{cur.artist || " "}</div>
            <div className="vinyl__bar" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekFrac((e.clientX - r.left) / r.width); }} role="progressbar" aria-valuenow={Math.round(frac * 100)}>
              <span className="vinyl__fill" style={{ width: (frac * 100) + "%" }} />
            </div>
            <div className="vinyl__times"><span>{fmt(st.time)}</span><span>{fmt(st.duration)}</span></div>
            <div className="vinyl__controls">
              <button className="vinyl__ctrl" onClick={prevTrack} disabled={list.length < 2} aria-label="Previous">⏮</button>
              <button className="vinyl__ctrl vinyl__ctrl--play" onClick={toggle} aria-label={st.playing ? "Pause" : "Play"}>{st.playing ? "❚❚" : "►"}</button>
              <button className="vinyl__ctrl" onClick={nextTrack} disabled={list.length < 2} aria-label="Next">⏭</button>
            </div>
          </div>
        </div>
        {list.length > 1 && (
          <ul className="playlist playlist--compact">
            {list.map((t, i) => (
              <li className={"playlist__item" + (i === st.index ? " is-active" : "")} key={t.id}>
                <button className="playlist__play" onClick={() => playIndex(i)} aria-label={"Play " + t.title}>{i === st.index && st.playing ? "❚❚" : "►"}</button>
                <span className="playlist__meta">
                  <span className="playlist__title">{t.title}</span>
                  {t.artist ? <span className="playlist__artist">{t.artist}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
