# Uploaded-Files Panel + Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see a per-file list of a chat session's uploaded reference files (with ingestion status) and delete any file, surfaced by expanding the existing reference-status banner.

**Architecture:** Backend gains a `DELETE /api/documents/{document_id}` endpoint that removes the DB row, the on-disk file, and the document's pgvector chunk embeddings (no FK cascade exists, so deletion is explicit). Frontend turns the existing collapsed `ReferenceStatusBanner` into an expandable per-file list with a confirm-guarded delete and a success toast. The per-document data is already fetched via `getSessionIngestion`; the banner just renders the array it already has.

**Tech Stack:** FastAPI + SQLAlchemy (SQLite in unit tests, Postgres+pgvector in live tests), Vue 3 `<script setup>` + PrimeVue (`ConfirmDialog`, Toast) + Vitest.

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml`, then run `python backend/scripts/gen_contracts.py`. Never hand-edit `backend/contracts/`. CI enforces zero drift.
- All backend routers mount under `prefix="/api"`.
- Ownership failures return `404` (not `403`) so other users' resources are not revealed.
- Delete is allowed regardless of session state (including ended sessions).
- File list shows all session files equally — no "new"/recency badge.
- Banner stays collapsed by default (no auto-expand); the collapsed header must keep showing aggregate status (uploading / indexing / ready / failed).
- `ChunkEmbedding` rows cannot be inserted on SQLite (Vector column). Unit tests that touch chunks must monkeypatch `pgvector_store`; real chunk SQL is tested only in the `TEST_DATABASE_URL`-gated live module.

---

### Task 1: pgvector chunk deletion (store layer)

**Files:**
- Modify: `backend/services/pgvector_store.py` (add `delete_document_chunks` after `insert_chunks`)
- Test: `backend/tests/test_pgvector_retrieval.py` (live-pg gated module; add one test)

**Interfaces:**
- Produces: `pgvector_store.delete_document_chunks(db: Session, document_id: int) -> int` — deletes all `chunk_embeddings` rows for `document_id`, commits, returns the count deleted.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_pgvector_retrieval.py` (uses existing `db` + `seeded_session` fixtures; the module is skipped unless `TEST_DATABASE_URL` is set):

```python
def test_delete_document_chunks_removes_only_that_document(db, seeded_session):
    """delete_document_chunks deletes the target doc's chunks (returns count) and
    leaves a second document's chunks in the same session intact."""
    sid = seeded_session["session_id"]
    doc_id = seeded_session["doc_id"]

    # Add a second document with one chunk in the SAME session.
    other = Document(session_id=sid, filename="keep.pdf", status="ready")
    db.add(other)
    db.commit()
    db.refresh(other)
    pgvector_store.insert_chunks(
        db, session_id=sid, document_id=other.id,
        rows=[(0, 1, "survivor chunk", _vec(4))],
    )

    # seeded_session inserts 3 chunks for doc_id.
    deleted = pgvector_store.delete_document_chunks(db, document_id=doc_id)
    assert deleted == 3

    # Target's chunks gone; the other document's chunk survives.
    survivors = pgvector_store.query_chunks(
        db, session_id=sid, query_embedding=_vec(4), k=10
    )
    assert [c.doc_id for c in survivors] == [other.id]

    # Teardown for the extra doc (seeded_session only cleans its own rows).
    db.execute(
        text("DELETE FROM chunk_embeddings WHERE document_id = :d"), {"d": other.id}
    )
    db.execute(text("DELETE FROM documents WHERE id = :d"), {"d": other.id})
    db.commit()
```

- [ ] **Step 2: Run test to verify it fails**

Run (needs a throwaway pgvector DB; CI sets this automatically):
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  pytest backend/tests/test_pgvector_retrieval.py::test_delete_document_chunks_removes_only_that_document -v
```
Expected: FAIL with `AttributeError: module 'services.pgvector_store' has no attribute 'delete_document_chunks'`.
(If `TEST_DATABASE_URL` is unset the test is SKIPPED — that is not a pass; set it to verify.)

- [ ] **Step 3: Write minimal implementation**

Add to `backend/services/pgvector_store.py` (after `insert_chunks`):

```python
from sqlalchemy import delete as _delete  # add to existing sqlalchemy import line


