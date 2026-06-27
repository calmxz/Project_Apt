# Uploaded-Files Panel + Delete — Design

Date: 2026-06-27
Status: Approved (design), pending implementation plan

## Goal

When a chat session has uploaded reference files, give the user a visible,
per-file interface inside the chat view: list each uploaded file with its
ingestion status, and let the user delete a file. Today the UI only shows an
aggregate count ("3 references ready") via `ReferenceStatusBanner`; the
per-document data is already fetched but collapsed.

## Scope

In scope:
- Expandable per-file list inside the existing `ReferenceStatusBanner`.
- Per-file delete with confirmation, including full backend cleanup
  (DB row, on-disk file, pgvector chunk embeddings).
- New `DELETE /api/documents/{document_id}` endpoint + contract.

Out of scope (YAGNI):
- Re-upload / replace in place.
- Rename, reorder, or download of files.
- Bulk delete.
- Dedicated Pinia store for uploads (current local-ref pattern stays).

## Decisions (locked)

- Display form: expand the existing `ReferenceStatusBanner` (chevron toggle),
  not a separate panel or header dropdown.
- Visibility: show whenever the session has >= 1 document (matches current
  banner behavior; not gated on message count).
- Per-file actions: view + delete.
- Endpoint: `DELETE /api/documents/{document_id}` (new `documents` namespace).
- Confirm dialog: PrimeVue `ConfirmDialog` (not native `window.confirm`).

## Backend

### Endpoint
`DELETE /api/documents/{document_id}` -> `204 No Content`.

- New router `backend/routes/documents.py`, `APIRouter(prefix="/api")`,
  registered in `backend/main.py` (`app.include_router(documents.router)`).
- Auth via `Depends(current_user_id)`.
- Ownership check: load `Document` -> its `Session`; if not found or
  `session.user_id != user_id`, return `404` (do not leak existence of other
  users' documents). No separate `403`.

### Service
`documents_service.delete_document(db, document_id, user_id) -> None`
orchestrates, in order:
1. Resolve `Document` joined to `Session`; enforce ownership (raise a
   not-found signal the route maps to `404`).
2. Delete pgvector chunk rows: `pgvector_store.delete_document_chunks(db, document_id)`.
3. Delete the on-disk file `{settings.uploads_path}/{id}_{filename}`; tolerate a
   missing file (already gone) without error.
4. Delete the `Document` row.
5. `db.commit()`.

### Store
`pgvector_store.delete_document_chunks(db, document_id) -> int` — single
`DELETE FROM chunk_embeddings WHERE document_id = :id`, returns rows deleted.
Keeps vector-table SQL co-located with `insert_chunks` / `query_chunks`.

Note: `chunk_embeddings.document_id` has no DB-level `ON DELETE CASCADE`, so the
explicit delete in step 2 is required. (A future migration could add a cascade;
out of scope here.)

### Contract
1. Add the `DELETE /api/documents/{document_id}` path to `docs/api/openapi.yaml`
   (params: `document_id` integer path; responses `204`, `404`).
2. Run `python backend/scripts/gen_contracts.py`. Contracts are codegen — never
   hand-edit `backend/contracts/`. CI enforces zero drift.

## Frontend

### `uploadApi.js`
Add `deleteDocument(documentId)` — `DELETE ${BASE_URL}/documents/{id}` with
`_authHeaders()`; resolve on `204`, throw on non-OK (consistent with existing
helpers).

### `ReferenceStatusBanner.vue`
- Header (existing aggregate count) gains a chevron and becomes a toggle
  (`expanded` local ref, default collapsed). Keyboard-accessible
  (button semantics, `aria-expanded`).
- When expanded, render rows from the already-fetched `documents[]`:
  - filename
  - status pill (pending / ready / failed) reusing existing status styling
  - error text when `status === 'failed'`
  - trash icon button (`aria-label` includes filename)
- Trash click -> PrimeVue `confirm.require(...)` -> on accept:
  `deleteDocument(id)`, then `refresh()` (re-fetch `getSessionIngestion`).
  On delete failure, surface via existing toast (`useToast`).
- When the last document is removed, `getSessionIngestion` returns
  `status: null` -> banner hides (existing behavior, no extra logic).

### App wiring (PrimeVue ConfirmDialog)
`ConfirmDialog` is not yet used anywhere. Add:
- `app.use(ConfirmationService)` in `frontend/src/main.js` (alongside
  `ToastService`).
- Mount one global `<ConfirmDialog />` in `App.vue` (mirrors the existing
  `<Toast />` mount pattern).

## Data flow

```
User clicks trash on a file row
  -> ConfirmDialog (accept)
  -> uploadApi.deleteDocument(id)        DELETE /api/documents/{id}
       route -> documents_service.delete_document
                  -> pgvector_store.delete_document_chunks (DB)
                  -> remove on-disk file
                  -> delete Document row + commit
       <- 204
  -> banner.refresh() -> getSessionIngestion -> re-render list
       (status null when no docs -> banner hides)
```

## Edge cases

- Delete a still-`pending` document: allowed. Cleanup removes whatever chunks
  exist. A background ingestion task still running for that `document_id` writes
  against a now-deleted FK target; treat as best-effort no-op. Acceptable for
  v1; note for future hardening (ingestion could check row existence before
  insert).
- Past chat-message citations referencing a deleted document: message text is
  immutable history and stays as-is. Only future `retrieve_chunks` calls exclude
  the deleted document.
- Concurrent double-delete: second call resolves to `404` (row already gone);
  frontend `refresh()` reconciles the list.
- Missing on-disk file at delete time: tolerated, deletion still succeeds.

## Testing

Backend (pytest):
- Delete success: `Document` row gone, `chunk_embeddings` for that id gone,
  on-disk file removed, returns `204`.
- Ownership: deleting another user's document returns `404`, leaves data intact.
- Missing document id returns `404`.
- Missing on-disk file does not break deletion.

Frontend (vitest):
- Banner expand/collapse toggle renders/hides the file list.
- File rows render filename + status (+ error on failed).
- Trash -> confirm accept calls `deleteDocument` then `refresh`.
- Trash -> confirm reject does not call `deleteDocument`.

## Files touched

- `backend/routes/documents.py` (new)
- `backend/main.py` (register router)
- `backend/services/documents_service.py` (add `delete_document`)
- `backend/services/pgvector_store.py` (add `delete_document_chunks`)
- `docs/api/openapi.yaml` (+ regenerated `backend/contracts/`)
- `frontend/src/services/uploadApi.js` (add `deleteDocument`)
- `frontend/src/components/chat/ReferenceStatusBanner.vue` (expand + delete)
- `frontend/src/main.js` (`ConfirmationService`)
- `frontend/src/App.vue` (`<ConfirmDialog />`)
- backend + frontend test files
