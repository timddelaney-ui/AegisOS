import { DEPTH_MIN_FT, DEPTH_MAX_FT } from "../../lib/operatorConfig";

const grid = (ctx, w, h, bg, alpha) => {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
};

const ratio = (ft) => (ft - DEPTH_MIN_FT) / (DEPTH_MAX_FT - DEPTH_MIN_FT);

export function drawTrajectory(ctx, w, h, { depthFt, colorMode, plugs, bitLabel }) {
  grid(ctx, w, h, "#080E1A", 0.04);
  const vertX = 140, vertY = 140, heelX = 240, heelY = 250;
  const plain = colorMode === "Plain";
  ctx.lineWidth = 6;
  ctx.strokeStyle = plain ? "#38BDF8" : "#10B981";
  ctx.beginPath(); ctx.moveTo(vertX, 20); ctx.lineTo(vertX, vertY); ctx.stroke();
  ctx.strokeStyle = plain ? "#38BDF8" : "#EF4444";
  ctx.beginPath(); ctx.moveTo(vertX, vertY); ctx.quadraticCurveTo(vertX, heelY, heelX, heelY); ctx.stroke();
  ctx.strokeStyle = plain ? "#38BDF8" : "#10B981";
  ctx.beginPath(); ctx.moveTo(heelX, heelY); ctx.lineTo(w - 60, heelY); ctx.stroke();

  plugs.forEach((p) => {
    const px = heelX + (w - 320) * ratio(p.start);
    ctx.fillStyle = "#A855F7";
    ctx.fillRect(px - 2, heelY - 14, 4, 28);
    ctx.fillStyle = "#94A3B8";
    ctx.font = "bold 10px monospace";
    ctx.fillText(p.id, px - 6, heelY - 18);
  });

  const bitX = heelX + (w - 320) * Math.max(Math.min(ratio(depthFt), 1), 0.05);
  ctx.fillStyle = "#F97316";
  ctx.shadowColor = "#F97316";
  ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(bitX, heelY, 8, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(15,23,42,0.95)";
  ctx.fillRect(bitX - 55, heelY + 14, 110, 22);
  ctx.strokeStyle = "#F97316";
  ctx.lineWidth = 1;
  ctx.strokeRect(bitX - 55, heelY + 14, 110, 22);
  ctx.fillStyle = "#F8FAFC";
  ctx.font = "bold 10px monospace";
  ctx.fillText(bitLabel, bitX - 50, heelY + 29);
}

// Ranges in canonical imperial
export const PENS = [
  { key: "depth", label: "Depth", min: 0, max: 20000, color: "#F97316", cls: "orange" },
  { key: "weight", label: "Weight", min: 0, max: 11240, color: "#10B981", cls: "emerald" },
  { key: "whp", label: "WHP", min: 0, max: 8700, color: "#06B6D4", cls: "cyan" },
  { key: "treatingPress", label: "Treating", min: 0, max: 14500, color: "#EF4444", cls: "rose" },
  { key: "ccl", label: "CCL Wave", min: -200, max: 200, color: "#3B82F6", cls: "blue" },
  { key: "dhTorque", label: "Torque", min: 0, max: 1844, color: "#A855F7", cls: "purple" },
];

export function drawPens(ctx, w, h, data, activePens) {
  grid(ctx, w, h, "#070C14", 0.05);
  if (data.length < 2) return;
  PENS.forEach(({ key, min, max, color }) => {
    if (!activePens[key]) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    data.forEach((pt, i) => {
      const x = (i / 100) * w;
      const y = h - (((pt[key] - min) / (max - min || 1)) * (h - 30) + 15);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  });
}