def delete_document_chunks(db: Session, document_id: int) -> int:
    """Delete all chunk embeddings for a document. Returns rows deleted.

    chunk_embeddings.document_id has no ON DELETE CASCADE, so callers deleting a
    Document must call this first to avoid orphaned vectors.
    """
    result = db.execute(
        _delete(ChunkEmbedding).where(ChunkEmbedding.document_id == document_id)
    )
    db.commit()
    return result.rowcount or 0
```

Note: the existing import line is `from sqlalchemy import select`. Change it to `from sqlalchemy import delete as _delete, select`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
  pytest backend/tests/test_pgvector_retrieval.py::test_delete_document_chunks_removes_only_that_document -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/pgvector_store.py backend/tests/test_pgvector_retrieval.py
git commit -m "feat(backend): add pgvector_store.delete_document_chunks"
```

---

### Task 2: Document deletion service

**Files:**
- Modify: `backend/services/documents_service.py` (add `delete_document` + a small not-found signal)
- Test: `backend/tests/test_documents_service.py` (add tests)

**Interfaces:**
- Consumes: `pgvector_store.delete_document_chunks(db, document_id)` (Task 1).
- Produces:
  - `documents_service.DocumentNotFound` — exception the route maps to HTTP 404.
  - `documents_service.delete_document(db: Session, document_id: int, user_id: str) -> None` — verifies the document exists and its session belongs to `user_id`, then deletes chunks, the on-disk file, and the `Document` row (commit). Raises `DocumentNotFound` if missing or not owned.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_documents_service.py` (imports `Document`, `Session as SessionModel`, `User` from `db.models`; uses the `db_session` fixture from conftest). Add at top of file if not present:

```python
import pytest
from db.models import Document, Session as SessionModel, User
from services import documents_service
```

Tests:

```python
def _seed_doc(db, *, user_id="u1", session_id="s1", filename="notes.pdf"):
    db.add(User(id=user_id))
    db.flush()
    db.add(SessionModel(id=session_id, user_id=user_id, topic="t", topic_profile_json="{}"))
    db.flush()
    doc = Document(session_id=session_id, filename=filename, status="ready")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def test_delete_document_removes_row_chunks_and_file(db_session, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: calls.append(document_id) or 3,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))

    doc = _seed_doc(db_session)
    disk = tmp_path / f"{doc.id}_{doc.filename}"
    disk.write_bytes(b"%PDF-fake")

    documents_service.delete_document(db_session, document_id=doc.id, user_id="u1")

    assert calls == [doc.id]
    assert db_session.get(Document, doc.id) is None
    assert not disk.exists()


def test_delete_document_missing_raises_not_found(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    with pytest.raises(documents_service.DocumentNotFound):
        documents_service.delete_document(db_session, document_id=999, user_id="u1")


def test_delete_document_other_user_raises_not_found(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    doc = _seed_doc(db_session, user_id="owner", session_id="s_owner")
    with pytest.raises(documents_service.DocumentNotFound):
        documents_service.delete_document(db_session, document_id=doc.id, user_id="intruder")
    # Row must remain intact.
    assert db_session.get(Document, doc.id) is not None


def test_delete_document_tolerates_missing_file(db_session, monkeypatch, tmp_path):
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))
    doc = _seed_doc(db_session)
    # No file on disk.
    documents_service.delete_document(db_session, document_id=doc.id, user_id="u1")
    assert db_session.get(Document, doc.id) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && pytest tests/test_documents_service.py -k delete_document -v
```
Expected: FAIL — `AttributeError: module 'services.documents_service' has no attribute 'DocumentNotFound'` / `delete_document`.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/services/documents_service.py`. Update the imports at the top:

