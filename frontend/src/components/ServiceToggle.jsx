import React, { useEffect, useState } from "react";
import axios from "axios";
import { Layers, Check } from "lucide-react";
import { API, useAuth } from "../context/AuthContext";
import { SERVICES } from "../lib/serviceCatalog";

const STORAGE_KEY = "ctp_service_view_v1";

const readLocal = () => {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
};
const writeLocal = (v) => { try { localStorage.setItem(STORAGE_KEY, v); } catch {} };

export const useServiceView = () => {
  const { user, setUser } = useAuth();
  const [service, setServiceState] = useState(() => user?.service_view || readLocal() || "all");

  useEffect(() => {
    if (user?.service_view && user.service_view !== service) setServiceState(user.service_view);
    // eslint-disable-next-line
  }, [user?.service_view]);

  const setService = async (id) => {
    setServiceState(id);
    writeLocal(id);
    if (user) {
      try {
        const { data } = await axios.patch(`${API}/users/me`, { service_view: id }, { withCredentials: true });
        setUser && setUser(data);
      } catch { /* offline — local still wins */ }
    }
  };

  return { service, setService };
};

/**
 * ServiceToggle — pill selector for the current service view (Coil Tubing / Stand-Alone Frac / Coil Tools / All).
 * Persists to backend (user.service_view) and localStorage.
 */
const ServiceToggle = ({ compact = false }) => {
  const { service, setService } = useServiceView();
  return (
    <div
      data-testid="service-toggle"
      className={`flex items-center gap-1 bg-[#1E1E1E] text-white ${compact ? "px-2 py-1" : "px-2 py-1.5"} border-b border-[#333]`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-[#9CA3AF] mr-1">
        <Layers className="w-3 h-3" strokeWidth={2.5} />
        <span>Service</span>
      </div>
      <div className="flex gap-1 flex-1 overflow-x-auto">
        {SERVICES.map((s) => {
          const active = service === s.id;
          return (
            <button
              key={s.id}
              data-testid={`service-btn-${s.id}`}
              onClick={() => setService(s.id)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded whitespace-nowrap transition-colors flex items-center gap-1`}
              style={active ? { background: s.accent, color: "white" } : { color: "#9CA3AF" }}
            >
              {active && <Check className="w-3 h-3" strokeWidth={3} />}
              {s.short}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ServiceToggle;
