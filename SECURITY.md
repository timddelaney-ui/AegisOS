# Security Policy & Vulnerability Disclosure

## Supported Versions

Only the latest release of Aegis OS / CT Field Workbook on branch `main` receives security updates.

## Reporting a Vulnerability

Report security concerns directly to repository administrators. Do not open public GitHub issues for security vulnerabilities.

## Security Considerations

WITSML endpoint URLs are not currently restricted by an origin allowlist, and the
WITSML HTTP client does not disable redirects. Configure DAQ endpoints only from
trusted sources and restrict outbound network access as appropriate.
