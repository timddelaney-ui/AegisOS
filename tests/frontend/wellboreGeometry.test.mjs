import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule } from "node:vm";

const interpolation = new SourceTextModule(await readFile(new URL("../../frontend/src/lib/surveyInterp.js", import.meta.url), "utf8"));
const geometry = new SourceTextModule(await readFile(new URL("../../frontend/src/lib/wellboreGeometry.js", import.meta.url), "utf8"));
await geometry.link(() => interpolation);
await geometry.evaluate();
const { buildWellboreGeometry, fitWellboreCamera, wellboreTicks, DEMO_WELLBORE } = geometry.namespace;

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test("bit and plug positions use the same measured-depth interpolation as the well path", () => {
  const stations = [
    { md_ft: 100, tvd_ft: 100, east_ft: 0, north_ft: 0 },
    { md_ft: 200, tvd_ft: 200, east_ft: 0, north_ft: 0 },
    { md_ft: 1200, tvd_ft: 200, east_ft: 1000, north_ft: 0 },
  ];
  const geo = buildWellboreGeometry(stations);
  const halfway = geo.pointAt(700);
  halfway.forEach((value, axis) => close(value, (geo.points[1][axis] + geo.points[2][axis]) / 2));
  assert.deepEqual(geo.pointAt(-1), geo.points[0]);
  assert.deepEqual(geo.pointAt(2000), geo.points[2]);
});

test("fit keeps the complete well inside portrait and landscape camera frustums in every view", () => {
  const geo = buildWellboreGeometry(DEMO_WELLBORE.stations);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  for (const aspect of [0.45, 1, 2.5]) {
    for (const direction of [[1, 0.55, 1], geo.side, [0, 1, 0]]) {
      const fitted = fitWellboreCamera(geo.points, direction, aspect);
      const back = fitted.position.map((value) => value / fitted.distance);
      const right = cross(fitted.up, back);
      for (const point of geo.points) {
        const depth = fitted.distance - dot(point, back);
        assert.ok(depth > 0);
        assert.ok(Math.abs(dot(point, right)) < depth * Math.tan(20 * Math.PI / 180) * aspect);
        assert.ok(Math.abs(dot(point, fitted.up)) < depth * Math.tan(20 * Math.PI / 180));
      }
    }
  }
});

test("nonuniform station spacing does not displace measured-depth pins", () => {
  const geo = buildWellboreGeometry([
    { md_ft: 0, tvd_ft: 0, east_ft: 0, north_ft: 0 },
    { md_ft: 10, tvd_ft: 10, east_ft: 0, north_ft: 0 },
    { md_ft: 10000, tvd_ft: 10, east_ft: 9990, north_ft: 0 },
  ]);
  assert.deepEqual(geo.pointAt(10), geo.points[1]);
  close(geo.pointAt(5005)[0], (geo.points[1][0] + geo.points[2][0]) / 2);
});

test("invalid surveys and tick intervals fail explicitly; dense ticks stay bounded", () => {
  assert.throws(() => buildWellboreGeometry([]), /two survey/);
  assert.throws(() => buildWellboreGeometry([
    { md_ft: 0, tvd_ft: 0, east_ft: 0, north_ft: 0 },
    { md_ft: 0, tvd_ft: 100, east_ft: 0, north_ft: 0 },
  ]), /depths must increase/);
  assert.throws(() => wellboreTicks(0, 1000, 0), /positive/);
  assert.throws(() => wellboreTicks(0, Infinity, 100), /finite/);
  assert.ok(wellboreTicks(0, 100000, 1).length <= 12);
  assert.ok(wellboreTicks(1e16, 1e16 + 2, 0.01).length <= 12);
  assert.ok(wellboreTicks(500, 2000, 250).every((md) => md > 500 && md < 2000));
});
