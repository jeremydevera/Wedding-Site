import React from "react";
import { go } from "@/lib/nav.js";
import { scrollToTop } from "@/lib/scroll.js";
import { Store, uid, useStore } from "@/lib/store.jsx";
import { Button, Field, Icon, Input, Modal, Placeholder } from "@/ui/components.jsx";
import { PageHero } from "@/pages/PublicPages.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// media.jsx — photo/video upload (with progress + confirmation), gallery, lightbox
// ============================================================================

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/jpg"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const PHOTO_MAX = 25 * 1024 * 1024;
export const VIDEO_MAX = 25 * 1024 * 1024;

// Downscale an image file to a JPEG data URL (keeps localStorage small)
export function imageToDataUrl(file, maxDim = 1100) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL("image/jpeg", 0.84), ratio: `${w} / ${h}` });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

// Capture a poster frame from a video file; keep an object URL for playback
export function videoToThumb(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.src = url;
    let settled = false;
    let timer;
    const done = (dataUrl, ratio) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ dataUrl, src: url, ratio });
    };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); } catch (e) {} };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.8), `${c.width} / ${c.height}`);
      } catch (e) { done(null, "4 / 3"); }
    };
    v.onerror = () => done(null, "4 / 3");
    timer = setTimeout(() => done(null, "4 / 3"), 4000); // safety
  });
}

