import { LucideIcon } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
  loading?: boolean;
  children?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  ghost: "btn-ghost",
  success: "btn-success",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
};

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <>
      <style>{`
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: 'DM Sans', sans-serif;
          font-weight: 600;
          border-radius: var(--radius-sm);
          transition: all 0.15s;
          white-space: nowrap;
          border: 1px solid transparent;
          cursor: pointer;
        }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-sm { font-size: 12px; padding: 6px 12px; }
        .btn-md { font-size: 13.5px; padding: 8px 16px; }
        .btn-lg { font-size: 15px; padding: 11px 22px; }
        .btn-primary {
          background: var(--blue);
          color: white;
          border-color: var(--blue);
        }
        .btn-primary:not(:disabled):hover {
          background: #2563EB;
          box-shadow: 0 4px 16px rgba(59,130,246,0.35);
          transform: translateY(-1px);
        }
        .btn-secondary {
          background: var(--bg-elevated);
          color: var(--text-secondary);
          border-color: var(--border);
        }
        .btn-secondary:not(:disabled):hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .btn-danger {
          background: var(--red-dim);
          color: var(--red);
          border-color: rgba(239,68,68,0.25);
        }
        .btn-danger:not(:disabled):hover {
          background: var(--red);
          color: white;
        }
        .btn-ghost {
          background: transparent;
          color: var(--text-secondary);
          border-color: transparent;
        }
        .btn-ghost:not(:disabled):hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }
        .btn-success {
          background: var(--green-dim);
          color: var(--green);
          border-color: rgba(16,185,129,0.25);
        }
        .btn-success:not(:disabled):hover {
          background: var(--green);
          color: white;
        }
        .btn-spin {
          animation: btn-spin-anim 0.8s linear infinite;
          display: inline-block;
        }
        @keyframes btn-spin-anim { to { transform: rotate(360deg); } }
      `}</style>
      <button
        className={`btn ${variantStyles[variant]} ${sizeStyles[size]}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <svg className="btn-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
          </svg>
        ) : Icon && iconPosition === "left" ? (
          <Icon size={size === "sm" ? 13 : size === "lg" ? 18 : 15} />
        ) : null}
        {children}
        {!loading && Icon && iconPosition === "right" && (
          <Icon size={size === "sm" ? 13 : size === "lg" ? 18 : 15} />
        )}
      </button>
    </>
  );
}
