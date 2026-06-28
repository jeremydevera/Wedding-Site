import React from "react";
import { useStore } from "@/lib/store.jsx";
const { useState, useEffect, useRef } = React;

// Module-level control so the home playlist list can drive the single <audio>
// that lives in the floating player (one audio element for the whole app).
let _control = null;
export function playPlaylistTrack(i) { if (_control) _control(i); }

// Floating background player: auto-plays the playlist on load (falling back to
// the first user gesture when the browser blocks autoplay), loops, and exposes
// play/pause + next. Rendered once at the app root so it survives route changes.
export function MusicPlayer() {
  const { playlist } = useStore();
  const tracks = playlist || [];
  const audioRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { _control = (i) => { setIdx(i); setPlaying(true); }; return () => { _control = null; }; }, []);
  useEffect(() => { if (idx >= tracks.length) setIdx(0); }, [tracks.length, idx]);

  // Load the current track when the index changes.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !tracks[idx]) return;
    if (a.dataset.src !== tracks[idx].url) { a.src = tracks[idx].url; a.dataset.src = tracks[idx].url; }
    if (playing) a.play().catch(() => setPlaying(false));
  }, [idx, tracks]);

  // Sync play/pause state to the element.
  useEffect(() => {
    const a = audioRef.current; if (!a) return;
    if (playing) a.play().catch(() => setPlaying(false)); else a.pause();
  }, [playing]);

  // Attempt autoplay once tracks exist; if blocked, start on the first gesture.
  useEffect(() => {
    if (!tracks.length) return;
    const a = audioRef.current; if (!a) return;
    if (!a.dataset.src) { a.src = tracks[0].url; a.dataset.src = tracks[0].url; }
    let done = false;
    const start = () => { if (done) return; done = true; a.play().then(() => setPlaying(true)).catch(() => {}); off(); };
    const off = () => { window.removeEventListener("pointerdown", start); window.removeEventListener("keydown", start); window.removeEventListener("scroll", start); };
    a.play().then(() => setPlaying(true)).catch(() => {
      window.addEventListener("pointerdown", start, { once: true });
      window.addEventListener("keydown", start, { once: true });
      window.addEventListener("scroll", start, { once: true, passive: true });
    });
    return off;
  }, [tracks.length]);

  const next = () => setIdx((i) => (tracks.length ? (i + 1) % tracks.length : 0));

  if (!tracks.length) return null;
  const cur = tracks[Math.min(idx, tracks.length - 1)] || tracks[0];
  return (
    <div className={"music-player" + (playing ? " is-playing" : "")} aria-label="Background music">
      <audio ref={audioRef} onEnded={next} preload="none" />
      <button className="music-player__btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause music" : "Play music"}>{playing ? "❚❚" : "►"}</button>
      <div className="music-player__meta">
        <span className="music-player__title">{cur.title}</span>
        {cur.artist ? <span className="music-player__artist">{cur.artist}</span> : null}
      </div>
      {tracks.length > 1 && <button className="music-player__next" onClick={next} aria-label="Next track">⏭</button>}
    </div>
  );
}

// Home "Our Playlist" list — tap a track to play it in the floating player.
export function PlaylistView({ tracks }) {
  const list = tracks || [];
  if (!list.length) return null;
  return (
    <section className="block" id="home-playlist">
      <div className="container container--narrow">
        <div className="sec-head sec-head--center">
          <div className="eyebrow">Press Play</div>
          <h2 className="sec-head__title">Our Playlist</h2>
        </div>
        <ul className="playlist">
          {list.map((t, i) => (
            <li className="playlist__item" key={t.id}>
              <button className="playlist__play" onClick={() => playPlaylistTrack(i)} aria-label={"Play " + t.title}>►</button>
              <span className="playlist__meta">
                <span className="playlist__title">{t.title}</span>
                {t.artist ? <span className="playlist__artist">{t.artist}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
