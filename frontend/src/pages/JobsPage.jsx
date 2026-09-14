import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "../context/AuthContext";
import { ArrowLeft, Trash2, Users, User, Loader2, FileSpreadsheet } from "lucide-react";
import { workbookData } from "../mock/workbookData";

const JobsPage = ({ onLoadJob }) => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/jobs`, { withCredentials: true });
      setJobs(data);
    } catch (e) { setJobs([]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const deleteJob = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this saved job?")) return;
    await axios.delete(`${API}/jobs/${id}`, { withCredentials: true });
    load();
  };

  const openJob = (job) => {
    onLoadJob && onLoadJob(job);
    navigate("/app", { state: { loadJob: job } });
  };

  return (
    <div className="min-h-screen bg-[#F3F3F3] flex flex-col">
      <header className="bg-[#107C41] text-white h-12 flex items-center px-3 shadow-md flex-shrink-0">
        <button onClick={() => navigate("/app")} className="flex items-center gap-1.5 text-sm font-semibold">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-sm font-semibold ml-4">Saved Field Jobs</h1>
      </header>

      <div className="flex-1 p-4 overflow-auto">
        <div className="max-w-2xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#107C41]" /></div>
          ) : jobs.length === 0 ? (
            <div className="bg-white border border-[#D4D4D4] rounded-lg p-8 text-center">
              <FileSpreadsheet className="w-10 h-10 text-[#107C41] mx-auto mb-2" strokeWidth={1.5} />
              <h2 className="text-base font-bold text-[#262626] mb-1">No saved jobs yet</h2>
              <p className="text-sm text-[#595959] mb-4">Fill in a sheet, then tap Save to keep it here for next shift.</p>
              <button onClick={() => navigate("/app")} className="bg-[#107C41] hover:bg-[#0D6535] text-white px-4 py-2 rounded text-sm font-semibold">Open Workbook</button>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.job_id}
                  onClick={() => openJob(job)}
                  className="bg-white border border-[#D4D4D4] rounded p-3 hover:border-[#107C41] cursor-pointer transition-colors flex items-center gap-3 shadow-sm"
                >
                  <div className="w-10 h-10 rounded bg-[#E6F4EA] flex items-center justify-center flex-shrink-0">
                    <FileSpreadsheet className="w-5 h-5 text-[#107C41]" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#262626] truncate">{job.title}</p>
                    <p className="text-[11px] text-[#595959] truncate">
                      {workbookData[job.sheet_key]?.title || job.sheet_key} · {job.unit_system === "imp" ? "Imperial" : "Metric"} · {new Date(job.updated_at).toLocaleDateString()}
                    </p>
                    <p className="text-[10px] text-[#595959] flex items-center gap-1 mt-0.5">
                      {job.visibility === "team" ? <><Users className="w-3 h-3" /> Team · by {job.user_name}</> : <><User className="w-3 h-3" /> Private</>}
                    </p>
                  </div>
                  <button onClick={(e) => deleteJob(job.job_id, e)} className="text-[#C00000] hover:bg-[#FFF5F5] p-2 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default JobsPage;
