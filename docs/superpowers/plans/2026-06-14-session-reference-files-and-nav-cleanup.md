# Reference Files at Session Creation + Back-Button Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach reference documents (PDF, PPTX, TXT, MD) when creating a session, ingested in the background with a live status banner; and remove redundant back buttons from top-level screens.

**Architecture:** Session creation stays a two-step client flow — `POST /api/sessions` then `POST /api/upload` per file — then navigates immediately. Ingestion gains a per-extension extraction dispatcher. A new shared `documents_service` provides session-wide aggregate status and a ready-document gate, replacing five duplicated "latest document" lookups (fixing a retrieval bug where a newer pending upload masked an older ready one). A new `GET /api/sessions/{id}/ingestion` endpoint feeds a frontend polling banner.

**Tech Stack:** FastAPI + SQLAlchemy + pgvector, pypdf + python-pptx, Pydantic contracts codegen (datamodel-code-generator from OpenAPI), Vue 3 + Pinia + Vite, pytest + vitest.

**Source spec:** `docs/superpowers/specs/2026-06-14-session-reference-files-and-nav-cleanup-design.md`

**Branch:** `feat/session-reference-files` (already created; spec committed at `0131f6f`).

---

## File Structure

**Backend — create:**
- `backend/services/documents_service.py` — session-wide document status aggregation + ready gate.
- `backend/tests/test_documents_service.py` — unit tests for the aggregate helper.

**Backend — modify:**
- `docs/api/openapi.yaml` — new `/api/sessions/{id}/ingestion` path; `SessionIngestionStatus` + `DocumentStatus` schemas; updated `/api/upload` description.
- `backend/contracts/models.py` — regenerated (do not hand-edit).
- `backend/routes/sessions.py` — new endpoint; rewire `_to_response`, `get_session`, `complete_check` to the aggregate helper; drop `_latest_ingestion_status`.
- `backend/routes/chat.py` — rewire ingestion status to the aggregate helper.
- `backend/services/retrieval_service.py` — gate on `has_ready_document` instead of latest-doc.
- `backend/services/ingestion_service.py` — per-extension extraction dispatcher (`_extract`, `_extract_slides`, `_extract_plaintext`).
- `backend/routes/upload.py` — extension-based validation replacing the PDF-only content-type check.
- `backend/pyproject.toml` — add `python-pptx` dependency.
- `backend/tests/test_upload_route.py`, `backend/tests/test_ingestion_service.py`, `backend/tests/test_sessions_route.py` — updated/added tests.

**Frontend — create:**
- `frontend/src/components/chat/ReferenceStatusBanner.vue` — polls ingestion status, renders an aggregate banner.
- `frontend/src/__tests__/referenceStatusBanner.test.js` — banner poll-state tests.

**Frontend — modify:**
- `frontend/src/services/uploadApi.js` — `ACCEPT_ATTR`, `ACCEPTED_EXTENSIONS`, `validateFile`, `uploadDocument` (alias `uploadPdf`), `getSessionIngestion`.
- `frontend/src/views/NewSessionView.vue` — optional multi-file attach + submit orchestration; remove back button.
- `frontend/src/views/SessionView.vue` — mount the banner; broaden `onAttachFile` validation.
- `frontend/src/components/chat/Composer.vue` — broaden `accept` + labels.
- `frontend/src/views/SettingsView.vue`, `frontend/src/views/AggregateProfileView.vue` — remove back button.
- `frontend/src/__tests__/newSessionView.test.js`, `settingsView.test.js`, `aggregateProfileView.test.js` — updated tests.

---

## Task 1: OpenAPI contract — ingestion-status endpoint + schemas

**Files:**
- Modify: `docs/api/openapi.yaml` (paths after line 212; schemas near line 800; upload description line 217)
- Modify (generated): `backend/contracts/models.py`

- [ ] **Step 1: Add the new path after the reopen path**

In `docs/api/openapi.yaml`, immediately after the `/api/sessions/{session_id}/reopen` block (ends at line 212, before `/api/upload:` at line 214), insert:

```yaml
  /api/sessions/{session_id}/ingestion:
    get:
      tags: [sessions]
      summary: Aggregate ingestion status for a session's reference documents.
      operationId: getSessionIngestion
      parameters:
        - $ref: "#/components/parameters/SessionId"
      responses:
        "200":
          description: Session-wide ingestion status plus per-document detail.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SessionIngestionStatus"
        "404":
          $ref: "#/components/responses/NotFound"
```

- [ ] **Step 2: Broaden the upload endpoint description**

In `docs/api/openapi.yaml`, replace line 217:

```yaml
      summary: Upload a PDF to attach to a session (background ingestion).
```

with:

```yaml
      summary: Upload a reference file (PDF, PPTX, TXT, or MD) to attach to a session (background ingestion).
      description: |
        Accepted file types are validated by extension: .pdf, .pptx, .txt, .md
        (.markdown is also accepted). The 25 MB per-request cap and background
        ingestion behaviour are unchanged.
```

- [ ] **Step 3: Add the two schemas after UploadStatus**

In `docs/api/openapi.yaml`, after the `UploadStatus` schema block (ends at line 801, before `ProfileResponse:` at line 803), insert:

```yaml
    DocumentStatus:
      type: object
      additionalProperties: false
      required: [id, filename, status]
      description: Ingestion state for one uploaded document.
      properties:
        id:       { type: integer }
        filename: { type: string }
        status:   { $ref: "#/components/schemas/IngestionStatus" }
        error:    { type: [string, "null"], default: null }

    SessionIngestionStatus:
      type: object
      additionalProperties: false
      required: [status, documents]
      description: |
        Session-wide ingestion aggregate. `status` is `pending` if any document
        is still ingesting, else `ready` if any document is ready, else `failed`,
        else null when the session has no documents.
      properties:
        status:
          oneOf:
            - $ref: "#/components/schemas/IngestionStatus"
            - type: "null"
          default: null
        documents:
          type: array
          items: { $ref: "#/components/schemas/DocumentStatus" }
```

- [ ] **Step 4: Regenerate contracts**

Run: `python backend/scripts/gen_contracts.py`
Expected: `ok: contracts written to .../backend/contracts/models.py`

- [ ] **Step 5: Verify the new models exist and there is no other drift**

