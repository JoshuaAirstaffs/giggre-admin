"use client";

import { Check, X } from "lucide-react";
import {
  BEST_WEIGHTS, BEST_MIN_COMPLETED, BEST_MIN_RATINGS, RATING_PRIOR_WEIGHT,
  type BestEntry,
} from "./leaderboard";

type Role = "host" | "worker";

const fmt1 = (n: number) => n.toFixed(1);
const fmt2 = (n: number) => n.toFixed(2);

// ─── Plain-language explainer ─────────────────────────────────────────────────

export function ScoreExplainer() {
  return (
    <div className="sb-explainer">
      <div className="sb-explainer-grid">
        <div>
          <div className="sb-h">Who can qualify</div>
          <ul>
            <li>Verified account, not banned or suspended</li>
            <li>At least {BEST_MIN_COMPLETED} completed gigs this month</li>
            <li>At least {BEST_MIN_RATINGS} ratings received this month</li>
          </ul>
        </div>
        <div>
          <div className="sb-h">How the score (0–100) is made</div>
          <ul>
            <li>
              <b>Rating · {BEST_WEIGHTS.rating} pts</b> — how well others rated them. With only a few ratings,
              the score leans toward the month&apos;s average until more come in, so one lucky 5★ can&apos;t win.
            </li>
            <li>
              <b>Reliability · {BEST_WEIGHTS.reliability} pts</b> — share of their gigs they finished. Only
              cancellations <i>they</i> caused count against them.
            </li>
            <li>
              <b>Activity · {BEST_WEIGHTS.activity} pts</b> — completed gigs compared with the month&apos;s busiest
              user. Extra gigs count for less and less, so volume alone can&apos;t win.
            </li>
          </ul>
        </div>
      </div>
      <div className="sb-note">
        Top 5 eligible scores earn the badge. Click anyone in the table to see how their score was worked out.
      </div>
    </div>
  );
}

// ─── Per-user breakdown ───────────────────────────────────────────────────────

function Part({
  title, points, max, color, sentence, math,
}: {
  title: string;
  points: number;
  max: number;
  color: string;
  sentence: React.ReactNode;
  math: React.ReactNode;
}) {
  return (
    <div className="sb-part">
      <div className="sb-part-top">
        <span className="sb-part-title">{title}</span>
        <span className="sb-part-pts"><b>{fmt1(points)}</b> / {max}</span>
      </div>
      <div className="sb-bar"><div style={{ width: `${(points / max) * 100}%`, background: color }} /></div>
      <div className="sb-sentence">{sentence}</div>
      <div className="sb-math">{math}</div>
    </div>
  );
}

