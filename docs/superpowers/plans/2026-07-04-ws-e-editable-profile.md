# WS-E Editable Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add/remove `mastered_concepts` and `confirmed_gaps` and set `knowledge_level` on a session's topic profile from ProfileView, guarded by an ETag / `If-Match` optimistic-concurrency check.

**Architecture:** The profile stays a `topic_profile_json` blob on the `Session` row. A content-hash ETag (sha256 of the serialized `TopicProfile`) is returned on read and required as `If-Match` on writes; a mismatch means an agent write landed in between and the client must refetch. New `PATCH` and two `DELETE` routes call pure service edit helpers that enforce mutual exclusion between the two lists and null a dangling `focus_target_gap`. The frontend renders editable chips + a level control and reconciles on 412.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2 (`constr`), pytest; Vue 3 `<script setup>`, Pinia, vitest. Contracts are codegen from `docs/api/openapi.yaml`.

## Global Constraints

- No emojis in code or comments.
- Contracts are codegen: edit `docs/api/openapi.yaml` first, then run `python backend/scripts/gen_contracts.py` from repo root. Never hand-edit `backend/contracts/`. CI enforces zero drift.
- Branch: `phase/8-ws-e-editable-profile` (already created).
- ETag is the raw sha256 hex string (no quotes, no `W/` prefix) in both the `ETag`/`If-Match` header and the response body `etag` field. Same helper computes it on read and write so they always agree.
- Item strings: `constr(strip_whitespace=True, min_length=1, max_length=200)` (mirrors the existing `focus_target_gap` max-length rule).
- `focus_target_gap` is never directly editable by the user. Its only user-driven change is server-side auto-null when the matching gap leaves `confirmed_gaps`.
- Frontend writes are pessimistic: await the server response, then apply the returned profile + etag. No optimistic rollback.
- Run the full suites before declaring a task done: backend `cd backend && pytest`; frontend `cd frontend && npm run test:unit -- --run`.

---

### Task 1: API contract — paths + schemas + codegen

**Files:**
- Modify: `docs/api/openapi.yaml` (ProfileResponse ~871-880; GET path ~323-338; add PATCH + 2 DELETE paths; add ProfilePatchRequest + ProfileMutationResponse + PreconditionFailed/PreconditionRequired responses)
- Generated (do not hand-edit): `backend/contracts/models.py`, `backend/contracts/__init__.py`
- Test: `backend/tests/test_contracts_drift.py` (existing drift guard — do not edit, just run)

**Interfaces:**
- Produces: `ProfilePatchRequest { add_mastered?: str, add_gap?: str, knowledge_level?: "beginner"|"intermediate"|"advanced" }`; `ProfileMutationResponse { profile: TopicProfile, etag: str }`; `ProfileResponse` gains `etag: str` (now required). Route + frontend tasks import these names.

- [ ] **Step 1: Add `etag` to ProfileResponse in openapi.yaml**

In `docs/api/openapi.yaml`, edit the `ProfileResponse` schema (~871):

```yaml
    ProfileResponse:
      type: object
      additionalProperties: false
      required: [profile, recent_learning_events, etag]
      properties:
        profile: { $ref: "#/components/schemas/TopicProfile" }
        recent_learning_events:
          type: array
          items: { $ref: "#/components/schemas/LearningEventResponse" }
        etag:
          type: string
          description: sha256 hex of the serialized profile; send back as If-Match on writes.
```

- [ ] **Step 2: Add ProfilePatchRequest and ProfileMutationResponse schemas**

Add under `components.schemas` (near ProfileResponse):

```yaml
    ProfilePatchRequest:
      type: object
      additionalProperties: false
      description: |
        Add one item to a list and/or set the knowledge level. At least one
        field must be present. Adding an item to one list removes it from the
        other (mutual exclusion).
      properties:
        add_mastered:
          type: string
          minLength: 1
          maxLength: 200
        add_gap:
          type: string
          minLength: 1
          maxLength: 200
        knowledge_level:
          type: string
          enum: [beginner, intermediate, advanced]

    ProfileMutationResponse:
      type: object
      additionalProperties: false
      required: [profile, etag]
      properties:
        profile: { $ref: "#/components/schemas/TopicProfile" }
        etag: { type: string }
```

- [ ] **Step 3: Add the three write paths**

