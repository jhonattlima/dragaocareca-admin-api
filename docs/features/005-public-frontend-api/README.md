# Public Frontend API

## Purpose

This feature provides backend-owned public JSON endpoints for the legacy `dragaocareca_frontend` application and any future public frontend replacement.

The goal is to remove reliance on:

- legacy PHP endpoints such as `index.php`, `contacts.php`, and `patreon.php`
- hardcoded public config from the old frontend `src/config.js`
- frontend-owned publication, ordering, and media URL rules

## Public Endpoints

### Episodes

- `GET /v1/public/episodes`
  - home page catalog
  - plain JSON array
  - published-only
  - newest-first

- `GET /v1/public/episodes/:episodeId`
  - episode detail page
  - published-only
  - returns frontend-ready media and embed fields

### Site pages

- `GET /v1/public/about`
- `GET /v1/public/contact`
- `GET /v1/public/social`
- `GET /v1/public/contacts`
- `GET /v1/public/supporters`
- `GET /v1/public/site-config`

## Legacy Mapping

### Old frontend `config.js`

| Legacy key | Replacement |
|---|---|
| `api` | `GET /v1/public/episodes` and `GET /v1/public/episodes/:episodeId` |
| `apiContacts` | `GET /v1/public/contacts` |
| `social` | `GET /v1/public/social` |
| `email` | `GET /v1/public/contact` or `GET /v1/public/site-config` |
| `patreonLink` | `GET /v1/public/supporters` or `GET /v1/public/site-config` |
| `patreonSupporters` | `GET /v1/public/supporters` |
| `fichasDominio` | `GET /v1/public/contact` or `GET /v1/public/site-config` |
| `fichasRequest` | `GET /v1/public/contact` or `GET /v1/public/site-config` |
| `maxEpisodesPerPage` | `GET /v1/public/site-config` |
| `transitionTime` | `GET /v1/public/site-config` |
| `disqus.shortName` | `GET /v1/public/site-config` |

### Old frontend screens

| Screen | Replacement endpoints |
|---|---|
| home page | `GET /v1/public/episodes`, `GET /v1/public/social`, `GET /v1/public/site-config` |
| episode page | `GET /v1/public/episodes/:episodeId`, `GET /v1/public/contacts`, `GET /v1/public/site-config` |
| guild/supporters page | `GET /v1/public/supporters` |
| about page | `GET /v1/public/about` |
| author/contact UI | `GET /v1/public/contacts`, `GET /v1/public/contact` |

## Response Notes

### `GET /v1/public/episodes`

Each item includes:

- `episodeId`
- `title`
- `summary`
- `pubDate`
- `guests`
- `pageUrl`
- `audioUrl`
- `coverUrl`
- `trailerUrl`

### `GET /v1/public/episodes/:episodeId`

The detail payload includes:

- `episodeId`
- `title`
- `summary`
- `pubDate`
- `duration`
- `explicit`
- `authors`
- `guests`
- `citations`
- `musicCredits`
- `coverCredits`
- `pageUrl`
- `audioUrl`
- `downloadUrl`
- `coverUrl`
- `trailerUrl`
- `youtubeUrl`
- `youtubeEmbedUrl`
- `spotifyId`
- `spotifyEmbedUrl`

### `GET /v1/public/supporters`

Returns:

- `supportUrl`
- `supporters`

Note: the new contract uses `supporters`, not `patreon`.

### `GET /v1/public/site-config`

Returns shared frontend config:

- `email`
- `supportersUrl`
- `characterSheetsBaseUrl`
- `maxEpisodesPerPage`
- `transitionTimeMs`
- `disqus.shortName`

## Migration Guidance

For `dragaocareca_frontend`, the clean migration path is:

1. Replace `config.api` list fetches with `GET /v1/public/episodes`.
2. Replace episode page full-list lookup with `GET /v1/public/episodes/:episodeId`.
3. Replace `config.apiContacts` with `GET /v1/public/contacts`.
4. Replace `config.patreonSupporters` with `GET /v1/public/supporters`.
5. Replace remaining hardcoded config reads with `GET /v1/public/site-config`, `GET /v1/public/social`, and `GET /v1/public/contact`.

## Verification

The backend implementation was verified on July 21, 2026 with:

- `npm run typecheck`
- `npm run build`
- local smoke checks against every new public endpoint
