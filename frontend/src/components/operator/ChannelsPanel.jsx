import React from "react";
import { Plus, GripVertical } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChannelCard, levelOf } from "./OperatorCards";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const idOf = (c) => c.key || c.id;

function Sparkline({ values }) {
  if (values.length < 2) return <div className="h-5" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${18 - ((v - min) / span) * 14 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="w-full h-5">
      <polyline points={pts} fill="none" stroke="#22D3EE" strokeWidth="1.2" vectorEffect="non-scaling-stroke" opacity="0.85" />
    </svg>
  );
}

function SortableChannel({ id, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, position: "relative" };
  const handle = (
    <button ref={setActivatorNodeRef} {...attributes} {...listeners} title="Drag to reorder" style={{ touchAction: "none" }}
      className="p-2.5 -m-2 sm:p-0.5 sm:-ml-1 sm:m-0 rounded text-slate-500 hover:text-orange-400 cursor-grab active:cursor-grabbing touch-none shrink-0" data-testid={`channel-${id}-drag-handle`}>
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );
  return <div ref={setNodeRef} style={style} data-testid={`channel-slot-${id}`}>{children(handle, isDragging)}</div>;
}

// Rank visible cards by the team order; unknown ids keep catalogue order at the end
const ranked = (list, order) => {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (pos.get(idOf(a)) ?? 1e6 + list.indexOf(a)) - (pos.get(idOf(b)) ?? 1e6 + list.indexOf(b)));
};

export function ChannelsPanel({ channels, groups, activeSets, hidden, telemetry, history, u, sourceLabel, sourceFor, onToggleSet, onHide, onOpenAdd, teamCfg }) {
  const visible = ranked(channels.filter((c) => activeSets.includes(c.group) && !hidden.includes(idOf(c))), teamCfg.order);
  const alarms = visible.filter((c) => c.key && levelOf(telemetry[c.key], c.warn, c.crit) !== "ok").length;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = visible.map(idOf);
    const moved = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    // Splice the new visible sequence back into the full team order
    const full = ranked(channels, teamCfg.order).map(idOf);
    let k = 0;
    teamCfg.setOrder(full.map((id) => (ids.includes(id) ? moved[k++] : id)));
  };

  return (
    <div className="bg-[#0D1526] border border-slate-800 rounded-2xl p-4 space-y-3" data-testid="channels-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold tracking-wide text-slate-100">CHANNELS</h2>
          <span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${alarms ? "bg-rose-500/10 border-rose-500/40 text-rose-300" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"}`} data-testid="alarm-badge">
            {alarms ? `${alarms} ALARM${alarms > 1 ? "S" : ""}` : "NO ALARMS"}
          </span>
        </div>
        <button onClick={onOpenAdd} className="flex items-center gap-1 px-3 py-1 bg-orange-600 hover:bg-orange-500 transition-colors text-white rounded-lg text-xs font-semibold" data-testid="add-channel-btn">
          <Plus className="w-3.5 h-3.5" /> Add channel
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">Job set</span>
          <span className="text-[9px] font-mono text-slate-500">drag ⠿ to reorder · tap a name to rename · shared with crew</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          {groups.map((set) => {
            const on = activeSets.includes(set);
            return (
              <button key={set} onClick={() => onToggleSet(set)} aria-pressed={on}
                className={`px-3 py-1 rounded-lg border transition-colors whitespace-nowrap ${on ? "bg-orange-600 border-orange-500 text-white" : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"}`}
                data-testid={`job-set-${slug(set)}`}>{set}</button>
            );
          })}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs text-slate-500 py-3" data-testid="channels-empty">No channels on screen. Turn on a job set or use “Add channel”.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map(idOf)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="channel-grid">
              {visible.map((c) => {
                const id = idOf(c);
                const raw = c.key ? telemetry[c.key] : null;
                const custom = teamCfg.names[id];
                return (
                  <SortableChannel key={id} id={id}>
                    {(handle, dragging) => (
                      <ChannelCard testId={`channel-${id}`} title={custom || c.title} defaultTitle={c.title} renamed={!!custom}
                        onRename={(name) => teamCfg.rename(id, name)} dragHandle={handle} dragging={dragging} raw={raw}
                        value={u.show(raw, c.dim, c.dim === "n2_vol" ? 0 : undefined)} unit={u.label(c.dim)} tag={c.tag}
                        warn={c.warn} crit={c.crit} warnLabel={c.warn != null ? u.show(c.warn, c.dim) : null} critLabel={c.crit != null ? u.show(c.crit, c.dim) : null}
                        sourceLabel={c.key ? sourceFor?.(c.key) || sourceLabel : "no source tag"} onRemove={() => onHide(id)}
                        spark={<Sparkline values={c.key ? history.slice(-60).map((h) => u.val(h[c.key], c.dim) ?? 0) : []} />} />
                    )}
                  </SortableChannel>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