Add a `patch:` operation under the existing `/api/profile/{session_id}` and two new DELETE paths. Reuse the `SessionId` parameter ref and `NotFound` response already used by the GET:

```yaml
  /api/profile/{session_id}:
    # ... existing get: unchanged ...
    patch:
      tags: [profile]
      summary: Add a list item and/or set knowledge level. Optimistic-concurrency guarded.
      operationId: patchProfile
      parameters:
        - $ref: "#/components/parameters/SessionId"
        - $ref: "#/components/parameters/IfMatch"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ProfilePatchRequest" }
      responses:
        "200":
          description: Updated profile.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProfileMutationResponse" }
        "404": { $ref: "#/components/responses/NotFound" }
        "412": { $ref: "#/components/responses/PreconditionFailed" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }

  /api/profile/{session_id}/mastered_concepts/{item}:
    delete:
      tags: [profile]
      summary: Remove one mastered concept. Optimistic-concurrency guarded.
      operationId: deleteMasteredConcept
      parameters:
        - $ref: "#/components/parameters/SessionId"
        - name: item
          in: path
          required: true
          schema: { type: string }
        - $ref: "#/components/parameters/IfMatch"
      responses:
        "200":
          description: Updated profile.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProfileMutationResponse" }
        "404": { $ref: "#/components/responses/NotFound" }
        "412": { $ref: "#/components/responses/PreconditionFailed" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }

  /api/profile/{session_id}/confirmed_gaps/{item}:
    delete:
      tags: [profile]
      summary: Remove one confirmed gap (nulls focus if it was the focus). Optimistic-concurrency guarded.
      operationId: deleteConfirmedGap
      parameters:
        - $ref: "#/components/parameters/SessionId"
        - name: item
          in: path
          required: true
          schema: { type: string }
        - $ref: "#/components/parameters/IfMatch"
      responses:
        "200":
          description: Updated profile.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProfileMutationResponse" }
        "404": { $ref: "#/components/responses/NotFound" }
        "412": { $ref: "#/components/responses/PreconditionFailed" }
        "428": { $ref: "#/components/responses/PreconditionRequired" }
```

- [ ] **Step 4: Add the IfMatch parameter and the two error responses**

Under `components.parameters` add:

```yaml
    IfMatch:
      name: If-Match
      in: header
      required: true
      description: ETag from the last profile read. Guards against clobbering a concurrent write.
      schema: { type: string }
```

Under `components.responses` add (match the shape of the existing `NotFound` response):

```yaml
    PreconditionFailed:
      description: If-Match did not match the current profile; refetch and retry.
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }
    PreconditionRequired:
      description: If-Match header missing.
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }
```

If `ErrorResponse` is not the schema name used by `NotFound`, open the existing `NotFound` response in the file and reuse whatever schema it references.

- [ ] **Step 5: Regenerate contracts**

Run: `python backend/scripts/gen_contracts.py`
Expected: writes `backend/contracts/models.py` + `__init__.py`; `git status` shows them changed.

- [ ] **Step 6: Verify drift guard + import surface pass**

Run: `cd backend && pytest tests/test_contracts_drift.py -v`
Expected: PASS (generated code matches the YAML).

Run: `cd backend && python -c "from contracts import ProfilePatchRequest, ProfileMutationResponse, ProfileResponse; print('ok')"`
Expected: prints `ok` (new names importable, `ProfileResponse.etag` present).

- [ ] **Step 7: Commit**

```bash
git add docs/api/openapi.yaml backend/contracts/
git commit -m "feat(contracts): editable-profile paths + ETag mutation schemas"
```

---

### Task 2: Backend ETag helper + service edit functions

**Files:**
- Modify: `backend/services/profile_service.py`
- Test: `backend/tests/test_profile_service.py`

**Interfaces:**
- Consumes: existing `load_profile(db, session_id) -> TopicProfile`, `save_profile(db, session_id, profile, commit=True)`, `TopicProfile` contract.
- Produces:
  - `profile_etag(profile: TopicProfile) -> str` — sha256 hex of `profile.model_dump_json()`.
  - `apply_user_patch(db, session_id, *, add_mastered=None, add_gap=None, knowledge_level=None) -> TopicProfile` — applies mutual-exclusive add(s) + level, persists, returns updated profile. Raises `ValueError("session not found: ...")` if the session row is missing.
  - `remove_profile_item(db, session_id, list_name, item) -> TopicProfile` where `list_name` is `"mastered_concepts"` or `"confirmed_gaps"`; raises `KeyError(item)` if the item is not in that list; nulls `focus_target_gap` when a matching gap is removed; persists; returns updated profile.

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/test_profile_service.py` (follow the existing fixture style in that file for creating a session with a profile):

```python
from services import profile_service


