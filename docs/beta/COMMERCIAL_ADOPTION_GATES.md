# Commercial Adoption Gates

This register turns the commercial-readiness requirements identified during
product review into verifiable gates. It is not a claim that the requirements
are already met. Keep the product in advisory/shadow use until the applicable
evidence is reviewed and signed off.

## 1. Legacy reel-history migration and job packages

**Current state:** Playback exports support CSV and LAS 2.0; Shadow Mode reports
support PDF and CSV. There is no verified Cerberus/Reel-Trak history importer,
and those existing exports are not yet a complete pre-job/post-job package.

- [ ] Obtain representative, authorized legacy exports and document provenance,
  encoding, units, station/depth conventions, and fatigue-percentage meaning.
- [ ] Implement a preview-first importer with explicit column mapping, strict
  validation, duplicate detection, and a dry-run reconciliation summary.
- [ ] Preserve the source file, import time, actor, mapping/version, and source
  identifiers for audit; never silently replace existing reel balances.
- [ ] Reconcile imported station balances against source totals and a human-
  approved sample before committing. Reject ambiguous units or fatigue semantics.
- [ ] Define and test the pre-job/post-job package contents and PDF/LAS schemas;
  verify round-trip values and readable output with representative engineering
  tools.
- [ ] Run a supervised migration of a non-production reel before any active
  string history is imported.

Implementation must use customer-authorized files and documented field
mappings. Do not infer proprietary file formats or scrape vendor software.

## 2. Independent engineering validation and shadow evidence

**Current state:** Shadow Mode can record Aegis-versus-reference comparisons
and export PDF/CSV reports. Reports explicitly state that references are entered
or imported and are not independently verified. No independent Fatemi-Socie or
Chaboche validation against bend-test failures or retired-string records is
present in the repository.

- [ ] Have a qualified independent reviewer approve the model equations,
  assumptions, material inputs, units, calibration procedure, and intended use.
- [ ] Establish a traceable benchmark set with permission to use bend-test and
  retired-string data; separate calibration cases from holdout validation cases.
- [ ] Predefine acceptance tolerances, uncertainty treatment, failure criteria,
  and handling of missing or censored fatigue histories before running cases.
- [ ] Compare predictions with physical evidence and an accepted reference
  implementation; preserve raw inputs, model version, results, and reviewer signoff.
- [ ] Run shadow mode on 3–5 representative high-pressure milling or acid jobs,
  selected with the operating company. Record both systems side-by-side without
  controlling equipment or replacing the approved program.
- [ ] Publish case studies or technical claims only after customer permission,
  independent review, and legal approval.

The 3D stress visualization is explanatory only. It must identify units,
assumptions, data source, and advisory status; visual agreement is not model
validation.

## 3. Read-only, hardware-agnostic rig integration

**Current state:** The Modbus TCP listener polls holding registers and the WITS 0
listener consumes a TCP stream. The listener implementation contains no
Modbus write calls. OPC UA support is absent, and no under-one-hour field
installation or site acceptance test has been documented.

- [ ] Preserve an explicit read-only boundary: no PLC/drive writes, setpoint
  changes, control outputs, safety-interlock changes, or closed-loop actuation.
- [ ] Before enabling a new protocol (including OPC UA), review permissions and
  code paths, then test against a simulator or isolated bench endpoint that
  rejects writes. Do not enable write-capable credentials.
- [ ] Require customer-approved point/register maps, units, sample rates, network
  routes, and a site-specific hazard/change review.
- [ ] Verify network segmentation, least-privilege accounts, reconnect behavior,
  invalid/stale data handling, and safe failure when the listener is stopped.
- [ ] Time an installation by a field electronics technician using a clean
  machine and approved instructions; record prerequisites, elapsed time, and
  rollback steps. Do not claim plug-and-play or a one-hour install until passed.

The edge gateway currently supports WITS 0 TCP and Modbus TCP only. It is an
advisory data path, not a PLC safety system. The UI simulator and edge buffer do
not make the application suitable for equipment control.

## 4. Enterprise isolation, security, and liability

**Current state:** The application scopes many records by team and provides an
advisory-use notice. This is not an independent tenant-isolation assessment or
SOC 2/ISO attestation. Production Terms of Service and E&O coverage are not
verified in this repository.

- [ ] Add automated cross-tenant authorization tests for every tenant-owned
  read, write, export, share-link, and background-processing path; review
  object-storage and WebSocket boundaries as well.
- [ ] Complete an independent security assessment, remediation tracking,
  production secrets/access review, backup/restore test, and incident-response
  exercise.
- [ ] Obtain legal review and publish commercial Terms of Service that clearly
  describe advisory engineering decision support, limitations, operator
  responsibility, data handling, and applicable jurisdiction.
- [ ] Obtain broker/legal confirmation of appropriate Errors & Omissions
  coverage before commercial use; record policy scope, exclusions, and renewal
  owner outside this codebase.
- [ ] Make no SOC 2 or ISO certification/alignment claim without a defined
  control scope, evidence, and authorized compliance review. A control roadmap
  is not an attestation.

## Release decision

Evidence belongs in the release record and must identify the reviewer,
environment, product/model version, date, and unresolved exceptions. Until
these gates are closed, Aegis OS remains advisory/shadow-only and must not be
positioned as a safety system, a validated fatigue-life authority, or a
replacement for the operator's approved engineering program.

## Status update — readiness audit branch

- **Added:** CSV / LAS 2.0 / Cerberus- and Reel-Trak-style CSV string-history importer
  (`frontend/src/lib/stringHistoryImporter.js`, `StringHistoryImport.jsx` on `/reels`,
  `POST /api/fatigue/import`). Cerberus and Reel-Trak support is header-alias matching only and
  has not been verified against real exports from those products.
- **Added:** `/stress` segment workbench with the CT90 benchmark (80 MPa, 4 kN, 24 m →
  428.0 / 414.2 / 421.3 MPa, 67.9 %) as an automated test.
- **Added:** `/terms` draft engineering decision-support disclaimer (needs legal review).
- **Still open:** OPC UA listener, Cerberus-baseline / bend-test side-by-side dossier, PDF/LAS
  pre-job package, independent model validation, SOC 2 / ISO evidence, E&O.
