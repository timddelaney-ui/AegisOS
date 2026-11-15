import { createContext, useContext } from "react";

export const OperatorTelemetryContext = createContext({
  telemetry: null, sourceLabel: "no current feed", history: [], bitFt: null,
});
export const useOperatorTelemetry = () => useContext(OperatorTelemetryContext);
