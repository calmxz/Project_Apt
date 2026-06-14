# Design: Reference files at session creation + back-button cleanup

Date: 2026-06-14
Status: Approved (brainstorming), pending implementation plan
Branch: `feat/session-reference-files`

## Summary

Two related UX changes:

1. **Reference files at session creation.** When creating a session, a user may
   optionally attach one or more reference documents (PDF, PPTX, or plaintext
   `.txt`/`.md`). The files are ingested in the background; the user is dropped
   into the session immediately and an in-session banner reports indexing
   progress. The tutor's RAG retrieval then draws on all ready documents.

2. **Back-button cleanup.** Remove the redundant back button from top-level,
   sidebar-reachable destinations (Settings, Aggregate Profile, New Session).
   Keep it only where it is contextual (a session's Profile view, and the
   session 404 state).

Today, file upload exists but only **inside an active session** (Composer
paperclip), is **PDF-only**, and RAG retrieval only consults the **most-recent**
document per session. This design extends upload to session creation, adds PPTX
and plaintext support, and fixes retrieval/status to be session-wide.

## Goals

- Attach 0..N reference files while creating a session.
- Support PDF, PPTX, and plaintext (`.txt`, `.md`/`.markdown`).
- Background ingestion; navigate to the session immediately with a progress
  banner.
- Retrieval and ingestion status reflect **all** documents in a session, not
  just the latest.
- Remove back buttons that duplicate sidebar navigation; keep contextual ones.

## Non-goals

- DOCX, XLSX, images/OCR, or arbitrary binary formats.
- Blocking the create screen until ingestion completes.
- Capping embedding cost (Phase 7 caps LLM cost, not embeddings) — noted as a
  known gap, out of scope here.
- Per-document delete/replace management UI (future).

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| File types | PDF + PPTX + plaintext (`.txt`, `.md`) |
| File count | Multiple (single is the N=1 case) |
| Upload timing | Navigate immediately; surface ingestion status in-session |
| Status surfacing | New `GET /api/sessions/{id}/ingestion` endpoint, frontend polls it |
| Back buttons | Remove from top-level destinations only; keep contextual |
| Aggregate semantics | `pending` if any pending; else `ready` if any ready; else `failed`; else none |

## Architecture / data flow

```
NewSessionView
  topic + [files]  --> POST /api/sessions            --> { id }
                   --> POST /api/upload (x N, 202)    --> Document rows (pending)
                   --> router.push(/session/:id)

SessionView / ReferenceStatusBanner
  poll GET /api/sessions/:id/ingestion --> { status, documents[] }  until terminal

Ingestion (background, per document)
  extract(by extension) --> chunk --> embed --> pgvector
     .pdf  -> pypdf (page = page no.)
     .pptx -> python-pptx (page = slide no.)
     .txt/.md -> text reader (page = None)

Retrieval / agent prompt
  session_ingestion_status() + has_ready_document()   <-- shared helper
  (replaces the 5x "latest document" pattern)
```

## Backend changes

### 1. Multi-format ingestion (`services/ingestion_service.py`)

Introduce a dispatcher `_extract(path, filename) -> list[tuple[int | None, str]]`
keyed on the lowercased file extension:

- `.pdf` -> existing `_extract_pages` (pypdf); `page` = 1-based page number.
- `.pptx` -> new `_extract_slides` using **python-pptx**: for each slide
  (1-based index = `page`), concatenate text from shapes where
  `shape.has_text_frame`, plus text from table cells. Slides with no text yield
  empty strings (skipped by the chunker).
- `.txt`, `.md`, `.markdown` -> read file as UTF-8 with `errors="replace"`;
  return a single `(None, text)` entry. `page` stays `None`.
- Unknown extension -> raise, so the document is marked `status="failed"` with a
  clear error (defense-in-depth; the upload route should already have rejected
  it).

The chunk -> embed -> pgvector pipeline downstream is unchanged and remains
format-agnostic. `Document.page_count` is set from the max page for PDF/PPTX and
left `None` for plaintext.

