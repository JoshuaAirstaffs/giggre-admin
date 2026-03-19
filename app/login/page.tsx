"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import Image from "next/image";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function LoginPage() {
  const router = useRouter();

  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/dashboard");
    }
  }, [user, authLoading, router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // ── Email/password login ───────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      let msg = "Something went wrong. Please try again.";
      switch (err.code) {
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential": msg = "Invalid email or password."; break;
        case "auth/too-many-requests":  msg = "Too many attempts. Please try again later."; break;
        case "auth/invalid-email":      msg = "Please enter a valid email address."; break;
        default: msg = err.message || msg;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth login ─────────────────────────────────────────────────────
  const handleGoogleLogin = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === "auth/popup-closed-by-user") return;
      if (err.code === "auth/popup-blocked") {
        setError("Popup was blocked. Please allow popups for this site.");
      } else {
        setError("Sign-in failed. Your account may not be authorized.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const isAnyLoading = loading || googleLoading;

  // ── Static data ───────────────────────────────────────────────────────────
  const features = [
    { label: "Manage Users & Workers", icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg> },
    { label: "Monitor Live Gigs",       icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg> },
    { label: "Live Worker Map",         icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg> },
    { label: "Reports & Analytics",     icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
  ];

  const mobilePills = [
    { label: "Users",    icon: <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg> },
    { label: "Gigs",     icon: <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg> },
    { label: "Live Map", icon: <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4" /></svg> },
    { label: "Support",  icon: <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" /></svg> },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap');

        .page {
          display: grid;
          grid-template-columns: 1fr 1fr;
          height: 100vh;
          width: 100vw;
          overflow: hidden;
        }

        /* ── LEFT PANEL ── */
        .left {
          background: var(--bg-left);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 64px 48px;
          position: relative;
          overflow: hidden;
          border-right: 1px solid var(--border);
        }
        .left::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 28px 28px;
          pointer-events: none;
        }
        .left::after {
          content: '';
          position: absolute;
          top: -100px; left: -100px;
          width: 420px; height: 420px;
          background: radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .left-glow-br {
          position: absolute;
          bottom: -60px; right: -60px;
          width: 280px; height: 280px;
          background: radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%);
          pointer-events: none;
        }
        .branding {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 40px;
          text-align: center;
          max-width: 380px;
          width: 100%;
        }
        .logo-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .logo-img {
          width: 180px; height: auto;
          filter: drop-shadow(0 4px 24px rgba(59,130,246,0.25));
          animation: floatLogo 4s ease-in-out infinite;
        }
        @keyframes floatLogo {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-6px); }
        }
        .console-badge {
          display: flex; align-items: center; gap: 8px;
          background: rgba(59,130,246,0.1);
          border: 1px solid rgba(59,130,246,0.25);
          border-radius: 999px;
          padding: 4px 14px;
          font-family: 'Space Mono', monospace;
          font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
          color: var(--blue);
        }
        .badge-dot {
          width: 6px; height: 6px;
          background: var(--blue); border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .features { display: flex; flex-direction: column; gap: 14px; width: 100%; }
        .feature {
          display: flex; align-items: center; gap: 14px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 12px 16px;
          font-size: 14px; font-weight: 500;
          color: var(--text-secondary);
          transition: border-color 0.2s, background 0.2s, color 0.2s;
        }
        .feature:hover {
          border-color: rgba(59,130,246,0.3);
          background: rgba(59,130,246,0.04);
          color: var(--text-primary);
        }
        .feature-icon {
          width: 32px; height: 32px;
          background: rgba(59,130,246,0.12);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; color: var(--blue);
        }

        /* ── RIGHT PANEL ── */
        .right {
          background: var(--bg-base);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 64px 48px;
          position: relative;
        }
        .right::before {
          content: '';
          position: absolute;
          bottom: -80px; right: -80px;
          width: 380px; height: 380px;
          background: radial-gradient(circle, rgba(249,115,22,0.06) 0%, transparent 70%);
          pointer-events: none;
        }
        .form-wrap {
          position: relative; z-index: 1;
          width: 100%; max-width: 400px;
        }
        .form-head { margin-bottom: 32px; }
        .form-head h2 {
          font-family: 'Space Mono', monospace;
          font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
          color: var(--text-primary); margin-bottom: 6px;
        }
        .form-head p { font-size: 14px; color: var(--text-secondary); }
        .card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 36px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.5);
        }
        .form-fields { display: flex; flex-direction: column; gap: 20px; }

        /* ── Google button ── */
        .google-btn {
          width: 100%;
          padding: 11px;
          background: var(--bg-elevated);
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          transition: background 0.2s, border-color 0.2s, transform 0.15s, box-shadow 0.2s;
          letter-spacing: 0.2px;
        }
        .google-btn:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: rgba(59,130,246,0.4);
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        }
        .google-btn:active:not(:disabled) { transform: translateY(0); }
        .google-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Divider ── */
        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 500;
        }
        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        /* ── Form fields ── */
        .err-box {
          background: var(--red-dim);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: var(--radius-sm);
          padding: 12px 14px;
          display: flex; gap: 10px; align-items: flex-start;
          color: #FCA5A5; font-size: 13px;
        }
        .err-box svg { flex-shrink: 0; margin-top: 1px; }
        .field-label {
          display: block; font-size: 11px; font-weight: 600;
          letter-spacing: 0.8px; text-transform: uppercase;
          color: var(--text-secondary); margin-bottom: 8px;
        }
        .input-wrap { position: relative; }
        .input-icon {
          position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
          color: var(--text-muted); display: flex; pointer-events: none;
        }
        .field-input {
          width: 100%; background: var(--bg-elevated);
          border: 1px solid var(--border); border-radius: var(--radius-sm);
          padding: 12px 42px; color: var(--text-primary);
          font-size: 14px; font-family: 'DM Sans', sans-serif;
          outline: none; transition: border-color 0.2s, box-shadow 0.2s;
        }
        .field-input::placeholder { color: var(--text-muted); }
        .field-input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
        .field-input:disabled { opacity: 0.5; cursor: not-allowed; }
        .toggle-pw {
          position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
          color: var(--text-muted); display: flex; cursor: pointer;
          background: none; border: none; padding: 2px; transition: color 0.2s;
        }
        .toggle-pw:hover { color: var(--text-secondary); }
        .forgot-row { text-align: right; margin-top: -8px; }
        .forgot-row a { font-size: 12px; font-weight: 500; color: var(--blue); text-decoration: none; }
        .forgot-row a:hover { opacity: 0.8; }
        .submit-btn {
          width: 100%; padding: 13px;
          background: var(--blue); color: #fff;
          border: none; border-radius: var(--radius-sm);
          font-size: 14px; font-weight: 600; font-family: 'DM Sans', sans-serif;
          cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s; letter-spacing: 0.3px;
        }
        .submit-btn:hover:not(:disabled) {
          background: #2563EB;
          transform: translateY(-1px);
          box-shadow: 0 8px 28px rgba(59,130,246,0.35);
        }
        .submit-btn:active:not(:disabled) { transform: translateY(0); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .footer-note { text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 24px; }
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Mobile ── */
        .mobile-branding {
          display: none; flex-direction: column; align-items: center;
          gap: 16px; padding: 32px 24px 0; text-align: center;
        }
        .mobile-logo-img { width: 140px; height: auto; }
        .mobile-nav { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
        .mobile-pill {
          display: flex; align-items: center; gap: 6px;
          background: rgba(255,255,255,0.05); border: 1px solid var(--border);
          border-radius: 999px; padding: 6px 14px;
          font-size: 12px; font-weight: 500; color: var(--text-secondary);
        }
        .mobile-pill svg { color: var(--blue); }

        @media (max-width: 1024px) {
          .left  { padding: 48px 32px; }
          .right { padding: 48px 32px; }
          .logo-img { width: 150px; }
        }
        @media (max-width: 768px) {
          .page { grid-template-columns: 1fr; height: auto; min-height: 100vh; overflow: visible; }
          html, body { overflow: auto; }
          .left { display: none; }
          .right { padding: 0 0 40px; align-items: stretch; justify-content: flex-start; overflow: hidden; }
          .mobile-branding { display: flex; }
          .form-wrap { max-width: 100%; padding: 0 20px; margin-top: 24px; }
          .card { padding: 28px 24px; }
          .form-head h2 { font-size: 22px; }
        }
        @media (max-width: 400px) {
          .card { padding: 22px 18px; border-radius: var(--radius-lg); }
        }
      `}</style>

      <div className="page">

        {/* LEFT */}
        <aside className="left">
          <div className="left-glow-br" />
          <div className="branding">
            <div className="logo-wrap">
              <Image
                className="logo-img"
                src="/images/logo.png"
                alt="Giggre"
                width={180}
                height={60}
                onError={(e) => {
                  const t = e.currentTarget;
                  t.style.display = "none";
                  (t.nextElementSibling as HTMLElement)!.style.display = "flex";
                }}
              />
              <div style={{ display:"none", alignItems:"center", gap:10 }}>
                <div style={{ width:52,height:52,background:"linear-gradient(135deg,#3B82F6,#F97316)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:22,color:"#fff" }}>G</div>
                <div style={{ fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:26 }}>
                  <span style={{ color:"#3B82F6" }}>gigg</span><span style={{ color:"#F97316" }}>re</span>
                </div>
              </div>
              <div className="console-badge"><span className="badge-dot" />Admin Console</div>
            </div>
            <div className="features">
              {features.map((f, i) => (
                <div className="feature" key={i}>
                  <div className="feature-icon">{f.icon}</div>
                  {f.label}
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* RIGHT */}
        <main className="right">
          <div className="mobile-branding">
            <Image
              className="logo-img"
              src="/images/logo.png"
              alt="Giggre"
              width={180}
              height={60}
              onError={(e) => {
                const t = e.currentTarget;
                t.style.display = "none";
                (t.nextElementSibling as HTMLElement)!.style.display = "flex";
              }}
            />
            <div style={{ display:"none",fontFamily:"'Space Mono',monospace",fontWeight:700,fontSize:22 }}>
              <span style={{ color:"#3B82F6" }}>gigg</span><span style={{ color:"#F97316" }}>re</span>
            </div>
            <nav className="mobile-nav">
              {mobilePills.map((p, i) => (
                <div className="mobile-pill" key={i}>{p.icon}{p.label}</div>
              ))}
            </nav>
          </div>

          <div className="form-wrap">
            <div className="form-head">
              <h2>Welcome back</h2>
              <p>Sign in to your admin account</p>
            </div>

            <div className="card">
              <div className="form-fields">

                {/* Error box */}
                {error && (
                  <div className="err-box">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    {error}
                  </div>
                )}

                {/* ── Google sign-in ── */}
                <button
                  type="button"
                  className="google-btn"
                  onClick={handleGoogleLogin}
                  disabled={isAnyLoading}
                >
                  {googleLoading ? (
                    <svg className="spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
                    </svg>
                  ) : (
                    /* Official Google "G" logo SVG — required by Google's brand guidelines */
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                  )}
                  {googleLoading ? "Signing in…" : "Continue with Google"}
                </button>

                {/* ── Divider ── */}
                <div className="divider">or sign in with email</div>

                {/* ── Email field ── */}
                <div>
                  <label className="field-label">Email Address</label>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    </span>
                    <input className="field-input" type="email" required value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@giggre.com" disabled={isAnyLoading} />
                  </div>
                </div>

                {/* ── Password field ── */}
                <div>
                  <label className="field-label">Password</label>
                  <div className="input-wrap">
                    <span className="input-icon">
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </span>
                    <input className="field-input" type={showPassword ? "text" : "password"}
                      required value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••" disabled={isAnyLoading} />
                    <button type="button" className="toggle-pw"
                      onClick={() => setShowPassword(!showPassword)} disabled={isAnyLoading}>
                      {showPassword ? (
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* ── Submit ── */}
                <form onSubmit={handleLogin}>
                  <button type="submit" className="submit-btn" disabled={isAnyLoading}>
                    {loading ? (
                      <>
                        <svg className="spin" width="16" height="16" fill="none" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
                        </svg>
                        Signing in…
                      </>
                    ) : "Sign In with Email"}
                  </button>
                </form>

              </div>
            </div>

            <p className="footer-note">© 2026 Giggre. All rights reserved.</p>
          </div>
        </main>
        <div className="fixed bottom-4 right-4 z-50 bg-white dark:bg-gray-800 p-3 rounded-full shadow-lg hover:scale-105 transition-transform">
          <ThemeToggle />
        </div>
      </div>
    </>
  );
}