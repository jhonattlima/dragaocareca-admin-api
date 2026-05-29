# SDD - Dragao Careca Admin Platform

## 1. Purpose
This document captures the **minimum high-value project context** for AI-assisted development with low token usage.

Scope:
- Backend: `E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api`
- Frontend: `E:\Jhonatt\Development\Projects\angular\dragaocareca-admin-web`

## 2. System Overview
The old client-heavy Angular + PHP flow was replaced by:
- Node.js API + MongoDB as source of truth
- New Angular admin UI consuming API endpoints

Core rule:
- Feed is generated dynamically by backend from Mongo episodes and release-time rules (`pubDate`).

## 3. Architecture
### 3.1 Backend (`dragaocareca-admin-api`)
Stack:
- Node.js + TypeScript + Express
- MongoDB + Mongoose
- Zod validation
- Swagger (`/docs`)

Main modules:
- `src/config/env.ts`: runtime configuration and feature flags
- `src/models/Episode.ts`: Mongo schema
- `src/routes/*.routes.ts`: auth/feed/episode routes
- `src/services/feed.service.ts`: RSS feed generation
- `src/middleware/auth.middleware.ts`: JWT auth + dev bypass
- `src/scripts/import-legacy-episodes.ts`: legacy data import

### 3.2 Frontend (`dragaocareca-admin-web`)
Stack:
- Angular 15
- Bootstrap styling

Main modules:
- `src/environments/*`: API URL + auth toggle
- `src/app/core/auth.service.ts`: auth + bypass logic
- `src/app/core/auth.guard.ts`: route guard
- `src/app/core/auth.interceptor.ts`: Bearer token injection
- `src/app/core/api.service.ts`: endpoint client
- `src/app/pages/login/*`: Google login page
- `src/app/pages/dashboard/*`: episode management + status view

## 4. Authentication Model
### 4.1 Production
- Google ID token is exchanged via `POST /v1/auth/google`
- Backend returns JWT
- Frontend stores JWT and sends `Authorization: Bearer <token>`

### 4.2 Local Development Bypass
Backend flag:
- `.env`: `AUTH_BYPASS=true` with `NODE_ENV=development`

Frontend flag:
- `environment.ts`: `authBypass: true`

When both are enabled:
- User can access protected flows without Google login

## 5. Feed Rules
- Public endpoint: `GET /v1/feed`
- Includes episodes with `pubDate <= now`
- Feed channel metadata mostly static via env vars (`FEED_*`)
- Item-level XML can be sourced from legacy `xmlSnapshot` when present
- Staging logic is internal (no external staging-promotion endpoint)

## 6. Data Model (Episode)
Collection: `episodes`
Key fields:
- `episodeId` (unique)
- `title`, `summary`, `pubDate`, `explicit`
- `duration`, `bytes`
- `fileName`, `coverFileName`
- `authors`, `guests`, `tags`, `citations`
- `musicCredits`, `coverCredits`
- `xmlSnapshot` (legacy item XML)

## 7. API Surface (Current)
Public:
- `GET /health`
- `GET /v1/feed`

Auth:
- `POST /v1/auth/google`
- `GET /v1/auth/me`

Episodes (protected unless backend bypass):
- `GET /v1/episodes`
- `GET /v1/episodes/:episodeId`
- `POST /v1/episodes`
- `PUT /v1/episodes/:episodeId`

Feed admin (protected unless backend bypass):
- `GET /v1/feed/preview`
- `GET /v1/feed/status`

Docs:
- `GET /docs`
- `GET /docs.json`

## 8. Critical Environment Variables
### 8.1 Backend `.env`
- `NODE_ENV`
- `PORT`
- `MONGODB_URI`
- `GOOGLE_CLIENT_ID`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `ALLOWED_GOOGLE_EMAILS`
- `AUTH_BYPASS`
- `FEED_*` static feed metadata vars

### 8.2 Frontend environment
- `apiBaseUrl`
- `googleClientId`
- `authBypass`

## 9. Local Runbook
### 9.1 Backend
```powershell
cd E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api
npm install
npm run dev
```
Swagger: `http://localhost:3000/docs`

### 9.2 Frontend
```powershell
cd E:\Jhonatt\Development\Projects\angular\dragaocareca-admin-web
npm install
npm start
```
UI: `http://localhost:4200/`

## 10. Legacy Import
Use when local DB needs full historical episodes:
```powershell
cd E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api
npm run import:episodes -- "E:/Jhonatt/Development/Projects/node/dragaocareca-admin-api/data/all_episodes.json"
```

## 11. Known Constraints / Current Gaps
- Feed parity with production feed is close but not byte-identical.
- Some episode item formatting depends on legacy `xmlSnapshot` quality.
- Frontend layout has been modernized with old-project section structure, but not all legacy subfeatures are reintroduced yet.

## 12. AI Prompt Starter (Low Token)
Use this block in future sessions:

```text
Project: Dragao Careca Admin Platform
Backend: E:\Jhonatt\Development\Projects\node\dragaocareca-admin-api
Frontend: E:\Jhonatt\Development\Projects\angular\dragaocareca-admin-web
Read docs/SDD.md first.
Respect env toggles: backend AUTH_BYPASS, frontend authBypass.
Do not reintroduce client-side feed generation.
Prefer backend-first logic changes and keep frontend as API client.
```