New dependency: `python-pptx` (add to `backend/requirements*.txt` / pyproject;
Docker image rebuild required).

### 2. Upload route validation (`routes/upload.py`)

Replace the strict `content_type == "application/pdf"` check with an
**extension-based** allow check (content-type is unreliable for `.md`/`.txt`,
which browsers often send as `text/plain` or `application/octet-stream`):

- Allowed extensions: `pdf`, `pptx`, `txt`, `md`, `markdown`.
- Reject anything else with HTTP 400 and a message listing accepted types.
- Keep the 25 MB limit and the existing double-pass size check.
- Verify the filename sanitizer **preserves the extension** (ingestion
  dispatches on it). A filename with no extension is rejected.

### 3. Shared aggregate helper (new `services/documents_service.py`)

Removes a 5x duplication of the "latest document" query and fixes its
correctness:

- `session_ingestion_status(db, session_id) -> Literal["pending","ready","failed"] | None`
  - no documents -> `None`
  - any document `pending` -> `"pending"`
  - else (all terminal) any `ready` -> `"ready"`
  - else -> `"failed"`
- `has_ready_document(db, session_id) -> bool`
- `list_document_statuses(db, session_id) -> list[Document]` (for the new
  endpoint)

Rewire all five existing call sites to use these helpers:

- `routes/sessions.py` `_to_response` (was `_latest_ingestion_status`, line ~66)
- `routes/sessions.py` `get_session` (line ~277)
- `routes/sessions.py` `complete_check` (line ~435)
- `routes/chat.py` prompt build (line ~93)
- `services/retrieval_service.py` `retrieve()` gate (line ~41): change from
  "`_latest_doc` is ready" to `has_ready_document`. `pgvector_store.query_chunks`
  already searches **all** chunks scoped to `session_id`, so multi-document
  search works once the gate stops keying on the latest document only. This
  fixes the bug where a newer `pending`/`failed` upload masks an older `ready`
  one.

Delete `_latest_ingestion_status` (sessions.py) and `_latest_doc`
(retrieval_service.py) once unused.

### 4. New endpoint: session ingestion status

`GET /api/sessions/{session_id}/ingestion`

- Auth: owner only; 404 if the session does not belong to the caller (matches
  existing session-route ownership checks).
- Response `SessionIngestionStatus`:
  - `status`: `pending | ready | failed | null` (the aggregate)
  - `documents`: array of `DocumentStatus { id, filename, status, error? }`

Used by the frontend banner to poll until the aggregate is terminal
(`ready`/`failed`). Light payload (no messages), unlike `GET /sessions/:id`.

## Contract changes (`docs/api/openapi.yaml` -> `gen_contracts.py`)

Contracts are codegen; edit the YAML first, then run
`python backend/scripts/gen_contracts.py`.

- Add the `GET /api/sessions/{session_id}/ingestion` path (200 +
  `SessionIngestionStatus`, 404 NotFound).
- Add schemas `SessionIngestionStatus` and `DocumentStatus`.
- Update the `/api/upload` `summary`/`description` to list accepted types
  (PDF, PPTX, TXT, MD). No request-schema change — still `file: binary`.
- `ingestion_status` field on `SessionResponse`/`SessionDetail` keeps its shape;
  only its **meaning** changes (latest-doc -> aggregate). No field churn.

## Frontend changes

### `services/uploadApi.js`
- Add `ACCEPTED_EXTENSIONS` + `ACCEPT_ATTR` (`.pdf,.pptx,.txt,.md`) constants.
- Add a shared `validateFile(file) -> { ok, reason? }` doing type (by
  extension) + size (`MAX_UPLOAD_BYTES`) checks.
- Broaden `uploadPdf` into `uploadDocument({ sessionId, file })` (keep a thin
  `uploadPdf` alias if any caller still imports it).
- Add `getSessionIngestion(sessionId)` calling the new endpoint.

### `views/NewSessionView.vue`
- Add an **optional** multi-file attach control: a button plus a drag-and-drop
  zone, `accept=".pdf,.pptx,.txt,.md"`, `multiple`.
