import { filterTools, getTool, toolForPath } from "../toolRegistry";

test("phase filtering keeps safety pinned and narrows operational tools", () => {
  const plan = filterTools({ phase: "plan", user: { role: "crew" } }).map((tool) => tool.id);
  expect(plan).toContain("emergency");
  expect(plan).not.toContain("live-ops");
  const run = filterTools({ phase: "run", user: { role: "crew" } }).map((tool) => tool.id);
  expect(run).toContain("live-ops");
  expect(run).not.toContain("certs");
});
test("search trims whitespace and cannot reveal role-hidden or tier-hidden tools", () => {
  expect(filterTools({ query: "  WELLBORE  " })).toEqual([getTool("wellbore")]);
  expect(filterTools({ query: "manager", user: { role: "crew" } })).not.toContain(getTool("manager"));
  expect(filterTools({ query: "manager", user: { role: "field_manager" } })).toContain(getTool("manager"));
  expect(filterTools({ query: "wellbore", canAccess: () => false, hidesCompletely: () => true })).toEqual([]);
  expect(filterTools({ query: "wellbore", canAccess: () => false, hidesCompletely: () => false })).toHaveLength(1);
  expect(filterTools({ query: "nothing matches" })).toEqual([]);
});
test("hidden preferences cannot remove emergency access; legacy routes resolve", () => {
  expect(filterTools({ hidden: ["emergency", "wellbore"] }).map((tool) => tool.id)).toContain("emergency");
  expect(filterTools({ hidden: ["wellbore"] }).map((tool) => tool.id)).not.toContain("wellbore");
  expect(toolForPath("/live-ops/classic")).toBe(getTool("live-ops"));
  expect(toolForPath("/erp-template/saved")).toBe(getTool("erp-template"));
  expect(getTool("team-hub").route).toBe("/team");
});
