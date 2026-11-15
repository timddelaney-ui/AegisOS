import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { useActiveJob } from "../context/ActiveJobContext";
import { JOB_PHASES } from "../lib/activeJob";
import { filterTools, getTool } from "../config/toolRegistry";
import { useCachedApi } from "../hooks/useCachedApi";
import { ToolCard, useToolActions } from "./Hub";
import { HubCustomizeButton } from "../components/HubCustomize";
import AIPanel from "../components/AIPanel";

export default function MorePage() {
  const { user } = useAuth();
  const tier = useTier();
  const { phase } = useActiveJob();
  const [selectedPhase, setSelectedPhase] = useState(null);
  const [query, setQuery] = useState("");
  const { aiOpen, onAction, closeAI } = useToolActions();
  const prefs = useCachedApi("/me/prefs");
  const chosenPhase = selectedPhase || phase;
  const SafetyIcon = getTool("emergency").icon;
  const tiles = prefs.data?.hub_tiles || [];
  const tools = filterTools({ query, phase: chosenPhase, user, ...tier,
    hidden: tiles.filter((tile) => tile.visible === false).map((tile) => tile.id) })
    .filter((tool) => !tool.pinned)
    .sort((a, b) => (tiles.find((tile) => tile.id === a.id)?.order ?? 999) - (tiles.find((tile) => tile.id === b.id)?.order ?? 999));
  return (
    <div className="job-page" data-testid="more-tools">
      <div className="flex items-center justify-between gap-2"><h1 className="text-xl font-bold">All tools</h1><HubCustomizeButton onApply={prefs.refresh} /></div>
      <Link to={getTool("emergency").route} className="job-safety-card"><SafetyIcon size={20} /><strong>Emergency SOPs</strong><span>Pinned / one tap</span></Link>
      <label className="text-sm">Search tools<input type="search" className="job-input w-full mt-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tool name or category" /></label>
      <div className="job-tool-filters" aria-label="Filter tools by phase">
        {[{ id: "all", title: "All" }, ...JOB_PHASES].map((item) => <button key={item.id} className="job-secondary" aria-pressed={chosenPhase === item.id} onClick={() => setSelectedPhase(item.id)}>{item.title}</button>)}
      </div>
      <p className="job-muted">{tools.length} tools / {prefs.status === "cached" ? "Cached preferences" : "Your role and plan"}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tools.map((tool) => <ToolCard key={tool.id} tool={tool} onAction={onAction} />)}
      </div>
      {!tools.length && <p role="status">No tools match. Clear your search or select All phases.</p>}
      <Link to="/job" className="job-primary">Continue active job</Link>
      <AIPanel open={aiOpen} onClose={closeAI} mode="training" />
    </div>
  );
}