```python
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db.models import Document, Session as SessionModel
from services import pgvector_store
```

(Keep the existing `from db.models import Document` — merge `Session as SessionModel` into it. The existing `Iterable`/`Literal` imports stay.)

Add at the end of the file:

```python
class DocumentNotFound(Exception):
    """Raised when a document does not exist or is not owned by the caller."""


def delete_document(db: Session, document_id: int, user_id: str) -> None:
    """Delete a document: its chunk embeddings, on-disk file, and DB row.

    Raises DocumentNotFound if the document does not exist or its session is not
    owned by user_id (callers map this to HTTP 404 so existence is not leaked).
    """
    row = db.execute(
        select(Document, SessionModel.user_id)
        .join(SessionModel, Document.session_id == SessionModel.id)
        .where(Document.id == document_id)
    ).first()
    if row is None:
        raise DocumentNotFound(str(document_id))
    doc, owner_id = row
    if owner_id != user_id:
        raise DocumentNotFound(str(document_id))

    pgvector_store.delete_document_chunks(db, document_id)

    disk_path = Path(settings.uploads_path) / f"{doc.id}_{doc.filename}"
    disk_path.unlink(missing_ok=True)

    db.delete(doc)
    db.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && pytest tests/test_documents_service.py -k delete_document -v
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/documents_service.py backend/tests/test_documents_service.py
git commit -m "feat(backend): add documents_service.delete_document with ownership check"
```

---

### Task 3: DELETE endpoint + contract

**Files:**
- Create: `backend/routes/documents.py`
- Modify: `backend/main.py` (register router)
- Modify: `docs/api/openapi.yaml` (add DELETE path), then regenerate `backend/contracts/`
- Test: `backend/tests/test_documents_route.py` (new)

**Interfaces:**
- Consumes: `documents_service.delete_document`, `documents_service.DocumentNotFound` (Task 2); `current_user_id`, `get_db`.
- Produces: `DELETE /api/documents/{document_id}` -> `204 No Content` on success; `404` when missing/not owned.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_documents_route.py`:

```python
"""TDD: DELETE /api/documents/{document_id}."""

import pytest

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User


OWNER = "owner1"
SESSION_ID = "sess_del"


