import { buildDossierHtml } from "../LiveOpsPage";

jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));

const emptyChannel = { min: 0, max: 0, avg: 0, count: 0 };

describe("buildDossierHtml", () => {
  test("escapes user-controlled dossier strings", () => {
    const injected = '<img src=x onerror="alert(1)">';
    const dossier = {
      generated_at: injected,
      generated_by: injected,
      window: { start: injected, end: injected },
      sample_count: 0,
      vm_alert_count: 1,
      job_header: {
        crew_lead: injected,
        fatigue_worst: 0,
        active_reel: { name: injected, total_length_ft: 1000, intervals: [{ grade: injected }] },
      },
      pump_schedule: [{ treatment: injected, started_at: injected, entries: 1 }],
      recorded_channels: {
        weight_lb: emptyChannel,
        p_internal_psi: emptyChannel,
        p_external_psi: emptyChannel,
        traction_pressure_psi: emptyChannel,
        axial_force_lbf: emptyChannel,
        depth_ft: emptyChannel,
      },
      vm_alerts: [{ ts: injected, vm: 1, pct_of_safe: 10 }],
      fatigue_delta: { worst_damage_now: 0, node_count: 0 },
      crew_hours: [{
        user_name: injected, hours: 1, pay_code: injected,
        job_number: injected, description: injected,
      }],
    };

    const html = buildDossierHtml(dossier);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain(injected);
  });
});
