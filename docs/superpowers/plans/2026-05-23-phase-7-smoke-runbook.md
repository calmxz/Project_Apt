# Phase 7 — Manual Smoke Runbook

**Task:** T11 from `2026-05-23-phase-7-auth-postgres-pgvector-costcap.md`.
**Goal:** prove end-to-end that auth + Postgres/pgvector + cost cap all behave
correctly against real services (Supabase + Gemini), not just mocks.

Run each section in order. If anything fails, stop and triage — do not move on.

---

## 0. Preconditions

- Branch `phase/7-auth-postgres-pgvector-costcap` checked out.
- Backend deps installed in `backend/.venv` (`pip install -e ".[dev]"`).
- Root `.env` populated with:
  - `GEMINI_API_KEY=<real key>`
  - `DATABASE_URL=postgresql+psycopg://postgres.<ref>:<pwd>@<region>.pooler.supabase.com:6543/postgres`
  - `SUPABASE_URL=https://<ref>.supabase.co`
  - `SUPABASE_SERVICE_ROLE_KEY=<service_role secret>`
  - `LLM_HARD_CAP_USD=3.00` (will override per-section below)
- `frontend/.env.local` populated with:
  - `VITE_SUPABASE_URL=https://<ref>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<anon public key>`
  - `VITE_API_BASE_URL=http://localhost:8000/api`
- Alembic migrations applied: `python -m alembic upgrade head` (run from `backend/`).
- Supabase project Authentication → Providers → Email → Magic-link enabled.
- Supabase Authentication → URL Configuration → Site URL = `http://localhost:5173`
  and Redirect URLs includes `http://localhost:5173/**`.

---

## 1. Stack up

```powershell
# Terminal A — backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000

# Terminal B — frontend
cd frontend
npm run dev
```

Expect:
- Terminal A: `Uvicorn running on http://127.0.0.1:8000`, no traceback.
- Terminal B: `Local: http://localhost:5173/`.
- Opening http://localhost:5173 redirects to `/login`.

Fail-fast checks:
- `curl http://localhost:8000/api/sessions` → `{"detail":"missing_token"}` with 401.
- `curl http://localhost:8000/health` → `{"status":"ok"}`.

---

## 2. Magic-link sign-in (happy path)

1. On `/login`, enter your real email → click **Send magic link**.
2. Expected UI: green "Check your inbox at <email>..." line appears.
3. Check inbox (and spam). Click the magic link.
4. Browser opens, lands on `/` after a brief flash. URL bar contains a hash
   fragment — Supabase strips it after `detectSessionInUrl` kicks in.
5. **Expected**: home view renders with empty sessions list. No console errors.
6. **Verify token in browser**: DevTools → Application → Local Storage →
   `sb-<projectref>-auth-token` exists and has a non-empty `access_token`.

If the link redirects to `localhost:3000` or anywhere wrong → fix Site URL +
Redirect URLs in Supabase dashboard, then resend.

---

## 3. Create a session + chat

1. From `/`, click **New session**.
2. Enter topic `Binary search`, seed mode `Fresh` → submit.
3. Land on `/session/<uuid>`. Composer is visible, focused.
4. Type `Explain binary search in two sentences.` → Enter.
5. **Expected**:
   - "you" bubble appears on the right (coral).
   - "tutor" bubble appears on the left after ~1-3s with a real Gemini response.
   - No 401 / 500 in DevTools Network tab.
6. Check Supabase Table Editor → `sessions` and `chat_messages` should have new rows.
   The `user_id` column on `sessions` should equal your Supabase user id
   (visible in the JWT `sub`, decode via jwt.io if needed).

---

## 4. PDF upload + RAG citations

1. Same session, click **Attach** (paperclip icon).
2. Pick a small PDF (~5 pages, text-based; not a scan).
3. **Expected**: status pill says "Uploading…", then "<filename> is ready."
   Total time ≤30s for a small file.
4. Ask a question that requires the PDF content (e.g., something specific to
   the document).
5. **Expected**: tutor reply includes a dashed-bordered "Citations" block
   listing 1-3 chunks with `doc_id` and a snippet.
6. Verify pgvector wrote rows: in Supabase SQL Editor,
   ```sql
   SELECT COUNT(*) FROM chunk_embeddings
    WHERE session_id = '<your session id>';
   ```
   Should be ≥1.

---

## 5. Cross-user isolation (auth enforcement)

This proves T3b actually wired auth into route handlers, not just the dep.

1. Note the session URL from §3: `/session/<sessionA>`.
2. Open an incognito window → `/login` → sign in with a **different** email.
3. Once on `/`, paste the full URL `/session/<sessionA>` into the address bar.
4. **Expected**: 404 page ("Session not found"). The session is NOT visible
   to user B even though they know the ID.
5. Confirm via curl with user B's token:
   ```bash
   curl -H "Authorization: Bearer <userB_token>" \
        http://localhost:8000/api/sessions/<sessionA_id>
   # → 404 {"detail":"session not found"}
   ```

---

## 6. Cost cap (the chunky one)

Demonstrates `LLM_HARD_CAP_USD` actually blocks chat at the route level.

1. Stop backend (Ctrl+C in Terminal A).
2. Override the cap to almost-zero, restart:
   ```powershell
   $env:LLM_HARD_CAP_USD = "0.01"
   uvicorn main:app --reload --port 8000
   ```
3. Back in the browser (still signed in as user A), reload `/session/<id>`.
4. Send 1-2 chat messages. First or second exchange should push usage past $0.01.
5. **Expected**:
   - Red "Daily cost limit reached" banner appears above the composer.
   - Composer disables (greyed out, can't type or send).
   - Next attempt would 429 the route: confirm via DevTools Network tab —
     the most recent `/api/chat` request returned `429` with
     `{"detail":{"code":"cost_cap_reached", ...}}`.
6. Reset for further testing:
   ```powershell
   # Either clear the override:
   Remove-Item env:LLM_HARD_CAP_USD
   # Or set a saner cap:
   $env:LLM_HARD_CAP_USD = "3.00"
   ```
   Reset the ledger for today (UTC):
   ```sql
   DELETE FROM daily_cost_ledger
    WHERE user_id = '<your_supabase_user_id>'
      AND ledger_date = CURRENT_DATE;
   ```
   Restart uvicorn.

---

## 7. Sign-out

1. Click the gear icon (Settings) → **Sign out** (or wherever the action lives).
2. **Expected**: redirected to `/login`. localStorage `sb-...-auth-token` cleared.
3. Hit `/` directly → redirected back to `/login`. (auth guard still enforces).

---

## 8. CI green

Local before push:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q                 # 163 passed, 4 skipped
cd ../frontend
npm run test:unit -- --run                              # 156 passed
npm run lint                                            # clean
```

Then on the PR, check GitHub Actions:
- `backend` job: green
- `frontend` job: green
- `contract-drift`: green (zero regenerated diff)
- `playwright`: `continue-on-error: true` for now; review the report manually.

---

## Sign-off checklist

- [ ] §1 stack up clean
- [ ] §2 magic-link landed on home
- [ ] §3 chat got a real Gemini reply, rows in Postgres
- [ ] §4 PDF ingested, citations visible, chunk_embeddings has rows
- [ ] §5 user B got 404 for user A's session (UI + curl)
- [ ] §6 cost cap blocked the request, banner rendered, 429 in network tab
- [ ] §7 sign-out cleared session + bounced to /login
- [ ] §8 backend pytest + frontend vitest + lint all green
- [ ] CI on PR: backend, frontend, contract-drift all green

When all boxes ticked, T11 is done. Move plan §11 to status `complete` and
merge the branch.
