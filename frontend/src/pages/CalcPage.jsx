import React from "react";
import { Link } from "react-router-dom";
import { useActiveJobSelection } from "../context/ActiveJobContext";
import { useAuth } from "../context/AuthContext";
import { useTier } from "../context/TierContext";
import { filterTools, getTool } from "../config/toolRegistry";
import { ToolCard } from "./Hub";

export default function CalcPage() {
  const job = useActiveJobSelection();
  const { user } = useAuth();
  const tier = useTier();
  const tools = filterTools({ user, ...tier }).filter((tool) => tool.category === "engineering" && tool.id !== "workbook");
  return (
    <div className="job-page" data-testid="calc-home">
      <h1 className="text-xl font-bold">Workbook & engineering</h1>
      <section className="job-card">
        <h2 className="font-bold">{job.well.name || "Active job"} / Run {job.runNumber}</h2>
        <p className="job-muted mt-2">Reel: {job.activeReel?.name || "not selected"}. Tools inherit this job and capture available inputs when opened. Review simulated or held values before use.</p>
      </section>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>
      <Link to={getTool("workbook").route} className="job-primary">Open Workbook</Link>
      <p className="job-muted">Calculations and SI/IMP conversions are unchanged. Saved inputs and explicit entries take precedence over job prefills.</p>
    </div>
  );
}
