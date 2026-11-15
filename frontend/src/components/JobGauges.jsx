import React, { memo } from "react";
import { useOperatorTelemetry } from "../context/OperatorTelemetryContext";
import { useOperatorUnits } from "./operator/useOperatorUnits";

export const JobGauge = memo(function JobGauge({ title, value, unit, source, testId }) {
  return (
    <div className="job-card job-gauge" data-testid={testId}>
      <h3>{title}</h3><strong>{value ?? "--"} <small>{unit}</small></strong>
      <p className="job-muted">{source}</p>
    </div>
  );
});

export default memo(function JobGauges() {
  const { telemetry, bitFt, sourceLabel } = useOperatorTelemetry();
  const units = useOperatorUnits();
  return (
    <div className="grid grid-cols-2 gap-2">
      <JobGauge title="Bit depth" value={bitFt === null ? "--" : units.show(bitFt, "depth", 1)} unit={units.label("depth")} source={sourceLabel} testId="job-bit-depth" />
      <JobGauge title="Von Mises" value={telemetry?.vonMises?.toFixed(1)} unit="%SMYS" source={sourceLabel} testId="job-von-mises" />
    </div>
  );
});
