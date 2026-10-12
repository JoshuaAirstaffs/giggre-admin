"use client";

import { useEffect, useRef, useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL, type UploadTask } from "firebase/storage";
import { Upload, X, ImageOff } from "lucide-react";
import { storage } from "@/lib/firebase";
import { toast } from "@/components/ui/Toaster";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Image picker that uploads to Firebase Storage under `folder` and reports the
 * download URL via onChange. A URL can still be pasted by hand.
 */
export function ImageUploadField({
  value,
  onChange,
  folder,
  disabled,
  onFileChosen,
  onUploadingChange,
  onUploaded,
}: {
  value: string;
  onChange: (url: string) => void;
  folder: string;
  disabled?: boolean;
  /** Called with the picked file's name (without extension), e.g. to prefill a title */
  onFileChosen?: (baseName: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  /** Every file this field uploads, so the form can clean up ones never saved */
  onUploaded?: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<UploadTask | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const uploading = progress != null;
  useEffect(() => onUploadingChange?.(uploading), [uploading, onUploadingChange]);
  useEffect(() => setPreviewFailed(false), [value]);
  // Abandon an in-flight upload if the form closes
  useEffect(() => () => { taskRef.current?.cancel(); }, []);

  const upload = (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Unsupported file", "Use a JPG, PNG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image too large", `Max ${MAX_BYTES / 1024 / 1024} MB — this one is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }

    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const task = uploadBytesResumable(ref(storage, `${folder}/${Date.now()}_${safeName}`), file, {
      contentType: file.type,
      cacheControl: "public, max-age=31536000",
    });
    taskRef.current = task;
    setProgress(0);
    onFileChosen?.(file.name.replace(/\.[^.]+$/, ""));

    task.on(
      "state_changed",
      (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => {
        taskRef.current = null;
        setProgress(null);
        if (err.code === "storage/canceled") return;
        console.error("[ImageUploadField] upload failed:", err);
        toast.error(
          "Upload failed",
          err.code === "storage/unauthorized"
            ? "Storage rules don't allow this upload."
            : err.message
        );
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          onUploaded?.(url);
          onChange(url);
          toast.success("Image uploaded");
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
        .iu-drop {
          position: relative; width: 100%; min-height: 120px; overflow: hidden;
          background: var(--bg-elevated); border: 2px dashed var(--border); border-radius: var(--radius-sm);
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
          color: var(--text-muted); font-size: 12px; cursor: pointer; transition: border-color 0.2s, color 0.2s;
        }
        .iu-drop:hover, .iu-drop.over { border-color: var(--blue); color: var(--blue); }
        .iu-drop.busy, .iu-drop.off { cursor: default; }
        .iu-drop img { width: 100%; max-height: 200px; object-fit: contain; display: block; }
        .iu-hint {
          position: absolute; inset: auto 0 0 0; padding: 6px; text-align: center;
          background: rgba(0,0,0,0.55); color: #fff; font-size: 11px; opacity: 0; transition: opacity 0.15s;
        }
        .iu-drop:hover .iu-hint { opacity: 1; }
        .iu-bar { width: 70%; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
        .iu-bar > div { height: 100%; background: var(--blue); transition: width 0.15s; }
        .iu-clear {
          position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; cursor: pointer;
          background: rgba(0,0,0,0.6); color: #fff; border: none;
        }
      `}</style>

      <div
        className={`iu-drop ${dragOver ? "over" : ""} ${uploading ? "busy" : ""} ${disabled ? "off" : ""}`}
        onClick={pick}
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !disabled && !uploading) upload(file);
        }}
        role="button"
        aria-label="Upload image"
      >
        {uploading ? (
          <>
            <span>Uploading… {progress}%</span>
            <div className="iu-bar"><div style={{ width: `${progress}%` }} /></div>
          </>
        ) : value && !previewFailed ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="Preview" onError={() => setPreviewFailed(true)} />
            <span className="iu-hint">Click or drop to replace</span>
            {!disabled && (
              <button
                type="button"
                className="iu-clear"
                title="Remove image"
                onClick={(e) => { e.stopPropagation(); onChange(""); }}
              >
                <X size={13} />
              </button>
            )}
          </>
        ) : value && previewFailed ? (
          <><ImageOff size={18} /><span>Can&apos;t preview this URL — click or drop to upload instead</span></>
        ) : (
          <>
            <Upload size={16} />
            <span>Click or drop an image to upload</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>JPG, PNG, WebP or GIF · up to {MAX_BYTES / 1024 / 1024} MB</span>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
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
