# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.7.x | Yes |
| < 0.7 | No |

Security fixes land on the latest release line and are published as patch
releases. Pre-release, fork, and locally modified builds are not supported.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report vulnerabilities privately through GitHub security advisories:

<https://github.com/CodeCody93/Notedown/security/advisories/new>

Please include:

- The affected version (desktop, web, or `@codecody93/notedown-editor`) and the
  operating system/browser.
- Steps to reproduce, a proof of concept, or a minimal Markdown/document that
  triggers the issue.
- The impact you believe it has, and whether the report can be shared publicly
  and when.

Reports are acknowledged on a best-effort basis. Please allow time for a fix
and a coordinated disclosure before publishing details. Credit is given in the
advisory unless you prefer to remain anonymous.

## Scope

In scope:

- The desktop application and its Tauri commands/capabilities.
- The GitHub Pages web build.
- The published embeddable editor package and its CDN bundle.
- The release workflow and version/publishing automation.

Out of scope:

- Vulnerabilities in third-party dependencies that are already fixed upstream
  (report them upstream, but let us know if Notedown pins an affected version).
- Issues that require a compromised device, malicious browser extension, or
  physical access.
- Social engineering, spam, or denial-of-service reports without a concrete
  impact.
- The unsigned/not-notarized release process itself (SmartScreen and Gatekeeper
  warnings are documented).

## No secrets in reports

Never include passwords, API tokens, signing keys, `.npmrc` auth tokens,
keystores, or personal data in a report, issue, or pull request. Use redacted
examples. If a secret may have leaked, revoke it first and then report the
exposure privately.

## Security expectations for contributions

- Markdown rendering uses `html: true`; every rendered HTML output must pass
  through DOMPurify.
- All file I/O goes through `src/platform/`; do not add broad filesystem scopes
  to the Tauri capabilities.
- External links go through `openExternal`, which rejects `javascript:`, `data:`,
  and `vbscript:` URLs.
- Do not commit tokens or signing material. See [`docs/releasing.md`](docs/releasing.md)
  for the release secret setup.