Run: `git diff --stat backend/contracts/models.py`
Expected: `models.py` changed. Confirm it now defines `class DocumentStatus` and `class SessionIngestionStatus`:

Run: `grep -n "class SessionIngestionStatus\|class DocumentStatus" backend/contracts/models.py`
Expected: both classes present.

- [ ] **Step 6: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/models.py
git commit -m "feat(contract): add session ingestion-status endpoint + schemas"
```

---

## Task 2: documents_service — session-wide status aggregation

**Files:**
- Create: `backend/services/documents_service.py`
- Test: `backend/tests/test_documents_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_documents_service.py`:

```python
"""TDD: services.documents_service aggregate status + ready gate."""

from contracts import TopicProfile
from db.models import Document, Session as SessionModel, User
from services import documents_service


SID = "sess_docs"
UID = "u_docs"


def _seed_session(db):
    db.add(User(id=UID))
    db.flush()
    db.add(
        SessionModel(
            id=SID,
            user_id=UID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db.commit()


def _add_doc(db, status):
    doc = Document(session_id=SID, filename=f"{status}.pdf", status=status)
    db.add(doc)
    db.commit()


def test_status_none_when_no_documents(db_session):
    _seed_session(db_session)
    assert documents_service.session_ingestion_status(db_session, SID) is None
    assert documents_service.has_ready_document(db_session, SID) is False


def test_status_pending_when_any_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    assert documents_service.session_ingestion_status(db_session, SID) == "pending"


def test_status_ready_when_any_ready_and_none_pending(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "ready"
    assert documents_service.has_ready_document(db_session, SID) is True


def test_status_failed_when_all_failed(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "failed")
    _add_doc(db_session, "failed")
    assert documents_service.session_ingestion_status(db_session, SID) == "failed"
    assert documents_service.has_ready_document(db_session, SID) is False


def test_list_document_statuses_orders_oldest_first(db_session):
    _seed_session(db_session)
    _add_doc(db_session, "ready")
    _add_doc(db_session, "pending")
    docs = documents_service.list_document_statuses(db_session, SID)
    assert [d.status for d in docs] == ["ready", "pending"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_documents_service.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'services.documents_service'` (or ImportError).

- [ ] **Step 3: Write the implementation**

Create `backend/services/documents_service.py`:

```python
"""Session-wide document ingestion status (Spec: reference-files design 2026-06-14).

Replaces the per-call-site "latest document" lookups that previously decided
retrieval readiness and `ingestion_status`. Those keyed on the most-recent
document only, so a newer pending/failed upload masked an older ready one.
These helpers aggregate across all of a session's documents instead.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import Document


def session_ingestion_status(db: Session, session_id: str) -> str | None:
    """pending if any doc pending, else ready if any ready, else failed, else None."""
    statuses = set(
        db.execute(
            select(Document.status).where(Document.session_id == session_id)
        ).scalars().all()
    )
    if not statuses:
        return None
    if "pending" in statuses:
        return "pending"
    if "ready" in statuses:
        return "ready"
    return "failed"


def has_ready_document(db: Session, session_id: str) -> bool:
    return (
        db.execute(
            select(Document.id)
            .where(Document.session_id == session_id, Document.status == "ready")
            .limit(1)
        ).first()
        is not None
    )


def list_document_statuses(db: Session, session_id: str) -> list[Document]:
    return db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.asc(), Document.id.asc())
    ).scalars().all()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_documents_service.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/documents_service.py backend/tests/test_documents_service.py
git commit -m "feat(backend): add documents_service session-wide ingestion aggregate"
```

---

## Task 3: GET /api/sessions/{id}/ingestion endpoint

**Files:**
- Modify: `backend/routes/sessions.py:15-37` (imports), after line 324 (new handler)
- Test: `backend/tests/test_sessions_route.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sessions_route.py`:

```python
def test_get_session_ingestion_aggregates_documents(client, db_session, seeded_user):
    from db.models import Document

    db_session.add(
        SessionModel(
            id="s_ing",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    db_session.add(Document(session_id="s_ing", filename="a.pdf", status="ready"))
    db_session.add(Document(session_id="s_ing", filename="b.pptx", status="pending"))
    db_session.commit()

    r = client.get(f"/api/sessions/s_ing/ingestion?user_id={USER_ID}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert len(body["documents"]) == 2
    assert {d["filename"] for d in body["documents"]} == {"a.pdf", "b.pptx"}


def test_get_session_ingestion_404_for_wrong_user(client, db_session, seeded_user):
    db_session.add(User(id="other2"))
    db_session.add(
        SessionModel(
            id="s_ing_owned",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get("/api/sessions/s_ing_owned/ingestion?user_id=other2")
    assert r.status_code == 404


def test_get_session_ingestion_empty_when_no_documents(client, db_session, seeded_user):
    db_session.add(
        SessionModel(
            id="s_ing_empty",
            user_id=USER_ID,
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.commit()
    r = client.get(f"/api/sessions/s_ing_empty/ingestion?user_id={USER_ID}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] is None
    assert body["documents"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_sessions_route.py::test_get_session_ingestion_aggregates_documents -v`
Expected: FAIL with 404 (route not found) or assertion error.

- [ ] **Step 3: Add imports**

In `backend/routes/sessions.py`, add to the `from contracts import (...)` block (lines 15-32) the two new names (keep alphabetical-ish ordering near the other Session* names):

```python
    SessionDetail,
    SessionEndResponse,
    SessionEndSummary,
    SessionIngestionStatus,
    SessionLibraryPage,
```

and add `DocumentStatus` to the same import block (place it before `Message`):

```python
    Citation,
    DocumentStatus,
    Message,
```

In the services import (line 35), add `documents_service`:

```python
from services import check_question_service, documents_service, profile_service, summary_service
```

- [ ] **Step 4: Add the handler after reopen_session**

In `backend/routes/sessions.py`, after the `reopen_session` handler (ends at line 324), insert:

```python
@router.get("/sessions/{session_id}/ingestion", response_model=SessionIngestionStatus)
def get_session_ingestion(
    session_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    docs = documents_service.list_document_statuses(db, session_id)
    return SessionIngestionStatus(
        status=documents_service.session_ingestion_status(db, session_id),
        documents=[
            DocumentStatus(id=d.id, filename=d.filename, status=d.status, error=d.error)
            for d in docs
        ],
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sessions_route.py -k ingestion -v`
Expected: the 3 new tests plus `test_get_single_ingestion_status_null_when_no_documents` pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/sessions.py backend/tests/test_sessions_route.py
git commit -m "feat(backend): GET /api/sessions/{id}/ingestion aggregate endpoint"
```

---

## Task 4: Rewire latest-doc sites to the aggregate + fix retrieval gate

**Files:**
- Modify: `backend/routes/sessions.py:48-68, 429-435`
- Modify: `backend/routes/chat.py:15, 18, 86-93`
- Modify: `backend/services/retrieval_service.py:17-18, 24-48`
- Test: `backend/tests/test_pgvector_retrieval.py` (regression) — or `backend/tests/test_documents_service.py` if no pgvector test exists; see Step 1.

- [ ] **Step 1: Write the failing retrieval regression test**

This proves the bug is fixed: an older `ready` document plus a newer `pending` document must still allow retrieval. Append to `backend/tests/test_documents_service.py` (it already seeds sessions/documents and does not need pgvector):

```python
def test_retrieval_gate_uses_any_ready_not_latest(db_session, monkeypatch):
    """Regression: a newer pending doc must NOT mask an older ready doc."""
    from agent.types import ToolContext
    from contracts import RetrieveChunksArgs
    from services import retrieval_service

    _seed_session(db_session)
    _add_doc(db_session, "ready")    # older
    _add_doc(db_session, "pending")  # newer — previously masked the ready one

    captured = {}

    def fake_embedding(model, input, **_):
        from types import SimpleNamespace
        return SimpleNamespace(data=[{"embedding": [0.1] * 8}])

    def fake_query_chunks(db, *, session_id, query_embedding, k):
        captured["called"] = True
        return []

    monkeypatch.setattr("services.retrieval_service.litellm.embedding", fake_embedding)
    monkeypatch.setattr(
        "services.retrieval_service.pgvector_store.query_chunks", fake_query_chunks
    )

    ctx = ToolContext(db=db_session, session_id=SID, user_id=UID, turn_started_at=None)
    result = retrieval_service.retrieve(
        db_session, ctx, RetrieveChunksArgs(session_id=SID, query="indexes", k=5)
    )
    # Before the fix this returned no_results with ingestion_status=pending and
    # never reached the vector store. Now the ready doc lets the search run.
    assert captured.get("called") is True
    assert result.status in ("ok", "no_results")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_documents_service.py::test_retrieval_gate_uses_any_ready_not_latest -v`
Expected: FAIL — `captured["called"]` is missing because the latest-doc gate short-circuits to `no_results` (the newest doc is `pending`).

- [ ] **Step 3: Fix the retrieval gate**

In `backend/services/retrieval_service.py`, replace the imports block (lines 17-18):

```python
from db.models import Document
from services import pgvector_store
```

with:

```python
from services import documents_service, pgvector_store
```

Then delete the `_latest_doc` helper (lines 24-30) and replace the gate (lines 41-48):

```python
    doc = _latest_doc(db, ctx.session_id)
    if doc is None or doc.status != "ready":
        return ToolResult(
            ok=True,
            status="no_results",
            error="ingestion_not_ready" if doc is None else f"ingestion_status={doc.status}",
            data={"chunks": []},
        )
```

with:

```python
    if not documents_service.has_ready_document(db, ctx.session_id):
        agg = documents_service.session_ingestion_status(db, ctx.session_id)
        return ToolResult(
            ok=True,
            status="no_results",
            error="ingestion_not_ready" if agg is None else f"ingestion_status={agg}",
            data={"chunks": []},
        )
```

- [ ] **Step 4: Run the retrieval regression test**

Run: `cd backend && pytest tests/test_documents_service.py::test_retrieval_gate_uses_any_ready_not_latest -v`
Expected: PASS.

- [ ] **Step 5: Rewire sessions.py**

In `backend/routes/sessions.py`, delete the `_latest_ingestion_status` helper (lines 48-55). Then replace its two usages — line 66 and line 277 — both currently:

```python
        ingestion_status=_latest_ingestion_status(db, row.id),
```

with:

```python
        ingestion_status=documents_service.session_ingestion_status(db, row.id),
```

Then in `complete_check`, replace lines 429-435:

```python
    latest_doc = db.execute(
        select(Document)
        .where(Document.session_id == session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    ingestion_status = latest_doc.status if latest_doc else None
```

with:

```python
    ingestion_status = documents_service.session_ingestion_status(db, session_id)
```

(`Document` is still imported in sessions.py and used elsewhere; leave the import.)

- [ ] **Step 6: Rewire chat.py**

In `backend/routes/chat.py`, change the model import (line 15) from:

```python
from db.models import ChatMessage, Document, Session as SessionModel, User
```

to:

```python
from db.models import ChatMessage, Session as SessionModel, User
```

Add `documents_service` to the services import (line 18):

```python
from services import check_question_service, cost_meter, documents_service, profile_service, rate_limit
```

Replace lines 87-93:

```python
    latest_doc = db.execute(
        select(Document)
        .where(Document.session_id == req.session_id)
        .order_by(Document.created_at.desc())
        .limit(1)
    ).scalars().first()
    ingestion_status = latest_doc.status if latest_doc else None
```

with:

```python
    ingestion_status = documents_service.session_ingestion_status(db, req.session_id)
```

- [ ] **Step 7: Run the full backend suite (catches import/regression fallout)**

Run: `cd backend && pytest -q`
Expected: all pass. Pay attention to `test_sessions_route.py` and any chat/retrieval tests.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/sessions.py backend/routes/chat.py backend/services/retrieval_service.py backend/tests/test_documents_service.py
git commit -m "refactor(backend): session-wide ingestion aggregate; fix retrieval masking bug"
```

---

## Task 5: Multi-format ingestion (PPTX + plaintext)

**Files:**
- Modify: `backend/pyproject.toml` (dependencies)
- Modify: `backend/services/ingestion_service.py:19-30, 47-49, 73-78`
- Test: `backend/tests/test_ingestion_service.py` (append)

- [ ] **Step 1: Add the python-pptx dependency**

In `backend/pyproject.toml`, find the `[project]` `dependencies` array containing `pypdf` and add directly below it:

```toml
    "python-pptx>=1.0.2",
```

Install it into the active environment:
Run: `cd backend && pip install "python-pptx>=1.0.2"`
Expected: `Successfully installed python-pptx-...`

- [ ] **Step 2: Write the failing tests**

Append to `backend/tests/test_ingestion_service.py`:

```python
def test_extract_plaintext_txt_and_md(tmp_path):
    from services import ingestion_service

    txt = tmp_path / "notes.txt"
    txt.write_text("Plain text reference content.", encoding="utf-8")
    assert ingestion_service._extract(str(txt), "notes.txt") == [
        (None, "Plain text reference content.")
    ]

    md = tmp_path / "notes.md"
    md.write_text("# Heading\n\nBody.", encoding="utf-8")
    assert ingestion_service._extract(str(md), "notes.md") == [
        (None, "# Heading\n\nBody.")
    ]


def test_extract_unknown_extension_raises(tmp_path):
    from services import ingestion_service

    f = tmp_path / "data.bin"
    f.write_bytes(b"\x00\x01")
    with pytest.raises(ValueError):
        ingestion_service._extract(str(f), "data.bin")


def test_extract_slides_uses_python_pptx(monkeypatch):
    from services import ingestion_service

    class FakeTextFrame:
        def __init__(self, text):
            self.text = text

    class FakeShape:
        def __init__(self, text):
            self.has_text_frame = True
            self.has_table = False
            self.text_frame = FakeTextFrame(text)

    class FakeSlide:
        def __init__(self, texts):
            self.shapes = [FakeShape(t) for t in texts]

    class FakePresentation:
        def __init__(self, _path):
            self.slides = [
                FakeSlide(["Title one", "Bullet a"]),
                FakeSlide(["Title two"]),
            ]

    monkeypatch.setattr("services.ingestion_service.Presentation", FakePresentation)
    pages = ingestion_service._extract("x.pptx", "x.pptx")
    assert pages[0][0] == 1 and "Title one" in pages[0][1] and "Bullet a" in pages[0][1]
    assert pages[1][0] == 2 and "Title two" in pages[1][1]


def test_run_txt_success(db_session, insert_capture, mock_embed, monkeypatch, tmp_path):
    from contracts import TopicProfile
    from db.models import Document, Session as SessionModel, User
    from sqlalchemy.orm import sessionmaker
    from services import ingestion_service

    db_session.add(User(id="u_txt"))
    db_session.flush()
    db_session.add(
        SessionModel(
            id="s_txt",
            user_id="u_txt",
            topic="sql",
            topic_profile_json=TopicProfile().model_dump_json(),
        )
    )
    db_session.flush()
    doc = Document(session_id="s_txt", filename="ref.txt", status="pending")
    db_session.add(doc)
    db_session.commit()
    db_session.refresh(doc)

    monkeypatch.setattr("services.ingestion_service.settings.uploads_path", str(tmp_path))
    (tmp_path / f"{doc.id}_ref.txt").write_text(
        "Indexes accelerate database queries. " * 20, encoding="utf-8"
    )
    monkeypatch.setattr(
        "services.ingestion_service.SessionLocal",
        sessionmaker(autocommit=False, autoflush=False, bind=db_session.get_bind()),
    )

    ingestion_service.run(doc.id)
    db_session.expire_all()
    refreshed = db_session.get(Document, doc.id)
    assert refreshed.status == "ready"
    assert refreshed.page_count is None
    assert len(insert_capture) == 1
    assert len(insert_capture[0]["rows"]) >= 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_ingestion_service.py -k "extract or txt" -v`
Expected: FAIL — `_extract` / `Presentation` not defined.

- [ ] **Step 4: Implement the dispatcher**

In `backend/services/ingestion_service.py`, add the import (after line 23 `from pypdf import PdfReader`):

```python
from pptx import Presentation
```

Update the module docstring step 2 (line 8-9) to read:

```python
  2. _extract(path, filename) -> [(page_num | None, text), ...] by extension.
```

Replace `_extract_pages` (lines 47-49) with the dispatcher and helpers:

```python
def _extract_pages(path: str) -> list[tuple[int, str]]:
    reader = PdfReader(path)
    return [(i + 1, (page.extract_text() or "")) for i, page in enumerate(reader.pages)]


def _extract_slides(path: str) -> list[tuple[int, str]]:
    prs = Presentation(path)
    out: list[tuple[int, str]] = []
    for i, slide in enumerate(prs.slides, start=1):
        parts: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                parts.append(shape.text_frame.text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    parts.append(" ".join(cell.text for cell in row.cells))
        out.append((i, "\n".join(p for p in parts if p)))
    return out


def _extract_plaintext(path: str) -> list[tuple[None, str]]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return [(None, fh.read())]


def _extract(path: str, filename: str) -> list[tuple[int | None, str]]:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".pdf":
        return _extract_pages(path)
    if ext == ".pptx":
        return _extract_slides(path)
    if ext in (".txt", ".md", ".markdown"):
        return _extract_plaintext(path)
    raise ValueError(f"unsupported file type: {ext!r}")
```

- [ ] **Step 5: Wire the dispatcher into run() and fix page_count**

In `backend/services/ingestion_service.py`, replace lines 74-76:

```python
            path = _resolve_path(doc)
            pages = _extract_pages(path)
            doc.page_count = len(pages)
```

with:

```python
            path = _resolve_path(doc)
            pages = _extract(path, doc.filename)
            doc.page_count = sum(1 for p, _ in pages if p is not None) or None
```

- [ ] **Step 6: Run the ingestion tests**

Run: `cd backend && pytest tests/test_ingestion_service.py -v`
Expected: all pass (existing PDF tests + new extract/txt tests). The existing `test_success_path` still asserts `page_count == 2` (PDF path unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/services/ingestion_service.py backend/tests/test_ingestion_service.py
git commit -m "feat(backend): ingest PPTX and plaintext alongside PDF"
```

---

## Task 6: Upload route — extension-based validation

**Files:**
- Modify: `backend/routes/upload.py:3, 29, 68-69`
- Test: `backend/tests/test_upload_route.py:55-58` (replace) + append

- [ ] **Step 1: Update the failing/changed tests**

In `backend/tests/test_upload_route.py`, replace `test_non_pdf_content_type_400` (lines 55-58):

```python
def test_non_pdf_content_type_400(client, seeded):
    files = {"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 400
```

with:

```python
def test_disallowed_extension_400(client, seeded):
    files = {"file": ("paper.docx", io.BytesIO(b"PK\x03\x04"), "application/octet-stream")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 400


def test_extensionless_filename_400(client, seeded):
    files = {"file": ("README", io.BytesIO(b"hello"), "text/plain")}
    r = client.post("/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files)
    assert r.status_code == 400


@pytest.mark.parametrize(
    "name,ctype",
    [
        ("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ("notes.txt", "text/plain"),
        ("notes.md", "text/markdown"),
        ("notes.md", "application/octet-stream"),
    ],
)
def test_allowed_non_pdf_types_202(client, seeded, name, ctype):
    files = {"file": (name, io.BytesIO(b"data-bytes"), ctype)}
    r = client.post(
        "/api/upload", data={"user_id": USER_ID, "session_id": SESSION_ID}, files=files
    )
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "pending"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_upload_route.py -k "allowed_non_pdf or extensionless or disallowed" -v`
Expected: FAIL — `.pptx`/`.txt`/`.md` currently 400 (PDF-only), and `.docx`/extensionless are not yet specifically handled.

- [ ] **Step 3: Implement extension validation**

In `backend/routes/upload.py`, confirm `from pathlib import Path` is imported (line 3 — it is). Add the allowed set after `MAX_UPLOAD_BYTES` (line 29):

```python
ALLOWED_EXTENSIONS = {".pdf", ".pptx", ".txt", ".md", ".markdown"}
```

Replace the content-type gate (lines 68-69):

```python
    if (file.content_type or "").split(";")[0].strip() != "application/pdf":
        raise HTTPException(status_code=400, detail="file must be application/pdf")
```

with:

```python
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="file type not supported; use PDF, PPTX, TXT, or MD",
        )
```

- [ ] **Step 4: Run the upload route tests**

Run: `cd backend && pytest tests/test_upload_route.py -v`
Expected: all pass, including the traversal test (`../../etc/passwd.pdf` keeps `.pdf`) and oversize test.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/upload.py backend/tests/test_upload_route.py
git commit -m "feat(backend): accept PPTX/TXT/MD uploads via extension validation"
```

---

## Task 7: uploadApi — shared validation, generic upload, status fetch

**Files:**
- Modify: `frontend/src/services/uploadApi.js`
- Test: `frontend/src/__tests__/uploadApi.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/uploadApi.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { validateFile, ACCEPT_ATTR, MAX_UPLOAD_BYTES } from '@/services/uploadApi.js'

function fakeFile(name, size) {
  return { name, size }
}

describe('validateFile', () => {
  it('accepts pdf, pptx, txt, md by extension', () => {
    for (const ext of ['ref.pdf', 'deck.PPTX', 'notes.txt', 'readme.md']) {
      expect(validateFile(fakeFile(ext, 1000)).ok).toBe(true)
    }
  })

  it('rejects unsupported extensions', () => {
    const r = validateFile(fakeFile('paper.docx', 1000))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/supported/i)
  })

  it('rejects oversize files', () => {
    const r = validateFile(fakeFile('big.pdf', MAX_UPLOAD_BYTES + 1))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/too large/i)
  })

  it('exposes an accept attribute string', () => {
    expect(ACCEPT_ATTR).toContain('.pdf')
    expect(ACCEPT_ATTR).toContain('.pptx')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run uploadApi`
Expected: FAIL — `validateFile`/`ACCEPT_ATTR` are not exported.

- [ ] **Step 3: Implement**

In `frontend/src/services/uploadApi.js`, add after the `MAX_UPLOAD_BYTES` export (line 9):

```javascript
export const ACCEPTED_EXTENSIONS = ['.pdf', '.pptx', '.txt', '.md', '.markdown']
export const ACCEPT_ATTR = '.pdf,.pptx,.txt,.md'

// Client-side pre-check only; the backend re-validates by extension and size.
export function validateFile(file) {
  const name = (file?.name || '').toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return {
      ok: false,
      reason: `${file?.name || 'File'} is not a supported type. Use PDF, PPTX, TXT, or MD.`,
    }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    return { ok: false, reason: `${file.name} is too large (max ${maxMb} MB).` }
  }
  return { ok: true }
}
```

Rename `uploadPdf` to `uploadDocument` and add a back-compat alias. Replace line 21 `export async function uploadPdf({ sessionId, file }) {` with:

```javascript
export async function uploadDocument({ sessionId, file }) {
```

Then after the function (after line 47 `}`), add:

```javascript
// Back-compat alias for existing PDF-only call sites.
export const uploadPdf = uploadDocument

export const getSessionIngestion = (sessionId) =>
  apiGet(`/sessions/${sessionId}/ingestion`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run uploadApi`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/uploadApi.js frontend/src/__tests__/uploadApi.test.js
git commit -m "feat(frontend): shared file validation + generic upload + ingestion fetch"
```

---

## Task 8: NewSessionView — optional multi-file attach + submit orchestration

**Files:**
- Modify: `frontend/src/views/NewSessionView.vue`
- Test: `frontend/src/__tests__/newSessionView.test.js` (append)

- [ ] **Step 1: Write the failing tests**

At the top of `frontend/src/__tests__/newSessionView.test.js`, after line 9 (the `vue-router` mock), add a mock for uploadApi:

```javascript
const uploadDocument = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  uploadDocument: (...a) => uploadDocument(...a),
  validateFile: (file) =>
    file.name.endsWith('.exe')
      ? { ok: false, reason: 'not supported' }
      : { ok: true },
  ACCEPT_ATTR: '.pdf,.pptx,.txt,.md',
}))
```

In the `beforeEach` (after `push.mockClear()`, line 22), add:

```javascript
    uploadDocument.mockReset()
    uploadDocument.mockResolvedValue({ document_id: 1 })
```

Append these tests inside the `describe` block:

```javascript
  it('adds valid attached files as chips and rejects invalid ones', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    const wrapper = mountView()
    const input = wrapper.get('[data-testid="new-file-input"]')
    const good = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
    const bad = new File(['b'], 'virus.exe', { type: 'application/octet-stream' })
    Object.defineProperty(input.element, 'files', { value: [good, bad], configurable: true })
    await input.trigger('change')
    expect(wrapper.findAll('[data-testid="new-file-chip"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="new-file-errors"]').text()).toMatch(/not supported/i)
  })

  it('submit uploads attached files then routes to the session', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-9' })
    const wrapper = mountView()
    await flushPromises()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    const input = wrapper.get('[data-testid="new-file-input"]')
    const f = new File(['a'], 'ref.pdf', { type: 'application/pdf' })
    Object.defineProperty(input.element, 'files', { value: [f], configurable: true })
    await input.trigger('change')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    expect(store.createSession).toHaveBeenCalled()
    expect(uploadDocument).toHaveBeenCalledWith({ sessionId: 'new-9', file: f })
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-9' } })
  })

  it('still routes when no files are attached', async () => {
    const store = useSessionStore()
    vi.spyOn(store, 'listSessions').mockResolvedValue([])
    vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'new-10' })
    const wrapper = mountView()
    await wrapper.get('[data-testid="new-topic"]').setValue('Calculus')
    await wrapper.get('[data-testid="new-submit"]').trigger('click')
    await flushPromises()
    expect(uploadDocument).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({ name: 'session', params: { id: 'new-10' } })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run newSessionView`
Expected: FAIL — no `new-file-input` element.

- [ ] **Step 3: Add the attach UI to the template**

In `frontend/src/views/NewSessionView.vue`, insert this block between the `quick-picks` div (closes at line 40) and the `warn` div (line 42):

```html
      <div class="attach">
        <input
          ref="fileInputEl"
          type="file"
          :accept="ACCEPT_ATTR"
          multiple
          data-testid="new-file-input"
          hidden
          @change="onFilesPicked"
        />
        <button type="button" class="attach-btn" data-testid="new-file-add" @click="openFilePicker">
          <i class="pi pi-paperclip" aria-hidden="true" />
          <span>Add reference files (optional)</span>
        </button>
        <p class="attach-hint">PDF, PPTX, TXT, or MD. The tutor can cite these during the session.</p>

        <ul v-if="files.length" class="chips" aria-label="Attached files">
          <li v-for="(f, i) in files" :key="`${f.name}-${i}`" class="chip" data-testid="new-file-chip">
            <i class="pi pi-file" aria-hidden="true" />
            <span class="chip-name">{{ f.name }}</span>
            <button
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${f.name}`"
              @click="removeFile(i)"
            >
              <i class="pi pi-times" aria-hidden="true" />
            </button>
          </li>
        </ul>

        <p v-if="fileErrors.length" class="file-errors" data-testid="new-file-errors">
          {{ fileErrors.join(' ') }}
        </p>
      </div>
```

Update the submit button label to reflect upload progress. Replace the `<span>Create session</span>` (line 75) with:

```html
        <span>{{ submitLabel }}</span>
```

- [ ] **Step 4: Add the script logic**

In `frontend/src/views/NewSessionView.vue`, add to the imports (after line 88):

```javascript
import { ACCEPT_ATTR, uploadDocument, validateFile } from '../services/uploadApi.js'
```

After `const error = ref(null)` (line 94), add:

```javascript
const files = ref([])
const fileErrors = ref([])
const uploadingFiles = ref(false)
const fileInputEl = ref(null)
```

After the `canSubmit` computed (line 116), add:

```javascript
const submitLabel = computed(() => {
  if (uploadingFiles.value) {
    return `Uploading ${files.value.length} file${files.value.length === 1 ? '' : 's'}…`
  }
  if (store.loading) return 'Creating…'
  return 'Create session'
})

function openFilePicker() {
  fileInputEl.value?.click()
}

function onFilesPicked(event) {
  fileErrors.value = []
  for (const f of Array.from(event.target.files || [])) {
    const v = validateFile(f)
    if (v.ok) files.value.push(f)
    else fileErrors.value.push(v.reason)
  }
  event.target.value = ''
}

function removeFile(i) {
  files.value.splice(i, 1)
}
```

Replace the `submit` function (lines 131-147) with:

```javascript
async function submit() {
  error.value = null
  if (dupeBlocked.value) {
    error.value = 'An active session for this topic already exists.'
    return
  }
  let created
  try {
    created = await store.createSession({
      topic: topic.value.trim(),
      seedMode: 'fresh',
      priorSessionId: null,
    })
  } catch (e) {
    error.value = e?.message || 'Failed to create session.'
    return
  }
  if (files.value.length) {
    uploadingFiles.value = true
    const results = await Promise.allSettled(
      files.value.map((file) => uploadDocument({ sessionId: created.id, file })),
    )
    uploadingFiles.value = false
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed) {
      // Session exists; surface a soft warning but still proceed — the in-session
      // banner will show ingestion status for whatever uploaded successfully.
      fileErrors.value = [`${failed} file(s) failed to upload. You can retry from the session.`]
    }
  }
  router.push({ name: 'session', params: { id: created.id } })
}
```

- [ ] **Step 5: Add minimal styles**

In `frontend/src/views/NewSessionView.vue`, add to the `<style scoped>` block (before the closing `</style>` at line 389):

```css
.attach {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.attach-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  border-radius: var(--radius-pill);
  background: var(--color-surface);
  border: 1px dashed var(--color-border-strong);
  color: var(--color-text-muted);
  font-family: var(--font-sans);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color var(--motion-fast) ease, color var(--motion-fast) ease;
}

.attach-btn:hover,
.attach-btn:focus-visible {
  border-color: var(--color-accent);
  color: var(--color-accent-text);
}

.attach-btn:focus-visible {
  outline: 2px solid var(--color-accent-ring);
  outline-offset: 2px;
}

.attach-hint {
  margin: 0 0 0 0.25rem;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.4rem 0.35rem 0.7rem;
  border-radius: var(--radius-pill);
  background: var(--color-accent-soft);
  color: var(--color-accent-text);
  font-size: 0.8125rem;
}

.chip-name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-accent-text);
  cursor: pointer;
}

.chip-remove:hover,
.chip-remove:focus-visible {
  background: var(--color-surface);
}

.file-errors {
  margin: 0;
  color: var(--color-error-text);
  font-size: 0.8125rem;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run newSessionView`
Expected: all pass (existing 11 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/views/NewSessionView.vue frontend/src/__tests__/newSessionView.test.js
git commit -m "feat(frontend): attach reference files when creating a session"
```

---

## Task 9: ReferenceStatusBanner + mount in SessionView

**Files:**
- Create: `frontend/src/components/chat/ReferenceStatusBanner.vue`
- Test: `frontend/src/__tests__/referenceStatusBanner.test.js`
- Modify: `frontend/src/views/SessionView.vue` (template + imports)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/referenceStatusBanner.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

import ReferenceStatusBanner from '@/components/chat/ReferenceStatusBanner.vue'

const getSessionIngestion = vi.fn()
vi.mock('@/services/uploadApi.js', () => ({
  getSessionIngestion: (...a) => getSessionIngestion(...a),
}))

describe('ReferenceStatusBanner', () => {
  beforeEach(() => {
    getSessionIngestion.mockReset()
  })

  it('renders nothing when the session has no documents', async () => {
    getSessionIngestion.mockResolvedValue({ status: null, documents: [] })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="reference-status"]').exists()).toBe(false)
  })

  it('shows an indexing message while pending', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'pending',
      documents: [{ id: 1, filename: 'a.pdf', status: 'pending' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/indexing/i)
  })

  it('shows a ready message when all documents are ready', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'ready',
      documents: [{ id: 1, filename: 'a.pdf', status: 'ready' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/ready/i)
  })

  it('shows a failure message when a document failed', async () => {
    getSessionIngestion.mockResolvedValue({
      status: 'failed',
      documents: [{ id: 1, filename: 'a.pdf', status: 'failed', error: 'bad pdf' }],
    })
    const wrapper = mount(ReferenceStatusBanner, { props: { sessionId: 's1' } })
    await flushPromises()
    expect(wrapper.get('[data-testid="reference-status"]').text()).toMatch(/could not|failed/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- --run referenceStatusBanner`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/chat/ReferenceStatusBanner.vue`:

```html
<template>
  <div
    v-if="status"
    class="ref-status"
    :class="`is-${status}`"
    role="status"
    aria-live="polite"
    data-testid="reference-status"
  >
    <i :class="iconClass" aria-hidden="true" />
    <span class="ref-text">{{ message }}</span>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { getSessionIngestion } from '../../services/uploadApi.js'

const props = defineProps({
  sessionId: { type: String, required: true },
})

const status = ref(null) // 'pending' | 'ready' | 'failed' | null
const documents = ref([])

let timer = null
let stopped = false

const readyCount = computed(() => documents.value.filter((d) => d.status === 'ready').length)
const failedCount = computed(() => documents.value.filter((d) => d.status === 'failed').length)
const total = computed(() => documents.value.length)

const message = computed(() => {
  if (status.value === 'pending') {
    return `Indexing ${total.value} reference${total.value === 1 ? '' : 's'}… you can start chatting now.`
  }
  if (status.value === 'failed') {
    return `${failedCount.value} reference${failedCount.value === 1 ? '' : 's'} could not be indexed.`
  }
  if (status.value === 'ready') {
    return `${readyCount.value} reference${readyCount.value === 1 ? '' : 's'} ready.`
  }
  return ''
})

const iconClass = computed(() => {
  if (status.value === 'pending') return 'pi pi-spin pi-spinner'
  if (status.value === 'failed') return 'pi pi-exclamation-triangle'
  return 'pi pi-check-circle'
})

async function poll() {
  if (stopped) return
  try {
    const res = await getSessionIngestion(props.sessionId)
    status.value = res?.status ?? null
    documents.value = res?.documents ?? []
  } catch {
    // Transient; keep the last known state and retry on the next tick.
  }
  if (!stopped && status.value === 'pending') {
    timer = setTimeout(poll, 2000)
  }
}

function refresh() {
  if (timer) clearTimeout(timer)
  poll()
}

watch(() => props.sessionId, refresh)
onMounted(poll)
onUnmounted(() => {
  stopped = true
  if (timer) clearTimeout(timer)
})

defineExpose({ refresh })
</script>

<style scoped>
.ref-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.9rem;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
  color: var(--color-text-muted);
}

.ref-status.is-ready {
  color: var(--color-accent-text);
  border-color: var(--color-accent-soft);
  background: var(--color-accent-soft);
}

.ref-status.is-failed {
  color: var(--color-error-text);
}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- --run referenceStatusBanner`
Expected: 4 passed.

- [ ] **Step 5: Mount the banner in SessionView**

In `frontend/src/views/SessionView.vue`, add the import after the `UploadStatus` import (line 134):

```javascript
import ReferenceStatusBanner from '../components/chat/ReferenceStatusBanner.vue'
```

Add a ref alongside the other refs (after line 162 `const uploadStatus = ref(null)`):

```javascript
const referenceBannerRef = ref(null)
```

In the template, add the banner just above the `<UploadStatus ... />` line (line 68):

```html
      <ReferenceStatusBanner ref="referenceBannerRef" :session-id="id" />
```

- [ ] **Step 6: Run the SessionView tests (no regression)**

Run: `cd frontend && npm run test:unit -- --run sessionView`
Expected: existing tests pass. If a test fails because `getSessionIngestion` is unmocked and hits a real `apiGet`, add `ReferenceStatusBanner: { template: '<div />' }` to that test file's `stubs` object (around line 33). Re-run; expected pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chat/ReferenceStatusBanner.vue frontend/src/__tests__/referenceStatusBanner.test.js frontend/src/views/SessionView.vue
git commit -m "feat(frontend): in-session reference ingestion status banner"
```

---

## Task 10: Broaden in-session attach (Composer + SessionView)

**Files:**
- Modify: `frontend/src/components/chat/Composer.vue:6, 18-19`
- Modify: `frontend/src/views/SessionView.vue:139, 377-406`

- [ ] **Step 1: Broaden the Composer file input**

In `frontend/src/components/chat/Composer.vue`, replace line 6:

```html
      accept="application/pdf"
```

with:

```html
      accept=".pdf,.pptx,.txt,.md"
```

Replace the attach button aria-label/title (lines 18-19):

```html
        :aria-label="uploading ? 'Uploading PDF' : 'Attach a PDF'"
        :title="uploading ? 'Uploading…' : 'Attach PDF'"
```

with:

```html
        :aria-label="uploading ? 'Uploading file' : 'Attach a reference file'"
        :title="uploading ? 'Uploading…' : 'Attach a reference file (PDF, PPTX, TXT, MD)'"
```

- [ ] **Step 2: Route in-session attach through the shared validator**

In `frontend/src/views/SessionView.vue`, update the upload import (line 139) from:

```javascript
import { MAX_UPLOAD_BYTES, getUploadStatus, uploadPdf } from '../services/uploadApi.js'
```

to:

```javascript
import { getUploadStatus, uploadDocument, validateFile } from '../services/uploadApi.js'
```

Replace the `onAttachFile` function (lines 377-406) with:

```javascript
async function onAttachFile(file) {
  // Client-side pre-check for instant feedback; backend re-validates (type + 25 MB).
  const v = validateFile(file)
  if (!v.ok) {
    uploadStatus.value = { kind: 'failed', text: v.reason }
    return
  }
  uploading.value = true
  uploadStatus.value = { kind: 'pending', text: `Uploading ${file.name}…` }
  try {
    const resp = await uploadDocument({ sessionId: props.id, file })
    referenceBannerRef.value?.refresh()
    await pollUploadStatus(resp.document_id, file.name)
    referenceBannerRef.value?.refresh()
  } catch (e) {
    uploadStatus.value = {
      kind: 'failed',
      text: `Upload failed: ${friendlyError(e)}`,
    }
  } finally {
    uploading.value = false
  }
}
```

(Note: `MAX_UPLOAD_BYTES` is no longer referenced in SessionView after this change — its size check now lives inside `validateFile`. Removing it from the import in Step 2 is required to avoid an unused-import lint error.)

- [ ] **Step 3: Run frontend tests + lint**

Run: `cd frontend && npm run test:unit -- --run && npm run lint`
Expected: tests pass; lint clean (no unused `MAX_UPLOAD_BYTES`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/Composer.vue frontend/src/views/SessionView.vue
git commit -m "feat(frontend): in-session attach supports PPTX/TXT/MD + refreshes banner"
```

---

## Task 11: Remove redundant back buttons

**Files:**
- Modify: `frontend/src/views/SettingsView.vue:3`, script import
- Modify: `frontend/src/views/AggregateProfileView.vue:14`, script import
- Modify: `frontend/src/views/NewSessionView.vue:3, 86`
- Test: `frontend/src/__tests__/settingsView.test.js`, `aggregateProfileView.test.js`, `newSessionView.test.js` (assert absence)

- [ ] **Step 1: Write failing absence tests**

In `frontend/src/__tests__/newSessionView.test.js`, append inside the `describe` block:

```javascript
  it('does not render a back button', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })
```

In `frontend/src/__tests__/settingsView.test.js`, add a `data-testid` to its BackButton stub so absence is detectable — change the stub (line 23) to:

```javascript
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
```

and append a test (inside its main `describe`):

```javascript
  it('does not render a back button', () => {
    const wrapper = mountView()
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })
```

(If `settingsView.test.js` does not have a `mountView` helper, use its existing mount call pattern instead.)

In `frontend/src/__tests__/aggregateProfileView.test.js`, change the stub (line 11) to:

```javascript
  BackButton: { template: '<button data-testid="back" />', props: ['label', 'fallback'] },
```

and append:

```javascript
  it('does not render a back button', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.find('[data-testid="back"]').exists()).toBe(false)
  })
```

(Match the file's existing mount/flush pattern; some specs name the helper differently.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run "settingsView|aggregateProfileView|newSessionView"`
Expected: the three new "does not render a back button" tests FAIL (button still present).

- [ ] **Step 3: Remove the back buttons**

In `frontend/src/views/SettingsView.vue`, delete line 3 (`<BackButton fallback="/" />`) and remove its import line (`import BackButton from '../components/BackButton.vue'` in the `<script setup>`).

In `frontend/src/views/AggregateProfileView.vue`, delete line 14 (`<BackButton label="Back to sessions" fallback="/" />`) and remove its import line.

In `frontend/src/views/NewSessionView.vue`, delete line 3 (`<BackButton />`) and remove the import (line 86, `import BackButton from '../components/BackButton.vue'`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run "settingsView|aggregateProfileView|newSessionView"`
Expected: all pass, including the new absence tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SettingsView.vue frontend/src/views/AggregateProfileView.vue frontend/src/views/NewSessionView.vue frontend/src/__tests__/settingsView.test.js frontend/src/__tests__/aggregateProfileView.test.js frontend/src/__tests__/newSessionView.test.js
git commit -m "feat(frontend): remove redundant back buttons from top-level screens"
```

---

## Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `cd backend && pytest -q`
Expected: all pass.

- [ ] **Step 2: Contract drift check**

Run: `python backend/scripts/gen_contracts.py && git diff --exit-code backend/contracts/models.py`
Expected: exit 0 (no drift — the committed models match a fresh generation).

- [ ] **Step 3: Frontend unit suite + lint**

Run: `cd frontend && npm run test:unit -- --run && npm run lint`
Expected: all pass; lint clean.

- [ ] **Step 4: Confirm the branch is clean and review the diff**

Run: `git status` and `git log --oneline feat/session-reference-files ^dev`
Expected: working tree clean; commits from Tasks 1-11 listed.

- [ ] **Step 5: Manual smoke (live, optional but recommended before PR)**

With the stack running (`docker compose up`): create a session, attach one PDF + one PPTX + one .md, confirm immediate navigation, confirm the banner shows "Indexing 3 references…" then "3 references ready", then ask a question that should retrieve from the slides and confirm a citation appears. Confirm Settings, Aggregate Profile, and New Session no longer show a back button while the sidebar still navigates.

---

## Self-Review Notes

- **Spec coverage:** PDF+PPTX+plaintext (Task 5/6), multiple files (Task 8), navigate-immediately + status (Task 8/9), new endpoint (Task 1/3), aggregate semantics + retrieval fix (Task 2/4), back-button removal (Task 11). All spec sections map to a task.
- **Aggregate semantics** (`pending`>`ready`>`failed`>`None`) are defined once in `documents_service.session_ingestion_status` and reused by the endpoint, sessions routes, chat prompt, and retrieval gate.
- **No new DB column / migration:** file type is dispatched from the persisted filename extension; `page_count` becomes `None` for plaintext.
- **Type consistency:** `uploadDocument`/`getSessionIngestion`/`validateFile`/`ACCEPT_ATTR` names match across uploadApi, NewSessionView, SessionView, and the banner. Backend `session_ingestion_status`/`has_ready_document`/`list_document_statuses` names match across all call sites.