@pytest.fixture
def seeded(db_session):
    db_session.add(User(id=OWNER))
    db_session.flush()
    db_session.add(
        SessionModel(
            id=SESSION_ID,
            user_id=OWNER,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    doc = Document(session_id=SESSION_ID, filename="notes.pdf", status="ready")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)
    return doc


@pytest.fixture(autouse=True)
def stub_chunk_delete(monkeypatch):
    """SQLite can't hold ChunkEmbedding rows; stub the vector delete."""
    monkeypatch.setattr(
        "services.documents_service.pgvector_store.delete_document_chunks",
        lambda db, document_id: 0,
    )


@pytest.fixture(autouse=True)
def stub_filesystem(monkeypatch, tmp_path):
    monkeypatch.setattr("services.documents_service.settings.uploads_path", str(tmp_path))


def test_delete_returns_204_and_removes_row(client, seeded, db_session):
    r = client.delete(f"/api/documents/{seeded.id}", params={"user_id": OWNER})
    assert r.status_code == 204, r.text
    assert db_session.get(Document, seeded.id) is None


def test_delete_other_users_document_404(client, seeded, db_session):
    r = client.delete(f"/api/documents/{seeded.id}", params={"user_id": "intruder"})
    assert r.status_code == 404
    assert db_session.get(Document, seeded.id) is not None


def test_delete_missing_document_404(client, seeded):
    r = client.delete("/api/documents/999999", params={"user_id": OWNER})
    assert r.status_code == 404
```

(The conftest `_AuthInjectingClient` turns `params={"user_id": ...}` into `Authorization: Bearer test-<user_id>`.)

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd backend && pytest tests/test_documents_route.py -v
```
Expected: FAIL — `404` for all (route not registered yet), so `test_delete_returns_204...` fails on the status assertion.

- [ ] **Step 3: Write minimal implementation**

Create `backend/routes/documents.py`:

```python
"""DELETE /api/documents/{document_id} — remove an uploaded reference file."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db.database import get_db
from services import documents_service
from services.auth import current_user_id

router = APIRouter(prefix="/api")


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    try:
        documents_service.delete_document(db, document_id=document_id, user_id=user_id)
    except documents_service.DocumentNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="document_not_found")
```

Register in `backend/main.py` — add the import alongside the other route imports and the include alongside the others:

```python
from routes import documents  # add near the other `from routes import ...` lines
```
```python
app.include_router(documents.router)  # add after app.include_router(upload.router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd backend && pytest tests/test_documents_route.py -v
```
Expected: PASS (3 tests).

- [ ] **Step 5: Update the API contract**

Edit `docs/api/openapi.yaml`. Under the existing `/api/upload/{document_id}:` path block, add a `delete:` operation (sibling of the existing `get:`):

```yaml
  /api/documents/{document_id}:
    delete:
      tags: [documents]
      summary: Delete an uploaded reference document and its embeddings.
      operationId: deleteDocument
      parameters:
        - in: path
          name: document_id
          required: true
          schema: { type: integer }
      responses:
        "204":
          description: Document deleted.
        "404":
          $ref: "#/components/responses/NotFound"
```

Place this new path block adjacent to `/api/upload/{document_id}:` (before `/api/profile/aggregate:`).

- [ ] **Step 6: Regenerate contracts + verify no drift**

Run:
```bash
python backend/scripts/gen_contracts.py
git status --porcelain backend/contracts
```
Expected: codegen runs clean. (This endpoint has no request/response body schema, so `backend/contracts/` may be unchanged — that is fine. The point is to confirm the generator still runs without error and produces no unexpected drift.)

- [ ] **Step 7: Commit**

```bash
git add backend/routes/documents.py backend/main.py docs/api/openapi.yaml backend/contracts backend/tests/test_documents_route.py
git commit -m "feat(backend): add DELETE /api/documents/{id} endpoint + contract"
```

---

### Task 4: Frontend delete API client

**Files:**
- Modify: `frontend/src/services/apiClient.js` (add `apiDelete`)
- Modify: `frontend/src/services/uploadApi.js` (add `deleteDocument`)
- Test: `frontend/src/__tests__/uploadApi.test.js` (add a test)

**Interfaces:**
- Produces:
  - `apiDelete(path, opts?)` — issues a `DELETE` via the shared `request()` helper.
  - `deleteDocument(documentId)` — calls `DELETE /documents/{documentId}`; resolves on success, throws `ApiError` on failure.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/__tests__/uploadApi.test.js`:

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { deleteDocument } from '@/services/uploadApi.js'

describe('deleteDocument', () => {
  afterEach(() => vi.restoreAllMocks())

  it('issues DELETE to /documents/{id}', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    await deleteDocument(7)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toMatch(/\/documents\/7$/)
    expect(init.method).toBe('DELETE')
  })

  it('throws ApiError on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }))
    await expect(deleteDocument(7)).rejects.toThrow(/404/)
  })
})
```

(If the existing test file already imports from `uploadApi.js`, add `deleteDocument` to that import instead of duplicating.)

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd frontend && npm run test:unit -- --run src/__tests__/uploadApi.test.js
```
Expected: FAIL — `deleteDocument is not a function` / no export.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/services/apiClient.js`, add next to the other exports at the bottom:

```javascript
export const apiDelete = (path, opts = {}) => request('DELETE', path, { ...opts })
```

In `frontend/src/services/uploadApi.js`, update the import and add the function:

```javascript
import { ApiError, apiGet, apiDelete } from './apiClient.js'
```
```javascript
// silent: true — the banner's delete handler is the sole error surface. Without
// it, request()/errorBus would auto-toast non-404 failures AND the component's
// catch would toast again (double toast).
export const deleteDocument = (documentId) => apiDelete(`/documents/${documentId}`, { silent: true })
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd frontend && npm run test:unit -- --run src/__tests__/uploadApi.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/services/uploadApi.js frontend/src/__tests__/uploadApi.test.js
git commit -m "feat(frontend): add deleteDocument API client helper"
```

---

### Task 5: Expandable banner with per-file list + delete

**Files:**
- Modify: `frontend/src/main.js` (register `ConfirmationService`)
- Modify: `frontend/src/App.vue` (mount global `<ConfirmDialog />`)
- Modify: `frontend/src/components/chat/ReferenceStatusBanner.vue` (expand + per-file list + delete)
- Test: `frontend/src/__tests__/referenceStatusBanner.test.js` (extend)

**Interfaces:**
- Consumes: `deleteDocument(documentId)` (Task 4); `getSessionIngestion` (existing); PrimeVue `useConfirm`, `useToast` (existing wrapper `@/composables/useToast.js`).
- Produces: no new exports; behavioral changes only. The existing `defineExpose({ refresh })` contract is preserved.

- [ ] **Step 1: Wire ConfirmationService + ConfirmDialog**

WARNING: this wiring has NO automated gate. The Task 5 component tests mock
`primevue/useconfirm`, so a missing `app.use(ConfirmationService)` still passes
CI and only fails at runtime (`useConfirm().require` is undefined). Task 6
Step 4 (manual smoke) is the only check — do not skip it.

In `frontend/src/main.js`, add the import and registration next to `ToastService`:

```javascript
import ConfirmationService from 'primevue/confirmationservice'
```
```javascript
  app.use(ToastService)
  app.use(ConfirmationService)
```

In `frontend/src/App.vue`, add the import and mount it beside `<Toast />`:

```javascript
import ConfirmDialog from 'primevue/confirmdialog'
```
```html
  <Toast position="top-right" />
  <ConfirmDialog />
```

- [ ] **Step 2: Write the failing tests**

Replace the mock block at the top of `frontend/src/__tests__/referenceStatusBanner.test.js` so it also mocks `deleteDocument`, and stub PrimeVue's `useConfirm`/`useToast`. Add these alongside the existing tests:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ReferenceStatusBanner from '@/components/chat/ReferenceStatusBanner.vue'

const getSessionIngestion = vi.fn()
const deleteDocument = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  getSessionIngestion: (...a) => getSessionIngestion(...a),
  deleteDocument: (...a) => deleteDocument(...a),
}))

