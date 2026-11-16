# Golden Job demo pack ("Aegis Golden 14H")

Five-act field demo: a horizontal CT well, KOP 7,000 ft, heel 7,900 ft, TD 16,400 ft MD.

| Act | What happens |
|-----|--------------|
| 1 | RIH 0 → 6,800 ft; Acid, FR Slug, MMFR Slugs, Gel Pills, Water Flush all pump |
| 2 | KOP / heel crossing with multiple slugs (MMFR ×2, gel pill, FR, flush) |
| 3 | Encoder 3 slips to 2.6 ft (> 2.0 ft threshold): `edge_gateway/consensus.py` raises a drift alert, then recovers after re-zero |
| 4 | TD at 8,800 psi / 81.4% Von Mises; Starlink drops, rows queue in the SQLite store as historical; on restore `edge_gateway/replay.py` bursts them (batched, acked) and a forced second replay is deduplicated |
| 5 | POOH, then shift handover via `POST /api/handovers/send` (HITL-gated) |

## Assets
- `edge_gateway/config/golden_job_survey.csv` – MD/Inc/Az/TVD/N/E/DLS survey (min-curvature), rows tagged KOP / HEEL / TD.
- `edge_gateway/config/tag_map.golden_job.yaml` – tag map (loadable with `edge_gateway.adapters.tag_map.load_tag_map`).
- `backend/scripts/golden_job_replay.py` – the 5-act replay.
- `backend/routes/demo.py` – `POST /api/demo/golden-job/seed`.

## Run the replay
```bash
python backend/scripts/golden_job_replay.py --dry-run            # offline, instant, deterministic
python backend/scripts/golden_job_replay.py --dry-run --json     # full act detail incl. handover payload
python backend/scripts/golden_job_replay.py --speed 120          # paced (30 s sim ticks ÷ speed), in-process cloud stub
python backend/scripts/golden_job_replay.py --mqtt-host mqtt.mycoiltubingpocketsupports.tech \
  --mqtt-ca infra/prod/pki/ca.crt --mqtt-cert <rig>.crt --mqtt-key <rig>.key \
  --api-url https://mycoiltubingpocketsupports.tech --cookie "session_token=..." [--hitl-approval-id <id>]
```
Without `--mqtt-host` no broker is needed. The handover is only POSTed when `--api-url` is set and `--dry-run` is not; without an approved `--hitl-approval-id` the HITL gate holds the send for a human.
Test: `cd backend && pytest tests/test_golden_job_replay.py -n 0`.

## Seed the app
`POST /api/demo/golden-job/seed` (management role, or any signed-in user when `BETA_TEST_MODE=true`) seeds into the caller's org:
the four role accounts (`operator@`, `leadop@`, `supervisor@`, `manager@aegis.local`), rig `rig_ct_14`, a job with well/string/BHA/survey, three tasks (`approval_tasks`) and one pending parts request (`approval_requests`, `pending_supervisor`). It is idempotent (`seeded:false` on re-run) and never overwrites later status changes.