def test_profile_etag_is_stable_and_changes_with_content():
    from contracts import TopicProfile
    a = TopicProfile(mastered_concepts=["x"])
    b = TopicProfile(mastered_concepts=["x"])
    c = TopicProfile(mastered_concepts=["y"])
    assert profile_service.profile_etag(a) == profile_service.profile_etag(b)
    assert profile_service.profile_etag(a) != profile_service.profile_etag(c)


def test_apply_user_patch_adds_and_sets_level(db, seeded_session_id):
    p = profile_service.apply_user_patch(
        db, seeded_session_id, add_mastered="loops", knowledge_level="advanced"
    )
    assert "loops" in p.mastered_concepts
    assert p.knowledge_level == "advanced"
    # persisted
    assert "loops" in profile_service.load_profile(db, seeded_session_id).mastered_concepts


def test_apply_user_patch_mutual_exclusion_moves_item(db, seeded_session_id):
    profile_service.apply_user_patch(db, seeded_session_id, add_gap="recursion")
    p = profile_service.apply_user_patch(db, seeded_session_id, add_mastered="recursion")
    assert "recursion" in p.mastered_concepts
    assert "recursion" not in p.confirmed_gaps


def test_add_mastered_nulls_focus_when_it_was_the_focused_gap(db, seeded_session_id):
    from contracts import TopicProfile
    profile_service.save_profile(
        db, seeded_session_id,
        TopicProfile(confirmed_gaps=["recursion"], focus_target_gap="recursion"),
    )
    p = profile_service.apply_user_patch(db, seeded_session_id, add_mastered="recursion")
    assert p.focus_target_gap is None


def test_remove_profile_item_removes_and_persists(db, seeded_session_id):
    profile_service.apply_user_patch(db, seeded_session_id, add_mastered="loops")
    p = profile_service.remove_profile_item(db, seeded_session_id, "mastered_concepts", "loops")
    assert "loops" not in p.mastered_concepts


def test_remove_confirmed_gap_nulls_focus(db, seeded_session_id):
    from contracts import TopicProfile
    profile_service.save_profile(
        db, seeded_session_id,
        TopicProfile(confirmed_gaps=["recursion"], focus_target_gap="recursion"),
    )
    p = profile_service.remove_profile_item(db, seeded_session_id, "confirmed_gaps", "recursion")
    assert "recursion" not in p.confirmed_gaps
    assert p.focus_target_gap is None


def test_remove_missing_item_raises_keyerror(db, seeded_session_id):
    import pytest
    with pytest.raises(KeyError):
        profile_service.remove_profile_item(db, seeded_session_id, "mastered_concepts", "nope")
```

If `db` / `seeded_session_id` fixtures do not already exist in this test file, add a `seeded_session_id` fixture that inserts a `Session` row with `topic_profile_json="{}"` using the same DB session fixture the other tests in the file use. Read the top of `test_profile_service.py` first and reuse its existing fixtures.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_profile_service.py -k "etag or apply_user_patch or remove_profile_item or nulls_focus" -v`
Expected: FAIL with `AttributeError: module 'services.profile_service' has no attribute 'profile_etag'`.

- [ ] **Step 3: Implement helper + edit functions**

