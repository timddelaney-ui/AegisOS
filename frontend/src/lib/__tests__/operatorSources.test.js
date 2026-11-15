import { operatorValueSource } from "../operatorSources";
test("partial live samples never label retained simulation as live", () => {
  const feed = { feedMode: "LIVE", liveStale: false, lastLiveSample: { whp_psi: 0, weight_lb: 1200 } };
  expect(operatorValueSource(feed, "whp")).toBe("live DAQ");
  expect(operatorValueSource(feed, "weight")).toBe("live DAQ");
  expect(operatorValueSource(feed, "vonMises")).toContain("retained");
  expect(operatorValueSource(feed, "n2Rate")).toContain("no live channel");
  expect(operatorValueSource({ ...feed, feedMode: "STANDBY" }, "whp")).toContain("held");
  expect(operatorValueSource({ ...feed, liveStale: true }, "whp")).toContain("stale");
});
test("startup and simulation sources remain explicit", () => {
  expect(operatorValueSource({ feedMode: "LIVE", liveStale: false, lastLiveSample: null }, "whp")).toContain("awaiting live");
  expect(operatorValueSource({ feedMode: "SIM", lastLiveSample: null }, "whp")).toBe("simulated");
});
