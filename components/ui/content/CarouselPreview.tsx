"use client";

import { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, AlertTriangle } from "lucide-react";

// Mirrors the app's home carousel (giggre_app home_screen.dart: _SlideItem /
// _VideoSlideItem): a 16:9 box, 16px corners, media scaled to fill and
// cropped (BoxFit.cover). 328px ≈ a 360px-wide phone minus the screen padding.
const RATIO = 16 / 9;
const PREVIEW_WIDTH = 328;

/** Up to this share cut off still counts as a good fit. */
const OK_CROP = 0.08;

export function CarouselPreview({ kind, src }: { kind: "image" | "video"; src: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSize(null);
    setFailed(false);
  }, [src, kind]);

  const crop = size ? cropInfo(size.w, size.h) : null;

  return (
    <div className="cp-wrap">
      <style>{`
        .cp-wrap { display: flex; flex-direction: column; gap: 8px; }
        .cp-head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
        .cp-stage { display: flex; justify-content: center; padding: 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .cp-frame { width: ${PREVIEW_WIDTH}px; max-width: 100%; aspect-ratio: 16 / 9; border-radius: 16px; overflow: hidden; background: var(--bg-surface); position: relative; box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
        .cp-frame img, .cp-frame video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cp-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted); text-align: center; padding: 8px; }
        .cp-fit { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; line-height: 1.45; }
        .cp-fit.ok { color: var(--green); }
        .cp-fit.warn { color: var(--amber); }
        .cp-fit svg { flex-shrink: 0; margin-top: 1px; }
        .cp-meta { font-size: 11px; color: var(--text-muted); }
      `}</style>

      <div className="cp-head"><Smartphone size={12} /> App preview</div>

      <div className="cp-stage">
        <div className="cp-frame">
          {failed ? (
            <div className="cp-empty">Can&apos;t preview this {kind}</div>
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="Carousel preview"
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
            />
          ) : (
            <video
              src={src}
              muted
              autoPlay
              loop
              playsInline
              onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>

      {crop && (
        <>
          <div className={`cp-fit ${crop.share <= OK_CROP ? "ok" : "warn"}`}>
            {crop.share <= OK_CROP ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>
              {crop.share <= OK_CROP
                ? "Fits the carousel well."
                : `About ${Math.round(crop.share * 100)}% of the ${kind} will be cut off at the ${crop.edges} — keep important content in the middle, or use a 16:9 ${kind}.`}
            </span>
          </div>
          <div className="cp-meta">
            Your {kind}: {size!.w}×{size!.h} ({crop.label}) · Carousel shape: 16:9, e.g. 1280×720 or 1920×1080
          </div>
        </>
      )}
    </div>
  );
}

/** How much of a w×h media is hidden when it covers a 16:9 box, and where. */
function cropInfo(w: number, h: number) {
  const ratio = w / h;
  const label = Math.abs(ratio - RATIO) < 0.02 ? "16:9" : ratio > 1 ? "landscape" : ratio === 1 ? "square" : "portrait";
  if (ratio > RATIO) {
    return { share: 1 - RATIO / ratio, edges: "left and right", label };
  }
  return { share: 1 - ratio / RATIO, edges: "top and bottom", label };
}