Add to `backend/services/profile_service.py` (imports `hashlib` at top; reuse the module's existing `_norm_list`):

```python
import hashlib
from typing import Literal


def profile_etag(profile: TopicProfile) -> str:
    return hashlib.sha256(profile.model_dump_json().encode("utf-8")).hexdigest()


def _add_exclusive(profile: TopicProfile, target: str, item: str) -> None:
    other = "confirmed_gaps" if target == "mastered_concepts" else "mastered_concepts"
    tgt = _norm_list(getattr(profile, target))
    oth = _norm_list(getattr(profile, other))
    if item not in tgt:
        tgt.append(item)
    oth = [x for x in oth if x != item]
    setattr(profile, target, tgt)
    setattr(profile, other, oth)
    if other == "confirmed_gaps":
        _null_focus_if_removed(profile, item)


def _null_focus_if_removed(profile: TopicProfile, item: str) -> None:
    if profile.focus_target_gap == item:
        profile.focus_target_gap = None


def apply_user_patch(
    db: Session,
    session_id: str,
    *,
    add_mastered: str | None = None,
    add_gap: str | None = None,
    knowledge_level: str | None = None,
) -> TopicProfile:
    profile = load_profile(db, session_id)
    if db.get(SessionModel, session_id) is None:
        raise ValueError(f"session not found: {session_id}")
    if add_mastered is not None:
        _add_exclusive(profile, "mastered_concepts", add_mastered)
    if add_gap is not None:
        _add_exclusive(profile, "confirmed_gaps", add_gap)
    if knowledge_level is not None:
        profile.knowledge_level = knowledge_level
    save_profile(db, session_id, profile)
    return profile


def remove_profile_item(
    db: Session,
    session_id: str,
    list_name: Literal["mastered_concepts", "confirmed_gaps"],
    item: str,
) -> TopicProfile:
    profile = load_profile(db, session_id)
    current = _norm_list(getattr(profile, list_name))
    if item not in current:
        raise KeyError(item)
    setattr(profile, list_name, [x for x in current if x != item])
    if list_name == "confirmed_gaps":
        _null_focus_if_removed(profile, item)
    save_profile(db, session_id, profile)
    return profile
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_profile_service.py -v`
Expected: PASS (new tests + existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/services/profile_service.py backend/tests/test_profile_service.py
git commit -m "feat(profile): ETag helper + user edit service functions"
```

---

### Task 3: Backend routes — PATCH + 2 DELETE with If-Match guard

**Files:**
- Modify: `backend/routes/profile.py`
- Test: `backend/tests/test_profile_route.py`

**Interfaces:**
- Consumes: `profile_service.profile_etag`, `apply_user_patch`, `remove_profile_item`, `load_profile`; `contracts.ProfilePatchRequest`, `ProfileMutationResponse`; `current_user_id`; existing ownership pattern (`db.get(SessionModel, session_id)`, compare `row.user_id`).
- Produces: `PATCH /api/profile/{session_id}`, `DELETE /api/profile/{session_id}/mastered_concepts/{item}`, `DELETE /api/profile/{session_id}/confirmed_gaps/{item}` returning `ProfileMutationResponse`.

- [ ] **Step 1: Write failing route tests**

Add to `backend/tests/test_profile_route.py` (reuse the file's existing client + auth-header + session-seed helpers; read the top of the file first):

```python
def _etag(client, headers, sid):
    return client.get(f"/api/profile/{sid}", headers=headers).json()["etag"]


def test_patch_requires_if_match(client, auth_headers, seeded_session_id):
    r = client.patch(
        f"/api/profile/{seeded_session_id}",
        headers=auth_headers,
        json={"add_mastered": "loops"},
    )
    assert r.status_code == 428


def test_patch_stale_if_match_returns_412(client, auth_headers, seeded_session_id):
    r = client.patch(
        f"/api/profile/{seeded_session_id}",
        headers={**auth_headers, "If-Match": "deadbeef"},
        json={"add_gap": "recursion"},
    )
    assert r.status_code == 412


def test_patch_adds_item_and_returns_new_etag(client, auth_headers, seeded_session_id):
    tag = _etag(client, auth_headers, seeded_session_id)
    r = client.patch(
        f"/api/profile/{seeded_session_id}",
        headers={**auth_headers, "If-Match": tag},
        json={"add_mastered": "loops", "knowledge_level": "advanced"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "loops" in body["profile"]["mastered_concepts"]
    assert body["profile"]["knowledge_level"] == "advanced"
    assert body["etag"] != tag


def test_patch_empty_body_is_422(client, auth_headers, seeded_session_id):
    tag = _etag(client, auth_headers, seeded_session_id)
    r = client.patch(
        f"/api/profile/{seeded_session_id}",
        headers={**auth_headers, "If-Match": tag},
        json={},
    )
    assert r.status_code == 422


def test_delete_gap_with_spaces_and_nulls_focus(client, auth_headers, seeded_session_id):
    from urllib.parse import quote
    tag = _etag(client, auth_headers, seeded_session_id)
    client.patch(
        f"/api/profile/{seeded_session_id}",
        headers={**auth_headers, "If-Match": tag},
        json={"add_gap": "big O notation"},
    )
    tag = _etag(client, auth_headers, seeded_session_id)
    r = client.delete(
        f"/api/profile/{seeded_session_id}/confirmed_gaps/{quote('big O notation')}",
        headers={**auth_headers, "If-Match": tag},
    )
    assert r.status_code == 200
    assert "big O notation" not in r.json()["profile"]["confirmed_gaps"]


def test_delete_missing_item_404(client, auth_headers, seeded_session_id):
    tag = _etag(client, auth_headers, seeded_session_id)
    r = client.delete(
        f"/api/profile/{seeded_session_id}/mastered_concepts/nope",
        headers={**auth_headers, "If-Match": tag},
    )
    assert r.status_code == 404


def test_patch_other_users_session_404(client, other_auth_headers, seeded_session_id):
    r = client.patch(
        f"/api/profile/{seeded_session_id}",
        headers={**other_auth_headers, "If-Match": "x"},
        json={"add_mastered": "loops"},
    )
    assert r.status_code == 404
```

If `other_auth_headers` does not exist, add a fixture that authenticates as a different user id, mirroring the existing `auth_headers` fixture. If `seeded_session_id` seeds under the `auth_headers` user, ensure the ownership test seeds the same session but calls as the other user.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && pytest tests/test_profile_route.py -k "patch or delete" -v`
Expected: FAIL / 405 (routes not defined yet).

- [ ] **Step 3: Implement routes**

Add to `backend/routes/profile.py` (extend imports: `Header` from fastapi; `ProfilePatchRequest, ProfileMutationResponse` from contracts; `profile_service`):

```python
from fastapi import Header


def _owned_session_or_404(db, session_id, user_id):
    row = db.get(SessionModel, session_id)
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=404, detail="session not found")
    return row


def _guard_if_match(db, session_id, if_match):
    if if_match is None:
        raise HTTPException(status_code=428, detail="If-Match header required")
    current = profile_service.profile_etag(profile_service.load_profile(db, session_id))
    if if_match != current:
        raise HTTPException(status_code=412, detail="profile changed; refetch")


@router.patch("/profile/{session_id}", response_model=ProfileMutationResponse)
def patch_profile(
    session_id: str,
    body: ProfilePatchRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    _owned_session_or_404(db, session_id, user_id)
    if body.add_mastered is None and body.add_gap is None and body.knowledge_level is None:
        raise HTTPException(status_code=422, detail="empty patch")
    _guard_if_match(db, session_id, if_match)
    profile = profile_service.apply_user_patch(
        db,
        session_id,
        add_mastered=body.add_mastered,
        add_gap=body.add_gap,
        knowledge_level=body.knowledge_level,
    )
    return ProfileMutationResponse(profile=profile, etag=profile_service.profile_etag(profile))


def _delete_item(db, session_id, user_id, list_name, item, if_match):
    _owned_session_or_404(db, session_id, user_id)
    _guard_if_match(db, session_id, if_match)
    try:
        profile = profile_service.remove_profile_item(db, session_id, list_name, item)
    except KeyError:
        raise HTTPException(status_code=404, detail="item not found")
    return ProfileMutationResponse(profile=profile, etag=profile_service.profile_etag(profile))


@router.delete("/profile/{session_id}/mastered_concepts/{item}", response_model=ProfileMutationResponse)
def delete_mastered(
    session_id: str,
    item: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    return _delete_item(db, session_id, user_id, "mastered_concepts", item, if_match)


@router.delete("/profile/{session_id}/confirmed_gaps/{item}", response_model=ProfileMutationResponse)
def delete_gap(
    session_id: str,
    item: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    if_match: str | None = Header(default=None, alias="If-Match"),
):
    return _delete_item(db, session_id, user_id, "confirmed_gaps", item, if_match)
```

Note: the empty-body 422 is checked before the If-Match guard so a malformed request fails the same way regardless of ETag. Ownership 404 comes first so we never leak whether another user's session exists.

- [ ] **Step 4: Also return `etag` from the existing GET**

The GET currently returns `ProfileResponse` without `etag`. Update `get_profile` in `backend/routes/profile.py` to include it:

```python
    return ProfileResponse(
        profile=profile,
        recent_learning_events=events,
        etag=profile_service.profile_etag(profile),
    )
```

Add a GET assertion to `test_profile_route.py`:

```python
def test_get_profile_includes_etag(client, auth_headers, seeded_session_id):
    r = client.get(f"/api/profile/{seeded_session_id}", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json()["etag"], str) and r.json()["etag"]
```

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && pytest`
Expected: PASS (new route tests + no regressions; the GET etag field is now populated everywhere ProfileResponse is built).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/profile.py backend/tests/test_profile_route.py
git commit -m "feat(profile): PATCH/DELETE edit routes with If-Match guard"
```

---

### Task 4: Frontend API layer — If-Match header + profile edit calls

**Files:**
- Modify: `frontend/src/services/apiClient.js` (add `headers` passthrough in `request`)
- Modify: `frontend/src/services/profileApi.js`
- Test: `frontend/src/__tests__/profileApi.test.js` (create)

**Interfaces:**
- Consumes: `apiGet`, `apiPatch`, `apiDelete` (already exported), `ApiError`.
- Produces: `getSessionProfile(sessionId)` (unchanged) returns body incl. `etag`; `patchProfile(sessionId, body, etag)`; `deleteProfileItem(sessionId, listName, item, etag)` where `listName` is `"mastered_concepts"` or `"confirmed_gaps"`. Both write calls send `If-Match: etag` and return the `ProfileMutationResponse` body.

- [ ] **Step 1: Write failing tests**

Create `frontend/src/__tests__/profileApi.test.js`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteProfileItem, patchProfile } from '../services/profileApi.js'

describe('profileApi writes', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ profile: {}, etag: 'new' }),
    }))
  })
  afterEach(() => vi.restoreAllMocks())

  it('patchProfile sends If-Match and body', async () => {
    await patchProfile('s1', { add_mastered: 'loops' }, 'tag123')
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/profile/s1')
    expect(init.method).toBe('PATCH')
    expect(init.headers['if-match'] ?? init.headers['If-Match']).toBe('tag123')
    expect(JSON.parse(init.body)).toEqual({ add_mastered: 'loops' })
  })

  it('deleteProfileItem encodes the item and sends If-Match', async () => {
    await deleteProfileItem('s1', 'confirmed_gaps', 'big O', 'tag123')
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/profile/s1/confirmed_gaps/big%20O')
    expect(init.method).toBe('DELETE')
    expect(init.headers['if-match'] ?? init.headers['If-Match']).toBe('tag123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run profileApi`
Expected: FAIL (`patchProfile` / `deleteProfileItem` not exported; header not sent).

- [ ] **Step 3: Add header passthrough to apiClient `request`**

In `frontend/src/services/apiClient.js`, thread an optional `headers` option through `request` and the verb helpers. Change the `request` signature and header merge:

```js
async function request(method, path, { body, params, silent = false, headers } = {}) {
  // ... url building unchanged ...
  const init = { method, headers: { ...(headers || {}) } }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  // ... token + fetch unchanged ...
}
```

Update the verb helpers to forward `opts` (they already spread `opts`, so `headers` flows through). Confirm `apiPatch`/`apiDelete` pass `opts`:

```js
export const apiPatch = (path, body, opts = {}) => request('PATCH', path, { body, ...opts })
export const apiDelete = (path, opts = {}) => request('DELETE', path, { ...opts })
```

- [ ] **Step 4: Add the profile write functions**

In `frontend/src/services/profileApi.js`:

```js
import { apiDelete, apiGet, apiPatch } from './apiClient.js'

export const getSessionProfile = (sessionId) => apiGet(`/profile/${sessionId}`)
export const getAggregateProfile = () => apiGet('/profile/aggregate')

export const patchProfile = (sessionId, body, etag) =>
  apiPatch(`/profile/${sessionId}`, body, { headers: { 'If-Match': etag } })

export const deleteProfileItem = (sessionId, listName, item, etag) =>
  apiDelete(`/profile/${sessionId}/${listName}/${encodeURIComponent(item)}`, {
    headers: { 'If-Match': etag },
  })
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run profileApi`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/apiClient.js frontend/src/services/profileApi.js frontend/src/__tests__/profileApi.test.js
git commit -m "feat(profile): frontend If-Match header + profile edit API"
```

---

### Task 5: ProfileView edit UI

**Files:**
- Modify: `frontend/src/views/ProfileView.vue`
- Test: `frontend/src/__tests__/sessionProfileView.test.js`

**Interfaces:**
- Consumes: `getSessionProfile`, `patchProfile`, `deleteProfileItem`; existing `data`/`loading`/`error` refs.
- Produces: chip delete buttons (`data-testid="chip-remove"`), add inputs (`data-testid="add-mastered"` / `add-gap`), a level control (`data-testid="level-select"`), and 412 refetch handling.

- [ ] **Step 1: Write failing tests**

Add to `frontend/src/__tests__/sessionProfileView.test.js` (reuse the file's existing mount helper + profileApi mock; read the top first). Mock `patchProfile`/`deleteProfileItem` from `../services/profileApi.js`:

```js
it('adds a mastered concept and threads the etag', async () => {
  // getSessionProfile resolves { profile: {...}, etag: 'e0', recent_learning_events: [] }
  // patchProfile mock resolves { profile: { mastered_concepts: ['loops'] }, etag: 'e1' }
  const wrapper = await mountProfile({ etag: 'e0' })
  await wrapper.get('[data-testid="add-mastered"]').setValue('loops')
  await wrapper.get('[data-testid="add-mastered-submit"]').trigger('click')
  expect(patchProfile).toHaveBeenCalledWith('sess-1', { add_mastered: 'loops' }, 'e0')
})

it('removes a chip via deleteProfileItem', async () => {
  const wrapper = await mountProfile({
    profile: { mastered_concepts: ['loops'], confirmed_gaps: [] },
    etag: 'e0',
  })
  await wrapper.get('[data-testid="chip-remove"]').trigger('click')
  expect(deleteProfileItem).toHaveBeenCalledWith('sess-1', 'mastered_concepts', 'loops', 'e0')
})

it('on 412 refetches and shows a notice', async () => {
  patchProfile.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 412 }))
  const wrapper = await mountProfile({ etag: 'e0' })
  await wrapper.get('[data-testid="add-mastered"]').setValue('loops')
  await wrapper.get('[data-testid="add-mastered-submit"]').trigger('click')
  await flushPromises()
  expect(getSessionProfile).toHaveBeenCalledTimes(2) // initial + refetch
  expect(wrapper.get('[data-testid="sprof-conflict"]').exists()).toBe(true)
})
```

Adjust the exact mount-helper name / mock wiring to match what already exists in `sessionProfileView.test.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:unit -- --run sessionProfileView`
Expected: FAIL (add input / remove button / conflict notice absent).

- [ ] **Step 3: Implement the edit UI**

In `ProfileView.vue`, hold the etag in a ref and add write handlers. Script additions:

```js
import { patchProfile, deleteProfileItem, getSessionProfile } from '../services/profileApi.js'

