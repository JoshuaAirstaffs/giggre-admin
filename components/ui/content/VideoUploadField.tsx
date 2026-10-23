"use client";

import { useEffect, useRef, useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL, type UploadTask } from "firebase/storage";
import { Film, X } from "lucide-react";
import { storage } from "@/lib/firebase";
import { toast } from "@/components/ui/Toaster";

/** MP4 only — the one format both Android and iOS players handle reliably. */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SECONDS = 30;

/** Real MP4 files have an "ftyp" box at bytes 4–8, whatever their name says. */
async function isMp4(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(4, 8).arrayBuffer());
  return String.fromCharCode(...b) === "ftyp";
}

/** Duration in seconds, or null if the browser can't read the file as video. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(isFinite(v.duration) ? v.duration : null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}

/**
 * Optional carousel video. Uploads to Firebase Storage under `folder` and
 * reports the download URL via onChange ("" when removed).
 */
export function VideoUploadField({
  value,
  onChange,
  folder,
  disabled,
  onUploadingChange,
  onUploaded,
}: {
  value: string;
  onChange: (url: string) => void;
  folder: string;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  /** Every file this field uploads, so the form can clean up ones never saved */
  onUploaded?: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<UploadTask | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploading = progress != null;
  useEffect(() => onUploadingChange?.(uploading), [uploading, onUploadingChange]);
  // Abandon an in-flight upload if the form closes
  useEffect(() => () => { taskRef.current?.cancel(); }, []);

  const upload = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "mp4" || !(await isMp4(file))) {
      toast.error("Unsupported video", "Only MP4 videos can be uploaded.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Video too large", `Max ${MAX_BYTES / 1024 / 1024} MB — this one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    const seconds = await readDuration(file);
    if (seconds == null) {
      toast.error("Unreadable video", "This MP4 couldn't be opened. Try exporting it again (H.264).");
      return;
    }
    if (seconds > MAX_SECONDS + 0.5) {
      toast.error("Video too long", `Max ${MAX_SECONDS} seconds — this one is ${Math.round(seconds)} seconds.`);
      return;
    }

    const base = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "video";
    const task = uploadBytesResumable(ref(storage, `${folder}/${Date.now()}_${base}.mp4`), file, {
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000",
    });
    taskRef.current = task;
    setProgress(0);

    task.on(
      "state_changed",
      (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => {
        taskRef.current = null;
        setProgress(null);
        if (err.code === "storage/canceled") return;
        console.error("[VideoUploadField] upload failed:", err);
        toast.error("Upload failed", err.code === "storage/unauthorized" ? "Storage rules don't allow this upload." : err.message);
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onUploaded?.(url);
          onChange(url);
          toast.success("Video uploaded");
        } finally {
          taskRef.current = null;
          setProgress(null);
        }
      }
    );
  };

  const pick = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  return (
    <div>
      <style>{`
        .vu-drop {
          position: relative; width: 100%; min-height: 84px; overflow: hidden;
          background: var(--bg-elevated); border: 2px dashed var(--border); border-radius: var(--radius-sm);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
          color: var(--text-muted); font-size: 12px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
        }
        .vu-drop:hover, .vu-drop.over { border-color: var(--blue); color: var(--blue); }
        .vu-drop.busy, .vu-drop.off, .vu-drop.has { cursor: default; }
        .vu-drop video { width: 100%; max-height: 220px; display: block; background: #000; }
        .vu-bar { width: 70%; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
        .vu-bar > div { height: 100%; background: var(--blue); transition: width 0.15s; }
        .vu-actions { display: flex; gap: 8px; margin-top: 6px; }
        .vu-btn {
          display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; font-size: 11px; font-weight: 600;
          border-radius: 999px; cursor: pointer; font-family: inherit;
          color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border);
        }
        .vu-btn:hover { color: var(--text-primary); }
      `}</style>

      <div
        className={`vu-drop ${dragOver ? "over" : ""} ${uploading ? "busy" : ""} ${disabled ? "off" : ""} ${value ? "has" : ""}`}
        onClick={value ? undefined : pick}
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !disabled && !uploading) upload(file);
        }}
        role="button"
        aria-label="Upload video"
      >
        {uploading ? (
          <>
            <span>Uploading video… {progress}%</span>
            <div className="vu-bar"><div style={{ width: `${progress}%` }} /></div>
          </>
        ) : value ? (
          <video src={value} controls muted playsInline preload="metadata" />
        ) : (
          <>
            <Film size={16} />
            <span>Optional: click or drop an MP4 video</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>MP4 · up to {MAX_BYTES / 1024 / 1024} MB · up to {MAX_SECONDS} seconds</span>
          </>
        )}
      </div>

      {value && !uploading && !disabled && (
        <div className="vu-actions">
          <button type="button" className="vu-btn" onClick={pick}><Film size={11} /> Replace video</button>
          <button type="button" className="vu-btn" onClick={() => onChange("")}><X size={11} /> Remove video</button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,.mp4"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow picking the same file again
          if (file) upload(file);
        }}
      />
    </div>
  );
}
