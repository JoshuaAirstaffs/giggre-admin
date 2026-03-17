"use client";

import AdminLayout from "@/components/layout/AdminLayout";
import Button from "@/components/ui/button";
import { Save, KeyRound } from "lucide-react";

export default function ProfilePage() {
  return (
    <AdminLayout title="My Profile" subtitle="View and edit your admin account">
      <style>{`
        .profile-grid { display: grid; grid-template-columns: 280px 1fr; gap: 20px; align-items: start; }
        @media (max-width: 900px) { .profile-grid { grid-template-columns: 1fr; } }
        .profile-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 28px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          text-align: center;
        }
        .profile-avatar {
          width: 80px; height: 80px;
          background: linear-gradient(135deg, var(--blue), var(--purple));
          border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; font-weight: 700; color: white;
        }
        .profile-name { font-size: 17px; font-weight: 700; color: var(--text-primary); }
        .profile-role {
          font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: var(--blue); background: var(--blue-dim); padding: 4px 12px; border-radius: 20px;
        }
        .profile-email { font-size: 13px; color: var(--text-muted); }
        .profile-stat { font-size: 13px; color: var(--text-secondary); }
        .profile-stat strong { color: var(--text-primary); font-family: 'Space Mono', monospace; }
        .form-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
        }
        .form-title {
          font-size: 14px; font-weight: 700; color: var(--text-primary);
          margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border);
        }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
        .field-group { display: flex; flex-direction: column; gap: 7px; }
        .field-label { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
        .field-input {
          background: var(--bg-elevated); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 9px 12px;
          color: var(--text-primary); font-size: 13px; outline: none; font-family: inherit;
          transition: border-color 0.2s;
        }
        .field-input:focus { border-color: var(--blue); }
        .form-actions { display: flex; justify-content: flex-end; margin-top: 20px; }
      `}</style>

      <div className="profile-grid">
        <div className="profile-card">
          <div className="profile-avatar">SA</div>
          <div>
            <div className="profile-name">Super Admin</div>
            <div className="profile-role" style={{ display: "inline-block", marginTop: 6 }}>SUPERADMIN</div>
          </div>
          <div className="profile-email">superadmin@giggre.com</div>
          <div className="profile-stat">Gigs monitored: <strong>51</strong></div>
          <div className="profile-stat">Account since: <strong>Jan 2026</strong></div>
          <Button variant="secondary" size="sm" icon={KeyRound}>Change Password</Button>
        </div>

        <div>
          <div className="form-card">
            <div className="form-title">Personal Information</div>
            <div className="form-grid">
              <div className="field-group">
                <label className="field-label">First Name</label>
                <input className="field-input" defaultValue="Super" />
              </div>
              <div className="field-group">
                <label className="field-label">Last Name</label>
                <input className="field-input" defaultValue="Admin" />
              </div>
              <div className="field-group" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label">Email Address</label>
                <input className="field-input" defaultValue="superadmin@giggre.com" type="email" />
              </div>
              <div className="field-group">
                <label className="field-label">Phone</label>
                <input className="field-input" defaultValue="+63 912 345 6789" />
              </div>
              <div className="field-group">
                <label className="field-label">Role</label>
                <input className="field-input" defaultValue="Super Admin" readOnly style={{ opacity: 0.6 }} />
              </div>
            </div>
            <div className="form-actions">
              <Button variant="primary" size="sm" icon={Save}>Save Profile</Button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