const etag = ref('')
const conflict = ref(false)
const newMastered = ref('')
const newGap = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getSessionProfile(props.id)
    etag.value = data.value.etag
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

async function _applyWrite(fn) {
  conflict.value = false
  try {
    const res = await fn()
    data.value = { ...data.value, profile: res.profile }
    etag.value = res.etag
  } catch (e) {
    if (e?.status === 412) {
      conflict.value = true
      await load()
    } else {
      error.value = friendlyError(e)
    }
  }
}

function addMastered() {
  const v = newMastered.value.trim()
  if (!v) return
  newMastered.value = ''
  return _applyWrite(() => patchProfile(props.id, { add_mastered: v }, etag.value))
}

function addGap() {
  const v = newGap.value.trim()
  if (!v) return
  newGap.value = ''
  return _applyWrite(() => patchProfile(props.id, { add_gap: v }, etag.value))
}

function setLevel(level) {
  return _applyWrite(() => patchProfile(props.id, { knowledge_level: level }, etag.value))
}

function removeItem(listName, item) {
  return _applyWrite(() => deleteProfileItem(props.id, listName, item, etag.value))
}
```

Template: add a remove button inside each chip `<li>`, an add-input row per column, a level control, and a conflict notice. Example for the mastered chip (mirror for gaps with `listName="confirmed_gaps"`):

```html
<li v-for="c in data.profile.mastered_concepts" :key="`m-${c}`" class="chip chip-mastered">
  {{ c }}
  <button
    type="button"
    class="chip-x"
    data-testid="chip-remove"
    :aria-label="`Remove ${c}`"
    @click="removeItem('mastered_concepts', c)"
  >
    <i class="pi pi-times" aria-hidden="true" />
  </button>
