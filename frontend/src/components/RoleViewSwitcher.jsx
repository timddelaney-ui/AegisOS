import React from "react";
import { api } from "../api/client";
import { API, useAuth } from "../context/AuthContext";
import { TIERS, TIER_LABEL, canSwitchRoleView, setRoleView, tierRole, useRoleView } from "../lib/roles";

/** Test Role View: client-side effective-role override (management or beta test mode only). */
export default function RoleViewSwitcher() {
  const { user } = useAuth();
  useRoleView();
  if (!canSwitchRoleView(user)) return null;
  const active = tierRole(user);
  const change = (event) => {
    const role = event.target.value;
    setRoleView(role);
    // The server call records the switch in the audit chain; the response token is deliberately
    // not adopted so the real session stays intact. Failure is ignored.
    Promise.resolve(api.post(`${API}/auth/test-role-view`, { role }, { _skipAuthHandling: true })).catch(() => {});
  };
  return (
    <span className="role-view-switcher" data-testid="role-view-switcher" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <label htmlFor="role-view-select" style={{ fontSize: 11 }}>Role view</label>
      <select id="role-view-select" aria-label="Test role view" value={active} onChange={change}>
        {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
      </select>
      <span data-testid="active-role-badge" style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#FF6B1A", color: "#fff" }}>{TIER_LABEL[active]}</span>
    </span>
  );
}
