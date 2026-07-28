# Stack Research

**Domain:** Authenticated episode artifact ZIP downloads for an Express API
**Researched:** 2026-07-28
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|---|---:|---|---|
| `archiver` | current compatible release at implementation time | Build ZIP archives from a fixed set of local files | Its documented `file()` API adds explicit files lazily and its output is a native stream, so the response is generated without a temporary archive. |
| Express 5 | existing | Authenticated HTTP response and headers | The project already uses Express routes and `requireAuth`; the endpoint fits this boundary without a new service process. |
| Node streams and filesystem promises | existing Node runtime | Validate files before streaming and send the archive | `ServerResponse` is a writable stream. Preflight checks allow a deterministic JSON `404` before archive headers are sent. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---|---:|---|---|
| `@types/archiver` | matching current package | TypeScript declarations | Add with `archiver` if the package does not ship suitable declarations. |
| Existing `node:fs` | built in | Determine whether each canonical artifact is a regular file | Use for preflight only; do not scan directories or accept request paths. |

## Installation

```bash
npm install archiver
npm install -D @types/archiver
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| `archiver` | Hand-built ZIP with `node:zlib` | Never for this endpoint: zlib compresses streams but does not provide the ZIP container and central-directory handling. |
| `archiver` | `yazl` | Reasonable for a new minimal service that already standardizes on it; not needed here because Archiver has a direct, documented Express-compatible file-stream API. |
| Stream directly to the response | Generate a temporary `.zip` file | Only when a later requirement needs resumable downloads or caching; current operator downloads do not justify disk churn. |

## What Not To Use

| Avoid | Why | Use Instead |
|---|---|---|
| `archive.directory()` over an episode directory | It could accidentally include state, draft, backup, or future files. | Add only the five approved canonical files individually. |
| Client-supplied filenames or paths | Enables path traversal and internal-layout disclosure. | Map English selectors to fixed `getEpisodeMediaFinalPath()` results. |
| Creating the ZIP before checking availability | Once binary headers/body start, the API cannot reliably return the required JSON `404`. | Preflight every requested item with `stat().isFile()`. |

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `archiver` current release | Node runtime used by this project | Verify the installed release supports the deployment Node version before committing the lockfile. |
| `@types/archiver` | selected `archiver` release | Run `npm run typecheck` after installation. |

## Sources

- [Archiver Quickstart](https://www.archiverjs.com/docs/quickstart/) - installation, streaming usage, explicit files, and finalization lifecycle.
- [Archiver API](https://www.archiverjs.com/docs/archiver/) - `file()` lazily adds a named file and `finalize()` closes the archive input.
- [Node.js Streams](https://nodejs.org/api/stream.html) - HTTP `ServerResponse` is a writable stream and stream error behavior.

---
*Stack research for: episode artifact ZIP downloads*
