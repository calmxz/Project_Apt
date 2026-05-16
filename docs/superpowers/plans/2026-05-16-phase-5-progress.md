# Phase 5 Progress Tracker

Source plan: `~/.claude/plans/lovely-wobbling-gosling.md`
Branch: `phase/5-profileview-polish-deploy`
Started: 2026-05-16
Code-complete: 2026-05-16 (awaiting commit approval + manual smoke/screencast)

## Status legend
- [ ] pending
- [~] in progress
- [x] done
- [!] blocked

## Step 0 — Branch + tracker
- [x] git checkout -b phase/5-profileview-polish-deploy (off dev)
- [x] this progress file created

## Backend
- [x] openapi.yaml: AggregateProfileResponse + /api/profile/aggregate
- [x] gen_contracts.py regen: produces +66 lines, idempotent (re-running = no diff)
- [x] routes/profile.py: GET /api/profile/aggregate (declared BEFORE /{session_id})
- [x] services/profile_service.py: aggregate_for_user(db, user_id)
- [x] CORS env: settings.cors_origins (comma-split) + main.py uses cors_origin_list
- [x] backend/.env.example (and .gitignore patched so it's actually tracked)
- [x] Daily-cap 429 shape: {code, cap, used, resets_at}; rate_limit returns (allowed, used)
- [x] tests/test_profile_aggregate.py (5 cases: empty, overlap, knowledge dist, events+recent, per-user isolation)

## Frontend
- [x] services/profileApi.js (getSessionProfile + getAggregateProfile)
- [x] router: added /profile -> AggregateProfileView
- [x] views/AggregateProfileView.vue
- [x] views/ProfileView.vue rewritten (per-session view)
- [x] HomeView: Combined profile button in header
- [x] SessionView: Profile link in header + cap banner + cap-disabled input
- [x] composables/useToast.js (wraps PrimeVue useToast)
- [x] stores/session.js: dailyCapReached + dailyCapInfo + clearDailyCap; 429 detection in sendMessage
- [x] App.vue: <Toast /> mounted; user icon links to /profile in topnav
- [x] main.js: ToastService registered
- [x] SettingsView: name + feedback prefs edit + Save + danger-zone reset link
- [x] stores/user.js: updateProfile() action

## Tests
- [x] src/__tests__/aggregateProfileView.test.js (3 cases)
- [x] src/__tests__/sessionProfileView.test.js (2 cases)
- [x] src/__tests__/settingsView.test.js (2 cases)
- [x] e2e/profile-navigation.spec.js (requires backend + LLM_STUB)
- [x] e2e/daily-cap.spec.js (mocks 429 via page.route)

## Deploy
- [x] backend/Dockerfile (python:3.12-slim + curl healthcheck)
- [x] frontend/Dockerfile (node:20-alpine build -> nginx:1.27-alpine serve)
- [x] frontend/nginx.conf (SPA fallback + /api proxy to backend:8000 + gzip + asset cache)
- [x] docker-compose.prod.yml (frontend exposes :80, backend internal, chromadb internal, ./data volume)
- [x] docs/deploy/ngrok.md

## Screencast
- [x] docs/screencast/script.md (9 scenes, ~150-180s total)
- [ ] Record walkthrough (manual, user-driven)
- [ ] Link/embed in README

## Verification gates
- [x] backend pytest green: 100 passed
- [x] contract gen idempotent (zero new diff on re-run)
- [x] frontend vitest green: 9 passed (was 2; +7 new)
- [x] frontend lint clean (oxlint + eslint)
- [x] frontend production build clean (vite build OK)
- [ ] playwright e2e green (needs backend at :8000 with LLM_STUB=1; not run in this session)
- [ ] dev stack manual smoke (docker compose up — chromadb only; native frontend+backend)
- [ ] prod stack manual smoke (docker compose -f docker-compose.prod.yml --env-file backend/.env up --build)
- [ ] ngrok URL loads end-to-end
- [ ] CI green on PR (push pending user approval)
- [ ] manual daily-cap test (DAILY_CAP=2)
- [ ] focus-clearing reliability checkpoint >=85% (spec §6.3)
- [ ] screencast recorded

## Outstanding (user-blocked)
- Commit approval — goal says "do not commit without my go"
- Manual smoke tests + screencast recording — needs human in front of browser

## Notes / decisions log

- **2026-05-16** — User chose cross-session aggregate ProfileView over per-session-only (overrides spec's implicit scope; adds new backend endpoint `GET /api/profile/aggregate`).
- **2026-05-16** — Deploy = Docker + ngrok (no cloud bills). nginx reverse-proxies `/api/*` -> backend so single origin = no CORS needed for ngrok URL.
- **2026-05-16** — Settings minimal scope: name + interaction prefs + reset onboarding only.
- **2026-05-16** — Commit gate: user must approve before any commits land.
- **2026-05-16** — Changed `rate_limit.check_and_increment` return shape from `bool` to `(bool, int)` so the 429 envelope can carry the live `used` count without an extra query. Updated `test_rate_limit.py` + `test_chat.py` accordingly.
- **2026-05-16** — Replaced PrimeVue `InputText` with a plain `<input>` in `SettingsView` to dodge stub-fragility in vitest (PrimeVue's component template doesn't round-trip through `setValue` cleanly). Visual styling preserved via `.input` class.
- **2026-05-16** — `.gitignore` had `.env.example` blanket-ignored (probably a mistake from Phase 1). Replaced with explicit allow: `!**/.env.example`.
