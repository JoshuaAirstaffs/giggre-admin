"use client";

import { useEffect, useState } from "react";
import { Smartphone, CheckCircle2, AlertTriangle } from "lucide-react";

// Mirrors the app's carousels: 16px corners, media scaled to fill and cropped
// (BoxFit.cover). Widths are the phone width minus 32px of screen padding.
//  - home:   the Home carousel, 16:9 on every phone (328px ≈ a 360px phone).
//  - banner: the Gig Worker / Gig Host carousels, locked at 140px tall, so the
//            shape changes with the phone: 2.34:1 (360px) to 2.84:1 (430px).
export type CarouselShape = "home" | "banner";

type Frame = { label: string | null; w: number; h: number };

const BANNER_HEIGHT = 140;
const FRAMES: Record<CarouselShape, Frame[]> = {
  home: [{ label: null, w: 328, h: 328 * 9 / 16 }],
  banner: [
    { label: "360 px phone", w: 328, h: BANNER_HEIGHT },
    { label: "393 px phone", w: 361, h: BANNER_HEIGHT },
    { label: "430 px phone", w: 398, h: BANNER_HEIGHT },
  ],
};

/** Size advice shown in the slide form and under the preview. */
export const SHAPE_ADVICE: Record<CarouselShape, { best: string; image: string; video: string; meta: string; tip: string }> = {
  home: {
    best: "16:9 landscape",
    image: "1920×1080 px recommended, or 1280×720",
    video: "1920×1080 (1080p) recommended, or 1280×720",
    meta: "Carousel shape: 16:9, e.g. 1280×720 or 1920×1080",
    tip: "Other shapes are cropped to fill the slide, so keep text and faces in the middle.",
  },
  banner: {
    best: "wide banner, about 2.6:1",
    image: "1550×600 px recommended",
    video: "1550×600 recommended",
    meta: "Banner shape: 140 px tall, from 2.34:1 (360 px phone) to 2.84:1 (430 px phone), e.g. 1550×600",
    tip: "The banner's shape changes with the phone, so up to about 9% is cut off: a little from the sides on smaller phones, the top and bottom on bigger ones. Keep text and faces in the middle.",
  },
};

/** Up to this share cut off still counts as a good fit. The banner allows a
 *  bit more: no single shape fits 2.34:1 to 2.84:1 within 8% (best: ~9.2%). */
const OK_CROP: Record<CarouselShape, number> = { home: 0.08, banner: 0.1 };

export function CarouselPreview({ kind, src, shape = "home" }: { kind: "image" | "video"; src: string; shape?: CarouselShape }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSize(null);
    setFailed(false);
  }, [src, kind]);

  const frames = FRAMES[shape];
  // The phone size that cuts off the most
  const crop = size
    ? frames.map((f) => cropInfo(size.w, size.h, f.w / f.h)).reduce((a, b) => (b.share > a.share ? b : a))
    : null;
  const multi = frames.length > 1;

  return (
    <div className="cp-wrap">
      <style>{`
        .cp-wrap { display: flex; flex-direction: column; gap: 8px; }
        .cp-head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
        .cp-stage { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .cp-phone { display: flex; flex-direction: column; align-items: center; gap: 4px; max-width: 100%; }
        .cp-phone-label { font-size: 10.5px; color: var(--text-muted); }
        .cp-frame { max-width: 100%; border-radius: 16px; overflow: hidden; background: var(--bg-surface); position: relative; box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
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
        {frames.map((f, i) => (
        <div className="cp-phone" key={f.w}>
        {f.label && <div className="cp-phone-label">{f.label}</div>}
        <div className="cp-frame" style={{ width: f.w, aspectRatio: `${f.w} / ${f.h}` }}>
          {failed ? (
            <div className="cp-empty">Can&apos;t preview this {kind}</div>
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt="Carousel preview"
              onLoad={i === 0 ? (e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }) : undefined}
              onError={() => setFailed(true)}
            />
          ) : (
            <video
              src={src}
              muted
              autoPlay
              loop
              playsInline
              onLoadedMetadata={i === 0 ? (e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight }) : undefined}
              onError={() => setFailed(true)}
            />
          )}
        </div>
        </div>
        ))}
      </div>

      {crop && (
        <>
          <div className={`cp-fit ${crop.share <= OK_CROP[shape] ? "ok" : "warn"}`}>
            {crop.share <= OK_CROP[shape] ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>
              {crop.share <= OK_CROP[shape]
                ? multi ? "Fits the banner well on every phone size." : "Fits the carousel well."
                : `${multi ? "Up to about" : "About"} ${Math.round(crop.share * 100)}% of the ${kind} will be cut off at the ${crop.edges} — keep important content in the middle, or use a ${shape === "home" ? "16:9" : "1550×600"} ${kind}.`}
            </span>
          </div>
          <div className="cp-meta">
            Your {kind}: {size!.w}×{size!.h} ({crop.label}) · {SHAPE_ADVICE[shape].meta}
          </div>
        </>
      )}
    </div>
  );
}

/** How much of a w×h media is hidden when it covers a box of the given ratio, and where. */
function cropInfo(w: number, h: number, box: number) {
  const ratio = w / h;
  const label = Math.abs(ratio - 16 / 9) < 0.02 ? "16:9" : ratio > 1 ? `landscape, ${ratio.toFixed(2)}:1` : ratio === 1 ? "square" : "portrait";
  if (ratio > box) {
    return { share: 1 - box / ratio, edges: "left and right", label };
  }
  return { share: 1 - ratio / box, edges: "top and bottom", label };
}
