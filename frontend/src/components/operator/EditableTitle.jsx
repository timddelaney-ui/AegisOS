import React, { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";

const inputCls = "flex-1 min-w-0 bg-slate-950 border border-orange-500 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-100 outline-none";

export function EditableTitle({ title, defaultTitle, renamed, onRename, testId }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);

  const begin = () => { setText(title); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t !== title) onRename(t === defaultTitle ? "" : t);
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  };
  const reset = (e) => { e.preventDefault(); setEditing(false); onRename(""); };
  const stop = (e) => e.stopPropagation();
  const hint = renamed ? "Renamed from " + defaultTitle + " - click to edit" : "Click to rename";

  if (editing) {
    return (
      <span className="flex items-center gap-1 min-w-0 flex-1">
        <input autoFocus value={text} maxLength={40} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} onPointerDown={stop}
          className={inputCls} data-testid={testId + "-title-input"} />
        {renamed ? (
          <button onMouseDown={reset} title={"Reset to " + defaultTitle} className="p-0.5 text-slate-400 hover:text-cyan-300" data-testid={testId + "-title-reset-btn"}>
            <RotateCcw className="w-3 h-3" />
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <button onClick={begin} title={hint} className="group/t flex items-center gap-1 min-w-0 text-left" data-testid={testId + "-title"}>
      <span className="text-slate-300 uppercase tracking-wider truncate">{title}</span>
      {renamed ? <span className="w-1 h-1 rounded-full bg-cyan-400 shrink-0" /> : null}
      <Pencil className="w-2.5 h-2.5 text-slate-500 opacity-0 group-hover/t:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}