- Selected files render as removable chips (name, size, remove "x"). Each file
  is validated client-side via `validateFile`; invalid files are rejected with
  an inline message and not added.
- Submit flow: disable the button; `createSession`; then upload all files with
  `Promise.allSettled`; then `router.push('/session/:id')`. Button states:
  "Create session" -> "Creating..." -> "Uploading N files...". If a file upload
  fails (validation / 413 / 400), surface it inline but still navigate (the
  session was created).
- Remove the back button (see Feature 2).

### `components/ReferenceStatusBanner.vue` (new, used in `SessionView`)
- On mount and while `pending`, poll `getSessionIngestion(id)` (~2s interval,
  bounded retries) until the aggregate is `ready`/`failed`.
- Render: `pending` -> "Indexing N reference(s)..."; `ready` -> "N reference(s)
  ready" (auto-dismiss/dismissible); `failed` -> "Some references could not be
  indexed" with per-document detail.

### `components/chat/Composer.vue` + `views/SessionView.vue`
- Broaden the in-session paperclip `accept` to the same set and route its
  validation through the shared `validateFile`, so in-session upload matches
  creation-time upload. After an in-session upload's 202, trigger a banner
  re-poll. Keep the existing per-file `uploadStatus` toast for immediate
  feedback.

## Feature 2: Back-button cleanup

Shared component: `components/BackButton.vue` (unchanged).

Remove `<BackButton>` (import + usage) from:
- `views/SettingsView.vue`
- `views/AggregateProfileView.vue`
- `views/NewSessionView.vue`

Keep:
- `views/ProfileView.vue` — "Back to session" is contextual; the sidebar does
  not navigate to a specific session's profile.
- `views/SessionView.vue` — both the normal-chat instance and the 404 instance.

Fix header spacing/alignment in each edited view where the back button anchored a
flex row, and update unit tests that assert `data-testid="back-button"` presence
on the three affected views.

## Testing

### Backend (pytest)
- Ingestion: PPTX fixture -> chunks with slide-number pages; TXT and MD ->
  chunks with `page=None`; unknown extension -> document `failed`.
- Upload route accept/reject matrix: pdf/pptx/txt/md -> 202; docx/png -> 400;
  oversize -> 413.
- Aggregate helper: none / all-pending / all-ready / all-failed / mixed -> exact
  status; `has_ready_document` truthiness.
- Retrieval regression: older `ready` doc + newer `pending` doc -> retrieval
  still returns chunks (proves the latest-doc wart is fixed).
- New endpoint: aggregate + per-document payload; 404 for a non-owner.
- Update `test_get_single_ingestion_status_null_when_no_documents` and add a
  mixed-document aggregate case.

### Frontend (vitest)
- NewSessionView: add/remove files, invalid type rejected, oversize rejected,
  submit-with-files calls `createSession` then `uploadDocument` per file then
  `router.push`.
- ReferenceStatusBanner: poll state transitions (pending -> ready, pending ->
  failed).
- Back button absent on Settings, Aggregate Profile, New Session; still present
  on Profile and Session views.

### E2E (Playwright) — optional, under existing e2e gating
- Attach a small PDF at creation -> session shows "indexing" -> "ready".

## Risks / edge cases

- **Image-only PPTX** -> 0 extracted chunks -> document `ready` but retrieval
  returns `no_results`. Acceptable; documented.
- **Partial multi-file failure** -> aggregate is `ready` if any document is
  ready (so the tutor can use the good ones); the banner lists the failures.
- **Unreliable content-type for `.md`/`.txt`** -> validate by extension, not
  MIME.
- **Extensionless filename** -> rejected (cannot dispatch an extractor).
- **Large slide decks** -> many chunks -> embedding cost; not covered by the
  Phase 7 LLM cost cap. Known gap, out of scope.
- **Navigate-immediately with uploads in flight** -> submit awaits
  `allSettled` (transfer only; ingestion is background), so document rows exist
  before navigation and the banner immediately shows `pending`.
