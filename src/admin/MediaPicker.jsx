// src/admin/MediaPicker.jsx
// Reusable media library picker: a grid/list of the client's existing R2 files
// (images or audio), plus a modal wrapper with an Upload-new | Choose-from-library
// toggle. Picking returns the bare R2 key (stored/rendered exactly like an upload).
import React, { useEffect, useState } from "react";
import { Modal, Button } from "@/ui/components.jsx";
import { mediaUrl } from "@/lib/media.js";
import { listMedia } from "@/lib/api.js";
import { useStore } from "@/lib/store.jsx";

export function MediaLibrary({ type, clientId, onPick }) {
  const [state, setState] = useState({ status: "loading", items: [], error: "" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading", items: [], error: "" });
    listMedia(clientId, type)
      .then((items) => { if (live) setState({ status: "ready", items, error: "" }); })
      .catch((e) => { if (live) setState({ status: "error", items: [], error: (e && e.message) || "error" }); });
    return () => { live = false; };
  }, [clientId, type]);

  if (state.status === "loading") return <p className="medialib__msg">Loading…</p>;
  if (state.status === "error") return <p className="medialib__msg medialib__msg--err">Couldn't load your library: {state.error}</p>;
  if (!state.items.length) return <p className="medialib__msg">No uploads yet — switch to "Upload new".</p>;

  if (type === "audio") {
    return (
      <ul className="medialib medialib--audio">
        {state.items.map((it) => (
          <li key={it.key} className="medialib__row">
            <button type="button" className="medialib__pick" onClick={() => onPick(it.key)}>{it.name}</button>
            <audio src={mediaUrl(it.key)} controls preload="none" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="medialib medialib--grid">
      {state.items.map((it) => (
        <button type="button" key={it.key} className="medialib__cell" onClick={() => onPick(it.key)} aria-label={it.name} title={it.name}>
          <img src={mediaUrl(it.key)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span className="medialib__name">{it.name}</span>
        </button>
      ))}
    </div>
  );
}

// open/onClose control the modal. onUploadNew is called when the user clicks the
// button on the "Upload new" tab (the caller triggers its own file input / crop).
// uploading + uploadLabel let the caller reflect upload progress in this modal.
export function MediaPickerModal({ open, onClose, type, clientId, onPick, onUploadNew, uploading, uploadLabel }) {
  const { auth } = useStore();
  // "Choose from library" reuses R2 assets — a superadmin-only tool. Clients
  // (owners) only ever upload their own file, so the library tab is hidden for
  // them and the modal is upload-only.
  const canLibrary = auth?.role === "superadmin";
  const [tab, setTab] = useState("upload");
  useEffect(() => { if (open) setTab("upload"); }, [open]);
  return (
    <Modal open={open} onClose={onClose} label="Media">
      {canLibrary && (
        <div className="medialib__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "upload"} className={"medialib__tab" + (tab === "upload" ? " is-on" : "")} onClick={() => setTab("upload")}>Upload new</button>
          <button type="button" role="tab" aria-selected={tab === "library"} className={"medialib__tab" + (tab === "library" ? " is-on" : "")} onClick={() => setTab("library")}>Choose from library</button>
        </div>
      )}
      {(!canLibrary || tab === "upload") ? (
        <div className="medialib__upload">
          <Button variant="primary" disabled={uploading} onClick={onUploadNew}>{uploading ? "Uploading…" : (uploadLabel || "Choose a file")}</Button>
          <p className="medialib__msg">Pick a file from your device.</p>
        </div>
      ) : (
        <MediaLibrary type={type} clientId={clientId} onPick={(key) => { onPick(key); onClose(); }} />
      )}
    </Modal>
  );
}