</li>
```

Add-input row (mastered; mirror for gaps with `newGap` / `add-gap` / `addGap`):

```html
<form class="add-row" @submit.prevent="addMastered">
  <input
    v-model="newMastered"
    data-testid="add-mastered"
    class="add-input"
    placeholder="Add a concept"
    maxlength="200"
  />
  <button type="submit" data-testid="add-mastered-submit" class="add-btn">Add</button>
</form>
```

Level control near the header:

```html
<div class="level-edit" data-testid="level-select">
  <button
    v-for="lvl in ['beginner', 'intermediate', 'advanced']"
    :key="lvl"
    type="button"
    class="level-opt"
    :class="{ active: data.profile.knowledge_level === lvl }"
    @click="setLevel(lvl)"
  >
    {{ lvl }}
  </button>
</div>
```

Conflict notice (place near the top of the `v-else-if="data"` block):

```html
<p v-if="conflict" class="conflict" data-testid="sprof-conflict" role="status">
  Profile changed elsewhere — reloaded with the latest.
</p>
```

Add minimal scoped styles for `.chip-x`, `.add-row`, `.add-input`, `.add-btn`, `.level-edit`, `.level-opt`, `.conflict` using existing design tokens (`--color-border`, `--radius-pill`, `--color-accent-strong`, `--color-error-text`). No emojis.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:unit -- --run sessionProfileView`
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite + lint**

