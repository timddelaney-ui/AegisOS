import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ChevronRight } from "lucide-react";
import { useAuth, API, isProUser } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { filterTools, getTool, TOOL_CATEGORIES } from "../config/toolRegistry";
import { HubCustomizeButton } from "../components/HubCustomize";
import AIPanel from "../components/AIPanel";
import { getStateSync, setState } from "../lib/fieldStore";

function tileVisible(props, tier) {
  const tool = getTool(props.tileId);
  const feature = props.feature || tool?.feature;
  return !(props.tilePrefs?.hidden?.has(props.tileId) && !tool?.required) && !props.guestBlocked &&
    (!feature || tier.canAccess(feature) || !tier.hidesCompletely(feature));
}

export function HubModules({ children }) {
  const tier = useTier();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(new Set(["operations"]));
  const tiles = React.Children.toArray(children).filter((tile) => tileVisible(tile.props, tier));
  const search = query.trim().toLowerCase();
  const matches = tiles.filter(({ props }) => `${props.title} ${props.subtitle || ""} ${props.tileId}`.toLowerCase().includes(search));
  const toggleGroup = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div className="space-y-3" data-testid="hub-tiles-grid">
      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-[180px] text-sm">Find a tool
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools, jobs, safety..." className="job-input mt-1 w-full" />
        </label>
        <button type="button" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)} className="job-secondary">{showAll ? "Grouped view" : "All tools"}</button>
      </div>
      {search || showAll ? matches.length ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="hub-tool-results">{matches}</div>
        : <p role="status">No tools match your search. Try another name or clear the search.</p>
        : [...TOOL_CATEGORIES, { id: "other", title: "More tools" }].map((group) => {
          const members = tiles.filter((tile) => (getTool(tile.props.tileId)?.category || "other") === group.id);
          if (!members.length) return null;
          return (
            <section key={group.id} className="job-card">
              <h3><button type="button" aria-expanded={expanded.has(group.id)} aria-controls={`hub-group-${group.id}`} onClick={() => toggleGroup(group.id)} className="flex items-center gap-2 w-full text-left">
                <span className="flex-1">{group.title}</span><span>{members.length} tools</span><ChevronRight size={18} />
              </button></h3>
              <div id={`hub-group-${group.id}`} hidden={!expanded.has(group.id)}><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{members}</div></div>
            </section>
          );
        })}
    </div>
  );
}

export function ToolCard({ tool, onAction }) {
  const navigate = useNavigate();
  const tier = useTier();
  const locked = tool.feature && !tier.canAccess(tool.feature);
  const Icon = tool.icon;
  return (
    <button type="button" data-tile-id={tool.id} data-testid={`hub-${tool.id}-tile`} data-tier-locked={locked || undefined}
      className="job-tool-card" onClick={() => locked ? tier.promptUpgrade(tool.feature) : tool.route.startsWith("#") ? onAction?.(tool.id) : navigate(tool.route)}>
      <Icon size={22} aria-hidden="true" />
      <span className="flex-1"><strong>{tool.title}</strong><small>{locked ? "Upgrade required" : tool.badge || tool.category}</small></span>
      <ChevronRight size={18} />
    </button>
  );
}

export default function Hub() {
  const { user } = useAuth();
  const tier = useTier();
  const [prefs, setPrefs] = useState(() => getStateSync(`hub_prefs:${user?.user_id}`, { hub_tiles: [] }));
  const [aiOpen, setAiOpen] = useState(false);
  const loadPrefs = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/me/prefs`, { withCredentials: true });
      setPrefs(data);
      setState(`hub_prefs:${user?.user_id}`, data);
    } catch (error) { console.debug("[Tools] using cached preferences", error?.message); }
  }, [user?.user_id]);
  // Old home preferences no longer redirect away from the job-first home.
  useEffect(() => { loadPrefs(); }, [loadPrefs]);
  const onAction = (id) => {
    if (id === "training") setAiOpen(true);
    else document.dispatchEvent(new CustomEvent(id === "redeem" ? "open-redeem" : "open-feedback"));
  };
  const tiles = prefs.hub_tiles || [];
  const tools = filterTools({ user, hidden: tiles.filter((item) => item.visible === false).map((item) => item.id), ...tier })
    .filter((tool) => tool.legacyHub)
    .sort((a, b) => (tiles.find((item) => item.id === a.id)?.order ?? 999) - (tiles.find((item) => item.id === b.id)?.order ?? 999));
  return (
    <div className="job-page">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold">Your tools</h1><HubCustomizeButton onApply={loadPrefs} /></div>
      <HubModules>{tools.map((tool) => <ToolCard key={tool.id} tileId={tool.id} title={tool.title} tool={tool} onAction={onAction} />)}</HubModules>
      {!isProUser(user) && <p className="job-muted">Cheaper than a coffee - view plans for more tools.</p>}
      <AIPanel open={aiOpen} onClose={() => setAiOpen(false)} mode="training" />
    </div>
  );
}
