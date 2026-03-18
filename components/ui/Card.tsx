import { LucideIcon } from "lucide-react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Card({ children, className = "", style }: CardProps) {
  return (
    <div
      className={`ui-card ${className}`}
      style={style}
    >
      <style>{`
        .ui-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
      `}</style>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  trend?: { value: number; label: string };
}

export function StatCard({ label, value, icon: Icon, color = "var(--blue)", trend }: StatCardProps) {
  const isPositive = trend && trend.value >= 0;

  return (
    <div className="stat-card">
      <style>{`
        .stat-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: box-shadow 0.2s, transform 0.2s;
        }
        .stat-card:hover {
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          transform: translateY(-2px);
        }
        .stat-card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .stat-card-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.3px;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .stat-card-value {
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          font-family: 'Space Mono', monospace;
        }
        .stat-card-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .stat-card-trend {
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .stat-card-trend.up { color: var(--green); }
        .stat-card-trend.down { color: var(--red); }
      `}</style>
      <div className="stat-card-top">
        <div>
          <div className="stat-card-label">{label}</div>
          <div className="stat-card-value">{value}</div>
        </div>
        <div
          className="stat-card-icon-wrap"
          style={{ backgroundColor: `${color}18` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
      </div>
      {trend && (
        <div className={`stat-card-trend ${isPositive ? "up" : "down"}`}>
          <span>{isPositive ? "↑" : "↓"} {Math.abs(trend.value)}%</span>
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{trend.label}</span>
        </div>
      )}
    </div>
  );
}