Run: `cd frontend && npm run test:unit -- --run && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/ProfileView.vue frontend/src/__tests__/sessionProfileView.test.js
git commit -m "feat(profile): editable chips, level control, conflict reload in ProfileView"
```

---

### Task 6: Update Phase 8 live-status

**Files:**
- Modify: `docs/superpowers/specs/2026-07-02-phase-8-launch-design.md` (live-status table ~120-128)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update the WS-E row**

In the `## 6. Live status` table, set the E row to:

```
| E | Editable profile | P1 | Done | 2026-07-04-ws-e-editable-profile-design.md | 2026-07-04-ws-e-editable-profile.md | ETag guard; lists + level; focus stays agent-owned |
```

Also update rows B/C/D to `Done` if still stale (B #100, C #101, D #102 all merged).

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-02-phase-8-launch-design.md
git commit -m "docs(phase8): mark WS-E done in live status"
```

---

## Self-Review

**Spec coverage:**
- Goal / lists+level edit → Tasks 2,3,5. ✓
- ETag/If-Match guard (428/412) → Tasks 2 (helper), 3 (route guard), 4 (client header), 5 (412 reload). ✓
- Endpoints PATCH + 2 DELETE → Tasks 1 (contract), 3 (routes). ✓
- Mutual exclusion + focus auto-null shared rule → Task 2 (`_add_exclusive` / `_null_focus_if_removed`), tested. ✓
- Validation (max 200, strip, empty body 422) → Task 1 (schema constraints), Task 3 (empty-body 422). ✓
- focus_target_gap not directly editable → no endpoint touches it except auto-null. ✓
- Contract codegen flow → Task 1. ✓
- Frontend chips/level/aggregate-untouched → Task 5 (session view only). ✓
- Testing BE + FE → every task is TDD. ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code. Test helper names flagged as "reuse existing / adjust to match" where the file's fixtures must be read first — acceptable because exact fixture names live in files the implementer opens in that step.

**Type consistency:** `profile_etag`, `apply_user_patch`, `remove_profile_item`, `ProfilePatchRequest`, `ProfileMutationResponse`, `patchProfile`, `deleteProfileItem`, `_applyWrite` used consistently across tasks. `ProfileResponse.etag` added in Task 1 and consumed in Task 3 GET + Task 5 load. `list_name` values `"mastered_concepts"`/`"confirmed_gaps"` consistent service↔route↔client↔URL.