// Capture the confirm config so a test can invoke accept/reject deterministically.
let lastConfirm = null
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: (cfg) => { lastConfirm = cfg } }),
}))
const showSuccess = vi.fn()
const showError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({
  useToast: () => ({ showSuccess, showError, showWarn: vi.fn() }),
}))

beforeEach(() => {
  getSessionIngestion.mockReset()
  deleteDocument.mockReset()
  showSuccess.mockReset()
  showError.mockReset()
  lastConfirm = null
})

it('expands to show a per-file list with filenames', async () => {
  getSessionIngestion.mockResolvedValue({
    status: 'ready',
    documents: [
      { id: 1, filename: 'a.pdf', status: 'ready' },
      { id: 2, filename: 'b.md', status: 'pending' },
    ],
  })
  const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
  await flushPromises()
  // List hidden until expanded.
  expect(wrapper.find('[data-testid="ref-file-list"]').exists()).toBe(false)
  await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
  expect(wrapper.get('[data-testid="ref-file-list"]').text()).toContain('a.pdf')
  expect(wrapper.get('[data-testid="ref-file-list"]').text()).toContain('b.md')
})

it('deletes a file on confirm-accept and shows a success toast', async () => {
  getSessionIngestion.mockResolvedValue({
    status: 'ready',
    documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
  })
  deleteDocument.mockResolvedValue(undefined)
  const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
  await flushPromises()
  await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
  await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
  // Simulate the user accepting the confirm dialog.
  await lastConfirm.accept()
  await flushPromises()
  expect(deleteDocument).toHaveBeenCalledWith(1)
  expect(showSuccess).toHaveBeenCalled()
})

