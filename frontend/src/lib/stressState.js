const STRESS_AXES = [
  { key: "sigma_h", label: "Hoop", axis: [1, 0, 0], color: "#60A5FA" },
  { key: "sigma_r", label: "Radial", axis: [0, 0, 1], color: "#22D3EE" },
  { key: "sigma_a", label: "Axial", axis: [0, 1, 0], color: "#F87171" },
];

export function getStressArrowData(stress) {
  const valid = STRESS_AXES
    .map((component) => ({ ...component, value: stress?.[component.key] }))
    .filter((component) => Number.isFinite(component.value));
  const maxMagnitude = Math.max(0, ...valid.map(({ value }) => Math.abs(value)));
  return valid.map((component) => ({
    ...component,
    sign: Math.sign(component.value),
    magnitudeRatio: maxMagnitude ? Math.abs(component.value) / maxMagnitude : 0,
  }));
}
