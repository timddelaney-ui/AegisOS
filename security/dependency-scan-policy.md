# Dependency vulnerability scan policy

The `Dependency vulnerability scan` workflow runs for pull requests, pushes to
`main`, and manual dispatches. OSV-Scanner checks the pinned Python requirements
and the Yarn dependency tree resolved from `frontend/package.json`. Any reported
vulnerability blocks the workflow, including findings below High severity; this
is intentionally stricter than a High/Critical-only release gate.

## Exceptions

Exceptions are temporary and must be approved by a repository maintainer before
being merged. Add one `[[IgnoredVulns]]` entry for the specific OSV vulnerability
ID to `security/osv-scanner.toml`, including a reason and an expiry date no more
than 30 days away:

```toml
[[IgnoredVulns]]
id = "GHSA-xxxx-xxxx-xxxx"
ignoreUntil = 2026-11-25
reason = "Why the risk is accepted and the remediation plan or tracking issue."
```

Do not use package-wide ignores. Reassess the risk and remove or renew the
exception before it expires; an exception is not a substitute for remediation.
The scanner report, including its findings, is uploaded as a run artifact for
90 days even when the scan fails.

## Beta baseline

The first successful scan uploads `test_reports/beta-evidence/dependency-scan-baseline.json`
as the `beta-dependency-scan-<run id>` workflow artifact. The repository file at
that path is only a placeholder until the first CI scan completes; use the
uploaded artifact as the dated baseline evidence.
