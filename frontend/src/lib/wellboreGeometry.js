import { stationAt } from "./surveyInterp.js";

export function buildWellboreGeometry(stations) {
  if (!Array.isArray(stations) || stations.length < 2) {
    throw new Error("A well path needs at least two survey stations.");
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  stations.forEach((station, index) => {
    if (!["md_ft", "east_ft", "north_ft", "tvd_ft"].every((key) => Number.isFinite(station[key])) ||
        (index > 0 && station.md_ft <= stations[index - 1].md_ft)) {
      throw new Error("Survey coordinates must be finite and measured depths must increase.");
    }
    [station.east_ft, -station.tvd_ft, -station.north_ft].forEach((value, axis) => {
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    });
  });
  const span = Math.max(...max.map((value, axis) => value - min[axis]));
  if (span <= 0) throw new Error("The survey path has no spatial extent.");
  const scale = 30 / span;
  const origin = min.map((value, axis) => (value + max[axis]) / 2);
  const project = (station) => [station.east_ft, -station.tvd_ft, -station.north_ft]
    .map((value, axis) => (value - origin[axis]) * scale);
  const points = stations.map(project);
  const firstMD = stations[0].md_ft;
  const lastMD = stations[stations.length - 1].md_ft;
  const pointAt = (md) => project(stationAt(stations, md));
  const radius = Math.max(Math.hypot(...max.map((value, axis) => (value - min[axis]) * scale)) / 2, 1);
  const head = points[0], toe = points[points.length - 1];
  const dx = toe[0] - head[0], dz = toe[2] - head[2];
  const length = Math.hypot(dx, dz);
  const side = length > 1e-6 ? [-dz / length, 0, dx / length] : [0, 0, 1];
  return { points, project, pointAt, firstMD, lastMD, radius, floorY: (min[1] - origin[1]) * scale - 1.5, side };
}

const normalize = (vector) => {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

// Fit both axes of a perspective frustum, including each point's camera-relative depth.
export function fitWellboreCamera(points, direction, aspect, fov = 40, padding = 1.3) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Camera aspect ratio must be positive.");
  const back = normalize(direction);
  const upHint = Math.abs(back[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(upHint, back));
  const up = cross(back, right);
  const tanV = Math.tan(fov * Math.PI / 360);
  const tanH = tanV * aspect;
  const distance = Math.max(4, ...points.map((point) => dot(point, back) +
    padding * Math.max(Math.abs(dot(point, right)) / tanH, Math.abs(dot(point, up)) / tanV)));
  return { position: back.map((value) => value * distance), up, distance };
}

export function wellboreTicks(firstMD, lastMD, step) {
  if (!Number.isFinite(step) || step <= 0) throw new Error("Depth tick spacing must be positive.");
  if (!Number.isFinite(firstMD) || !Number.isFinite(lastMD) || lastMD <= firstMD) {
    throw new Error("Depth tick limits must be finite and increasing.");
  }
  const effectiveStep = Math.max(step, (lastMD - firstMD) / 12);
  const ticks = [];
  const start = Math.ceil(firstMD / effectiveStep) * effectiveStep;
  for (let index = 0; index <= 12; index++) {
    const md = start + index * effectiveStep;
    if (md > firstMD && md < lastMD && md !== ticks[ticks.length - 1]) ticks.push(md);
  }
  return ticks;
}

function demoStations() {
  const kickoff = 6357;
  const radius = 650;
  const buildEnd = kickoff + radius * Math.PI / 2;
  const depths = [...new Set([0, kickoff, buildEnd, 16404,
    ...Array.from({ length: 109 }, (_, index) => (index + 1) * 150)])].sort((a, b) => a - b);
  return depths.map((md) => {
    const angle = Math.min(Math.PI / 2, Math.max(0, (md - kickoff) / radius));
    return {
      md_ft: md,
      tvd_ft: md <= kickoff ? md : kickoff + radius * Math.sin(angle),
      east_ft: radius * (1 - Math.cos(angle)) + Math.max(0, md - buildEnd),
      north_ft: 0,
      inc_deg: angle * 180 / Math.PI,
      azi_deg: 90,
      dls_deg_per_100ft: md > kickoff && md <= buildEnd ? 100 * 180 / (Math.PI * radius) : 0,
    };
  });
}

export const DEMO_WELLBORE = {
  survey_id: "demo-wellbore",
  well_name: "Demo horizontal well",
  stations: demoStations(),
};