it('does not delete when confirm is rejected', async () => {
  getSessionIngestion.mockResolvedValue({
    status: 'ready',
    documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
  })
  const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
  await flushPromises()
  await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
  await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
  if (lastConfirm.reject) await lastConfirm.reject()
  expect(deleteDocument).not.toHaveBeenCalled()
})

it('shows an error toast and refreshes when delete fails', async () => {
  getSessionIngestion.mockResolvedValue({
    status: 'ready',
    documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
  })
  deleteDocument.mockRejectedValue(new Error('500'))
  const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
  await flushPromises()
  getSessionIngestion.mockClear() // count only refresh-driven refetches below
  await wrapper.get('[data-testid="ref-toggle"]').trigger('click')
  await wrapper.get('[data-testid="ref-delete-1"]').trigger('click')
  await lastConfirm.accept()
  await flushPromises()
  expect(showError).toHaveBeenCalled()
  expect(showSuccess).not.toHaveBeenCalled()
  expect(getSessionIngestion).toHaveBeenCalled() // refresh() ran in the catch
})
```

Keep the existing tests in the file (collapsed-header status assertions) — they verify no regression. They mount the same component; the new uploadApi mock now also exports `deleteDocument`, which they don't use.

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd frontend && npm run test:unit -- --run src/__tests__/referenceStatusBanner.test.js
```
Expected: FAIL — no `[data-testid="ref-toggle"]` / `ref-file-list` / `ref-delete-1` elements yet.

- [ ] **Step 4: Implement the expandable banner**

Rewrite `frontend/src/components/chat/ReferenceStatusBanner.vue`. Template:

```html
<template>
  <div
    v-if="status"
    class="ref-status"
    :class="`is-${status}`"
    data-testid="reference-status"
  >
    <button
      type="button"
      class="ref-header"
      data-testid="ref-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <i :class="iconClass" aria-hidden="true" />
      <span class="ref-text" role="status" aria-live="polite">{{ message }}</span>
      <i class="pi" :class="expanded ? 'pi-chevron-up' : 'pi-chevron-down'" aria-hidden="true" />
    </button>

    <ul v-if="expanded" class="ref-file-list" data-testid="ref-file-list">
      <li v-for="doc in documents" :key="doc.id" class="ref-file-row">
        <span class="ref-file-name">{{ doc.filename }}</span>
        <span class="ref-file-status" :class="`is-${doc.status}`">{{ doc.status }}</span>
        <span v-if="doc.status === 'failed' && doc.error" class="ref-file-error">{{ doc.error }}</span>
        <button
          type="button"
          class="ref-file-delete"
          :data-testid="`ref-delete-${doc.id}`"
          :aria-label="`Delete ${doc.filename}`"
          @click="confirmDelete(doc)"
        >
          <i class="pi pi-trash" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
```

Script — extend the existing `<script setup>` (keep `status`, `documents`, `poll`, `refresh`, the generation-counter logic, `message`, `iconClass`, and `defineExpose({ refresh })` exactly as they are; add the marked pieces):

```javascript
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useConfirm } from 'primevue/useconfirm'

import { getSessionIngestion, deleteDocument } from '../../services/uploadApi.js'
import { useToast } from '../../composables/useToast.js'

// ... existing props, status, documents, timer, stopped, generation,
//     readyCount/failedCount/total, message, iconClass, poll, refresh,
//     watch, onMounted, onUnmounted all stay unchanged ...

const expanded = ref(false)
const confirm = useConfirm()
const { showSuccess, showError } = useToast()

function confirmDelete(doc) {
  confirm.require({
    message: `Remove "${doc.filename}" from this chat? This deletes the file and its indexed content.`,
    header: 'Delete file',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await deleteDocument(doc.id)
        showSuccess(`${doc.filename} removed.`)
        refresh()
      } catch {
        showError(`Could not delete ${doc.filename}. Please try again.`)
        refresh()
      }
    },
  })
}

defineExpose({ refresh })
```

