export const GP_STYLES = `
  .gp-tabs { display: flex; gap: 2px; padding: 4px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow-x: auto; scrollbar-width: none; margin-bottom: 18px; }
  .gp-tabs::-webkit-scrollbar { display: none; }
  .gp-tab { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-muted); font-size: 12.5px; font-weight: 500; font-family: inherit; cursor: pointer; white-space: nowrap; }
  .gp-tab:hover { color: var(--text-primary); }
  .gp-tab.active { background: var(--bg-surface); color: var(--text-primary); border-color: var(--border); font-weight: 600; }
  .gp-count { min-width: 18px; padding: 0 5px; height: 18px; border-radius: 9px; background: var(--red); color: #fff; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

  .gp-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
  .gp-card.err { border-color: var(--red); }
  .gp-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); margin-bottom: 18px; }
  .gp-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
  .gp-hint { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; line-height: 1.45; }
  .gp-label { font-size: 12px; color: var(--text-secondary); display: block; margin-bottom: 4px; }
  .gp-input, .gp-textarea, .gp-select {
    width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; font-family: inherit;
    color: var(--text-primary); background: var(--bg-elevated); border: 1px solid var(--border);
    border-radius: var(--radius-sm); outline: none;
  }
  .gp-textarea { resize: vertical; min-height: 64px; }
  .gp-input:focus, .gp-textarea:focus, .gp-select:focus { border-color: var(--blue); }
  .gp-input:disabled, .gp-textarea:disabled { opacity: 0.6; }
  .gp-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  @media (max-width: 520px) { .gp-row { grid-template-columns: 1fr; } }
  .gp-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; }
  .gp-error { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: var(--red); }
  .gp-warn { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: var(--amber); }
  .gp-bar { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .gp-bar-text { font-size: 12px; color: var(--text-muted); }
  .gp-bar-actions { display: flex; gap: 8px; }
  .gp-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; user-select: none; }
  .gp-switch input { width: 34px; height: 18px; appearance: none; background: var(--border); border-radius: 9px; position: relative; cursor: pointer; transition: background .15s; margin: 0; }
  .gp-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: left .15s; }
  .gp-switch input:checked { background: var(--green); }
  .gp-switch input:checked::after { left: 18px; }
  .gp-switch input:disabled { opacity: .5; cursor: default; }
  .gp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .gp-big { font-size: 20px; font-family: 'Space Mono', monospace; color: var(--green); font-weight: 700; text-align: right; }
  .gp-big small { display: block; font-size: 10px; color: var(--text-muted); font-family: inherit; text-transform: uppercase; letter-spacing: .4px; font-weight: 600; }
  .gp-readonly { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--text-muted); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 14px; }

  .gp-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
  .gp-chip { padding: 5px 12px; font-size: 12px; font-family: inherit; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; }
  .gp-chip.active { background: var(--blue-dim); color: var(--blue); border-color: var(--blue); font-weight: 600; }
  .gp-spacer { flex: 1; }
  .gp-table-wrap { overflow-x: auto; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .gp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 860px; }
  .gp-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--text-muted); font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg-elevated); }
  .gp-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: top; }
  .gp-table tr:last-child td { border-bottom: none; }
  .gp-sub { font-size: 11px; color: var(--text-muted); }
  .gp-pts { font-family: 'Space Mono', monospace; font-weight: 700; white-space: nowrap; }
  .gp-pts.plus { color: var(--green); } .gp-pts.minus { color: var(--amber); }
  .gp-actions { display: flex; gap: 6px; justify-content: flex-end; }
  .gp-empty { padding: 40px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .gp-summary { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 13px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; }
  .gp-summary dt { color: var(--text-muted); }
  .gp-summary dd { margin: 0; color: var(--text-primary); font-weight: 500; word-break: break-word; }
  .gp-user { display: flex; gap: 12px; align-items: center; padding: 12px 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  .gp-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; background: var(--blue-dim); color: var(--blue); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
  .gp-stats { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--text-muted); }
  .gp-stats b { color: var(--text-primary); font-family: 'Space Mono', monospace; }
  .gp-seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
  .gp-seg button { padding: 7px 14px; font-size: 12.5px; font-family: inherit; border: none; background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; border-right: 1px solid var(--border); }
  .gp-seg button:last-child { border-right: none; }
  .gp-seg button.active { background: var(--blue); color: #fff; font-weight: 600; }
  .gp-search { display: flex; gap: 8px; }
`;
