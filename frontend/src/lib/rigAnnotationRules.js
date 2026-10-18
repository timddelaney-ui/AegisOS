// Rig-computer annotation rule evaluator (Phase 2 pathway).
// Runs client-side against the live sample stream. Fires at most once per
// rule per cooldown window so we don't flood the timeline. In production
// (Phase 2) the same evaluator will live inside the WITS 0 / Modbus /
// WITSML listeners server-side; this client-side pathway is a scaffold
// for approval and tuning against company data before go-live.

const COOLDOWN_MS = 10_000; // one annotation per rule per 10 s

const _lastFired = new Map(); // rule_id -> epoch ms of last fire

export function resetRuleCooldowns() { _lastFired.clear(); }

/**
 * @param {object} sample          current telemetry sample (keys match server schema)
 * @param {Array}  rules           array of rule objects {rule_id, channel, op, threshold, severity, note, enabled}
 * @param {number} sampleTs        epoch ms for the sample (defaults to now)
 * @returns {Array<object>}        annotations to POST to /liveops/annotations/ingest
 */
export function evaluateRules(sample, rules, sampleTs = Date.now()) {
  if (!sample || !rules?.length) return [];
  const out = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (!r.channel || !r.op || r.threshold == null) continue;
    const v = sample[r.channel];
    if (v == null || !Number.isFinite(Number(v))) continue;
    const last = _lastFired.get(r.rule_id) || 0;
    if (sampleTs - last < COOLDOWN_MS) continue;
    const breached =
      (r.op === ">" && Number(v) > r.threshold) ||
      (r.op === "<" && Number(v) < r.threshold);
    if (!breached) continue;
    _lastFired.set(r.rule_id, sampleTs);
    out.push({
      timestamp_ms: sampleTs,
      note: `${r.note} · ${r.channel}=${Number(v).toFixed(1)} (${r.op} ${r.threshold})`,
      severity: r.severity || "warn",
      rule_id: r.rule_id,
      channel: r.channel,
      value: Number(v),
      depth_ft: sample.depth_ft ?? null,
    });
  }
  return out;
}