export function ScoreBreakdownDetail({ entry, role }: { entry: BestEntry; role: Role }) {
  const b = entry.breakdown;
  const other = role === "host" ? "workers" : "hosts";
  const ended = entry.completed + entry.cancelled;
  const total = b.ratingPoints + b.reliabilityPoints + b.activityPoints;

  const checks: [string, boolean][] = [
    ["Verified", !entry.ineligible.includes("unverified")],
    ["Not banned / suspended", !entry.ineligible.includes("restricted")],
    [`${BEST_MIN_COMPLETED}+ completed (${entry.completed})`, !entry.ineligible.includes("few_gigs")],
    [`${BEST_MIN_RATINGS}+ ratings (${entry.ratingCount})`, !entry.ineligible.includes("few_ratings")],
  ];

  return (
    <div className="sb-detail">
      <div className="sb-parts">
        <Part
          title="Rating"
          points={b.ratingPoints}
          max={BEST_WEIGHTS.rating}
          color="var(--amber)"
          sentence={
            entry.ratingCount === 0
              ? <>No ratings from {other} yet, so they get the month&apos;s average ({fmt2(b.monthAvgRating)}★).</>
              : <>Averaged <b>{fmt2(entry.avgRating!)}★</b> from {entry.ratingCount} rating{entry.ratingCount === 1 ? "" : "s"} by {other}.
                  Blended with {RATING_PRIOR_WEIGHT} month-average ratings ({fmt2(b.monthAvgRating)}★) → <b>{fmt2(b.adjustedRating)}★</b>.</>
          }
          math={<>
            ({RATING_PRIOR_WEIGHT} × {fmt2(b.monthAvgRating)} + {b.ratingSum}) ÷ ({RATING_PRIOR_WEIGHT} + {entry.ratingCount}) = {fmt2(b.adjustedRating)}★
            <br />
            {BEST_WEIGHTS.rating} × ({fmt2(b.adjustedRating)} − 1) ÷ 4 = {fmt1(b.ratingPoints)}
          </>}
        />
        <Part
          title="Reliability"
          points={b.reliabilityPoints}
          max={BEST_WEIGHTS.reliability}
          color="var(--green)"
          sentence={
            ended === 0
              ? <>No gigs finished or cancelled this month.</>
              : <>Finished <b>{entry.completed} of {ended}</b> gigs that ended
                  {entry.cancelled > 0 ? <> ({entry.cancelled} cancellation{entry.cancelled === 1 ? "" : "s"} they caused)</> : <> — no cancellations</>}.</>
          }
          math={<>
            {entry.completed} ÷ {ended || 0} = {entry.reliability}%
            <br />
            {BEST_WEIGHTS.reliability} × {(entry.reliability / 100).toFixed(2)} = {fmt1(b.reliabilityPoints)}
          </>}
        />
        <Part
          title="Activity"
          points={b.activityPoints}
          max={BEST_WEIGHTS.activity}
          color="var(--blue)"
          sentence={<>Completed <b>{entry.completed}</b> gigs; the month&apos;s busiest {role} completed {b.maxCompleted}.</>}
          math={<>
            log(1 + {entry.completed}) ÷ log(1 + {b.maxCompleted}) = {fmt2(b.activityShare)}
            <br />
            {BEST_WEIGHTS.activity} × {fmt2(b.activityShare)} = {fmt1(b.activityPoints)}
          </>}
        />
      </div>

      <div className="sb-footer">
        <div className="sb-total">
          {fmt1(b.ratingPoints)} + {fmt1(b.reliabilityPoints)} + {fmt1(b.activityPoints)} = {fmt1(total)} →
          <b> Score {entry.score}</b>
        </div>
        <div className="sb-checks">
          {checks.map(([label, ok]) => (
            <span key={label} className={ok ? "ok" : "no"}>
              {ok ? <Check size={11} /> : <X size={11} />} {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const SCORE_BREAKDOWN_CSS = `
  .sb-explainer {
    padding: 14px 16px; margin-bottom: 14px;
    background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-md);
    font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  }
  .sb-explainer-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
  .sb-explainer ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
  .sb-explainer b { color: var(--text-primary); }
  .sb-h { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-muted); margin-bottom: 6px; }
  .sb-note { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--text-muted); }

  .sb-detail { white-space: normal; }
  .sb-parts { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); }
  .sb-part { padding: 10px 12px; background: var(--bg-elevated); border-radius: var(--radius-sm); }
  .sb-part-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .sb-part-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; color: var(--text-muted); }
  .sb-part-pts { font-size: 11px; color: var(--text-muted); font-family: 'Space Mono', monospace; }
  .sb-part-pts b { font-size: 14px; color: var(--text-primary); }
  .sb-bar { height: 4px; background: var(--bg-hover); border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
  .sb-bar > div { height: 100%; border-radius: 2px; }
  .sb-sentence { font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
  .sb-sentence b { color: var(--text-primary); }
  .sb-math {
    margin-top: 6px; font-size: 10.5px; line-height: 1.6; color: var(--text-muted);
    font-family: 'Space Mono', monospace;
  }
  .sb-footer {
    display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-top: 10px; font-size: 12px;
  }
  .sb-total { font-family: 'Space Mono', monospace; color: var(--text-secondary); }
  .sb-total b { color: var(--text-primary); }
  .sb-checks { display: flex; flex-wrap: wrap; gap: 6px; }
  .sb-checks span {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
  }
  .sb-checks .ok { color: var(--green); background: var(--green-dim); }
  .sb-checks .no { color: var(--red); background: var(--red-dim); }
`;