export function UploadFlow({ category = "gallery", title, eyebrow, lead, accept = "both" }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState([]); // {file, type, thumb}
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const progressIntervalRef = useRef(null);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);

  useEffect(() => () => { if (progressIntervalRef.current) clearInterval(progressIntervalRef.current); }, []);

  const acceptAttr = accept === "photo" ? PHOTO_TYPES.join(",")
    : accept === "video" ? VIDEO_TYPES.join(",")
    : [...PHOTO_TYPES, ...VIDEO_TYPES].join(",");

  async function addFiles(fileList) {
    setErr("");
    const files = Array.from(fileList).slice(0, 10 - items.length);
    const next = [];
    for (const file of files) {
      const ext = file.name.split(".").pop().toLowerCase();
      const isPhoto = file.type.startsWith("image/") || PHOTO_TYPES.includes(file.type) || ["heic", "heif"].includes(ext);
      const isVideo = file.type.startsWith("video/") || VIDEO_TYPES.includes(file.type);
      if (accept === "photo" && !isPhoto) { setErr("That file type isn't supported here. Please choose a photo."); continue; }
      if (accept === "video" && !isVideo) { setErr("That file type isn't supported here. Please choose a video."); continue; }
      if (!isPhoto && !isVideo) { setErr("Unsupported file type."); continue; }
      if (isPhoto && file.size > PHOTO_MAX) { setErr(`"${file.name}" is too large (max 25 MB).`); continue; }
      if (isVideo && file.size > VIDEO_MAX) { setErr(`"${file.name}" is too large (max 25 MB).`); continue; }
      try {
        const thumb = isPhoto ? await imageToDataUrl(file) : await videoToThumb(file);
        next.push({ id: uid(), file, type: isPhoto ? "photo" : "video", thumb, size: file.size });
      } catch (e) { setErr(`Couldn't read "${file.name}". Try another file.`); }
    }
    setItems((cur) => [...cur, ...next].slice(0, 10));
  }

  function removeItem(id) {
    setItems((cur) => {
      const item = cur.find((x) => x.id === id);
      if (item?.type === "video" && item.thumb?.src?.startsWith("blob:")) URL.revokeObjectURL(item.thumb.src);
      return cur.filter((x) => x.id !== id);
    });
  }

  async function upload() {
    if (!name.trim()) { setErr("Please enter your name first."); return; }
    if (!items.length) { setErr("Please add at least one file."); return; }
    setBusy(true); setErr(""); setProgress(0);
    // simulate upload progress
    await new Promise((res) => {
      let p = 0;
      progressIntervalRef.current = setInterval(() => {
        p += Math.random() * 18 + 6;
        setProgress(Math.min(98, p));
        if (p >= 98) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; res(); }
      }, 160);
    });
    Store.addMedia(items.map((it) => ({
      type: it.type, category,
      // Always use dataUrl for src so the value survives a page reload (blob: URLs are ephemeral).
      dataUrl: it.thumb.dataUrl, src: it.thumb.dataUrl || it.thumb.src,
      ratio: it.thumb.ratio, name: name.trim(), message: msg.trim(),
      status: category === "gallery" ? (Store.get().settings.autoApproveMedia ? "approved" : "pending") : "approved", size: it.size,
    })));
    setProgress(100);
    setTimeout(() => { setBusy(false); setDone(true); scrollToTop({ top: 0, behavior: "smooth" }); }, 400);
  }

  if (done) {
    return (
      <div className="fade-up">
        <section className="block">
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <div className="confirm__seal">{Icon.check({})}</div>
              <h2 className="confirm__title">Thank you, {name.split(" ")[0]}!</h2>
              <p className="confirm__text">
                {category === "gallery"
                  ? (Store.get().settings.autoApproveMedia
                      ? `Your ${items.length} ${items.length > 1 ? "memories are" : "memory is"} uploaded and now part of the gallery. Keep them coming!`
                      : `Your ${items.length} ${items.length > 1 ? "memories have" : "memory has"} been uploaded and sent to the couple for a quick review before appearing in the gallery.`)
                  : "Your private video message has been delivered. The couple will treasure it."}
              </p>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                {category === "gallery" && <Button variant="primary" onClick={() => go("gallery")}>View the gallery</Button>}
                <Button variant="ghost" onClick={() => { setDone(false); setItems([]); setMsg(""); }}>Upload more</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!Store.get().settings.uploadsEnabled) {
    return (
      <div className="fade-up">
        <PageHero eyebrow={eyebrow} title={title} lead={lead} />
        <section className="block" style={{ paddingTop: 18 }}>
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <div className="confirm__seal">{Icon.camera({})}</div>
              <h2 className="confirm__title">Uploads are closed</h2>
              <p className="confirm__text">Sharing isn't open right now. Please check back soon — the couple will turn it on around the celebration.</p>
              <Button variant="ghost" onClick={() => go("home")}>Back home</Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageHero eyebrow={eyebrow} title={title} lead={lead} />
      <section className="block" style={{ paddingTop: 18 }}>
        <div className="container container--narrow">
          <div className="card card--pad-lg">
            <Field label="Your name" required id="u-name">
              <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="So the couple knows who to thank" />
            </Field>
            <Field label="Add a message" hint="Optional" id="u-msg">
              <Input id="u-msg" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="A caption for your memory" />
            </Field>

            <div
              className={"dropzone" + (over ? " dropzone--over" : "")}
              onClick={() => inputRef.current && inputRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
            >
              <div className="dropzone__icon">{accept === "video" ? Icon.play({}) : Icon.camera({})}</div>
              <div className="dropzone__title">Tap to choose, or drop files here</div>
              <div className="dropzone__hint">
                {accept === "photo" && "JPG, PNG, WEBP, HEIC \u00b7 up to 25 MB each \u00b7 max 10"}
                {accept === "video" && "MP4, MOV, WEBM \u00b7 up to 25 MB \u00b7 keep clips under a minute"}
                {accept === "both" && "Photos & videos \u00b7 up to 10 files"}
              </div>
              <input ref={inputRef} type="file" accept={acceptAttr} multiple={category === "gallery"}
                style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
            </div>

            {items.length > 0 && (
              <div className="up-list">
                {items.map((it) => (
                  <div className="up-thumb" key={it.id}>
                    {it.thumb.dataUrl
                      ? <img src={it.thumb.dataUrl} alt="" />
                      : <Placeholder label={it.type} ratio="1" />}
                    {it.type === "video" && <span className="gal-cell__badge" style={{ top: 4, left: 4 }}>{Icon.play({})}</span>}
                    <button className="up-thumb__x" onClick={() => removeItem(it.id)} aria-label="Remove">{Icon.close({})}</button>
                  </div>
                ))}
              </div>
            )}

            {err && <p className="field__error" style={{ marginTop: 14 }}>{err}</p>}
            {busy && <div className="progress"><div className="progress__bar" style={{ width: progress + "%" }} /></div>}

            <div style={{ marginTop: 22 }}>
              <Button variant="primary" size="lg" block disabled={busy} onClick={upload}>
                {busy ? `Uploading\u2026 ${Math.round(progress)}%` : `Upload ${items.length || ""} ${items.length === 1 ? "file" : "files"}`.trim()}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function UploadPage() {
  const [mode, setMode] = useState("photo");
  return (
    <div>
      <PageHero eyebrow="Share the moment" title="Upload your memories" lead="No app, no login — just your name and your photos. Everything you share appears in the live gallery." />
      <div className="container" style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
        <div className="seg" style={{ borderRadius: 100 }}>
          <button className={mode === "photo" ? "on" : ""} onClick={() => setMode("photo")} style={{ borderRadius: 0 }}>Photos</button>
          <button className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}>Videos</button>
        </div>
      </div>
      {mode === "photo"
        ? <UploadFlow key="p" accept="photo" eyebrow={null} title={null} lead={null} />
        : <UploadFlow key="v" accept="video" eyebrow={null} title={null} lead={null} />}
    </div>
  );
}

export function VideoMessagePage() {
  return (
    <UploadFlow
      category="private_video_message"
      accept="video"
      eyebrow="Private Message"
      title="Leave a video greeting"
      lead="Record a short message for the couple to watch later. Only they will see it — it won't appear in the public gallery."
    />
  );
}

// --- Gallery ---------------------------------------------------------------
export function GalleryPage() {
  const { media, settings } = useStore();
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState(null);

  const visible = media.filter((m) => m.category === "gallery" && m.status === "approved");
  const shown = visible.filter((m) => filter === "all" || m.type === filter);

  if (!settings.galleryEnabled) {
    return (
      <div className="fade-up">
        <PageHero eyebrow="Gallery" title="Moments, by everyone" />
        <section className="block" style={{ paddingTop: 18 }}>
          <div className="container container--narrow">
            <div className="card card--pad-lg confirm">
              <div className="confirm__seal">{Icon.grid({})}</div>
              <h2 className="confirm__title">The gallery is private</h2>
              <p className="confirm__text">The couple has kept the photo gallery private for now. Please check back later.</p>
              <Button variant="ghost" onClick={() => go("home")}>Back home</Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <PageHero eyebrow="Gallery" title="Moments, by everyone" lead={`Every photo and clip shared by guests of ${[settings.partnerA, settings.partnerB].filter(Boolean).join(" & ")}.`} />
      <section className="block" style={{ paddingTop: 18 }}>
        <div className="container container--wide">
          <div className="gal-toolbar">
            {[["all", "All"], ["photo", "Photos"], ["video", "Videos"]].map(([v, l]) => (
              <Button key={v} variant={filter === v ? "primary" : "ghost"} size="sm" onClick={() => setFilter(v)}>{l}</Button>
            ))}
            <Button variant="gold" size="sm" onClick={() => go("upload")} style={{ color: "var(--accent)", borderColor: "var(--line)" }}>{Icon.upload({})} Add yours</Button>
          </div>

          {shown.length === 0 ? (
            <div className="gal-empty">
              <div style={{ color: "var(--accent)", marginBottom: 12 }}>{Icon.camera({ style: { width: 44, height: 44, margin: "0 auto" } })}</div>
              <p style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--ink)" }}>No photos or videos yet.</p>
              <p>Be the first to share a memory!</p>
              <Button variant="primary" style={{ marginTop: 16 }} onClick={() => go("upload")}>Upload now</Button>
            </div>
          ) : (
            <div className="gal-grid">
              {shown.map((m) => (
                <div className="gal-cell" key={m.id} onClick={() => setActive(m)} style={{ aspectRatio: m.dataUrl ? "auto" : m.ratio }}>
                  {m.dataUrl
                    ? <img src={m.dataUrl} alt={m.message || "guest photo"} loading="lazy" />
                    : <Placeholder label={m.type === "video" ? "guest video" : "guest photo"} ratio={m.ratio} />}
                  {m.type === "video" && <span className="gal-cell__badge">{Icon.play({})} Video</span>}
                  <div className="gal-cell__meta">
                    <strong>{m.name}</strong>{m.message ? ` \u2014 ${m.message}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Modal open={!!active} onClose={() => setActive(null)} wide label="Media preview">
        {active && (
          <div className="lightbox">
            {active.type === "video" && active.src
              ? <video src={active.src} controls autoPlay style={{ maxWidth: "100%", maxHeight: "76vh" }} />
              : active.dataUrl
              ? <img src={active.dataUrl} alt={active.message || ""} />
              : <Placeholder label={active.type === "video" ? "guest video" : "guest photo"} ratio={active.ratio} style={{ maxHeight: "70vh" }} />}
            <div className="lightbox__meta">
              <div className="lightbox__name">{active.name}</div>
              {active.message && <p style={{ margin: "6px 0 0" }}>{active.message}</p>}
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>{new Date(active.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