Add styles (append to the existing `<style scoped>`):

```css
.ref-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font: inherit;
  text-align: left;
}
.ref-header .pi-chevron-up,
.ref-header .pi-chevron-down {
  margin-left: auto;
}
.ref-file-list {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.ref-file-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}
.ref-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ref-file-status {
  color: var(--color-text-muted);
  text-transform: capitalize;
}
.ref-file-status.is-failed {
  color: var(--color-error-text);
}
.ref-file-error {
  color: var(--color-error-text);
  font-size: 0.75rem;
}
.ref-file-delete {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-muted);
  padding: 0.2rem;
  border-radius: var(--radius-sm);
}
.ref-file-delete:hover {
  color: var(--color-error-text);
}
```

Note: the previous root element carried `role="status"` / `aria-live="polite"`; those move onto the `.ref-text` span so the live-region announcement is preserved without making the whole expandable region a live region.

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd frontend && npm run test:unit -- --run src/__tests__/referenceStatusBanner.test.js
```
Expected: PASS (existing status/refetch tests + 3 new ones).

- [ ] **Step 6: Run lint + the full unit suite**

Run:
```bash
cd frontend && npm run lint && npm run test:unit -- --run
```
Expected: lint clean; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/main.js frontend/src/App.vue frontend/src/components/chat/ReferenceStatusBanner.vue frontend/src/__tests__/referenceStatusBanner.test.js
git commit -m "feat(frontend): expandable reference banner with per-file delete"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Backend suite**

Run:
```bash
cd backend && pytest
```
Expected: all pass (live pgvector test from Task 1 is SKIPPED unless `TEST_DATABASE_URL` is set — that is expected locally; CI runs it).

- [ ] **Step 2: Contract drift check**

Run:
```bash
python backend/scripts/gen_contracts.py
git status --porcelain
```
Expected: no unstaged changes (zero drift).

- [ ] **Step 3: Frontend suite + lint**

Run:
```bash
cd frontend && npm run lint && npm run test:unit -- --run
```
Expected: all green.

- [ ] **Step 4: Manual smoke (document for the PR; requires running stack + a real upload)**

With `docker compose up` and a logged-in user: open a session, upload a file, confirm the collapsed banner shows indexing -> ready; expand it, confirm the file is listed with status; delete it, confirm the confirm-dialog appears, the success toast fires, the row disappears, and (when it was the only file) the banner hides. Record the result in the PR description.

---

## Self-Review

**Spec coverage:**
- Expandable per-file list -> Task 5.
- Show whenever session has files (status non-null) -> existing `v-if="status"` preserved (Task 5).
- Collapsed header keeps aggregate status -> preserved `message`/`iconClass` + regression tests (Task 5 Step 2).
- Per-file delete -> Tasks 1-5.
- `DELETE /api/documents/{id}`, 404 ownership -> Task 3.
- Cleanup of DB row + disk file + chunks -> Tasks 1-2.
- PrimeVue ConfirmDialog -> Task 5 Step 1 + `confirmDelete`.
- Success toast -> Task 5.
- Contract codegen -> Task 3 Steps 5-6.
- Delete allowed on ended session -> no session-state check in service/route (Tasks 2-3).
- Edge cases (missing file tolerated, missing/other-user 404, double-delete -> 404) -> Tasks 2-3.

**Placeholder scan:** none — every code/test step has concrete content.

**Type consistency:** `delete_document_chunks(db, document_id) -> int` (Task 1) consumed in Task 2; `DocumentNotFound` + `delete_document(db, document_id, user_id)` (Task 2) consumed in Task 3; `deleteDocument(documentId)` (Task 4) consumed in Task 5; `refresh` exposure preserved. Test ids `ref-toggle` / `ref-file-list` / `ref-delete-{id}` match between component and tests.
