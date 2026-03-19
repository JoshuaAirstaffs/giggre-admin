"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export default function ThemeToggle() {
  const { isDark, toggleTheme, theme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle"
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      <style>{`
        .theme-toggle {
          width: 34px;
          height: 34px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          transition: all 0.15s;
          cursor: pointer;
          flex-shrink: 0;
          position: relative;
          overflow: hidden;
        }
        .theme-toggle:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
        }
        .theme-icon {
          position: absolute;
          transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s;
        }
        .theme-icon-sun  { transform: ${!isDark  ? "translateY(0) rotate(0deg)"   : "translateY(20px) rotate(90deg)"}; opacity: ${!isDark  ? 1 : 0}; }
        .theme-icon-moon { transform: ${isDark ? "translateY(0) rotate(0deg)"   : "translateY(20px) rotate(-90deg)"}; opacity: ${isDark ? 1 : 0}; }
      `}</style>

      <span className="theme-icon theme-icon-moon">
        <Moon size={15} />
      </span>
      <span className="theme-icon theme-icon-sun">
        <Sun size={15} />
      </span>
    </button>
  );
}
