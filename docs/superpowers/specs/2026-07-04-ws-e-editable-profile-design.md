# WS-E — Editable Profile (design)

Date: 2026-07-04
Phase: 8 (launch), workstream E (P1)
Parent: [`2026-07-02-phase-8-launch-design.md`](2026-07-02-phase-8-launch-design.md)
Branch: `phase/8-ws-e-editable-profile`

## 1. Goal + problem

The TutorAgent records the learner's topic profile (`mastered_concepts`,
`confirmed_gaps`, `knowledge_level`, `focus_target_gap`) automatically via the
`update_topic_profile` tool. It sometimes mis-records: marks a concept mastered
that the user has not mastered, logs a gap the user does not have, or infers the
wrong overall `knowledge_level` from the 3-question diagnostic. Today the user
has no way to correct any of it. This is the highest user-felt gap for launch.

WS-E lets the user directly edit the two lists and the knowledge level from the
session ProfileView, with an optimistic-concurrency guard so a user edit cannot
silently clobber a concurrent agent write mid-chat.

### Exit criteria

- User can add/remove items in `mastered_concepts` and `confirmed_gaps`.
- User can set `knowledge_level`.
- All writes are guarded by an ETag / `If-Match` optimistic-concurrency check.
- ProfileView renders editable chips + a level control.
- Backend + frontend tests green; API contract regenerated with zero drift.

### Out of scope (YAGNI)

- Editing `focus_target_gap` — it is the agent's live teaching state, low user
  value, and directly editing it collides with the server-side focus-clear guard
  rail. Stays agent-owned. (One indirect effect: see §3, focus auto-null.)
- Editing the aggregate cross-session view — it is read-only derived counts.
- Rename-in-place, reordering, bulk import.

## 2. Data model + concurrency

The profile is stored as the `topic_profile_json` TEXT column on the `Session`
row (`backend/db/models.py`), a serialized `TopicProfile` Pydantic model
(`backend/contracts/models.py`: `knowledge_level`, `confirmed_gaps`,
`mastered_concepts`, `focus_target_gap`). **No version or `updated_at` column
exists for the profile blob, and none is added.**

Optimistic concurrency uses a **content-hash ETag** — no schema change, no
migration, stateless:

- `GET /api/profile/{session_id}` computes `etag = sha256(canonical_json).hexdigest()`
  over the current profile and returns it both as an HTTP `ETag` response header
  and as a field on the response body (so the SPA can read it without inspecting
  raw headers).
- "Canonical JSON" = `TopicProfile.model_dump_json()` of the loaded profile
  (deterministic field order from the Pydantic model). The same helper computes
  the ETag on read and on write so they always agree.
- Every write endpoint requires an `If-Match: <etag>` header:
  - Missing header → **428 Precondition Required**.
  - Header present but does not equal the hash of the *current* stored profile →
    **412 Precondition Failed**.
  - Match → apply the change, persist, return the updated profile + new ETag.

This closes the race where the user GETs the profile, the agent's `apply_patch`
writes during chat, and the user then PATCHes stale data: the stored hash has
moved, so the stale `If-Match` fails with 412 and the client refetches.

## 3. Endpoints

All endpoints: `current_user_id` auth dependency, 404 if the session does not
exist or is not owned by the caller (same pattern as the existing
`GET /api/profile/{session_id}`), and the `If-Match` guard from §2.

### `PATCH /api/profile/{session_id}`

Body `ProfilePatchRequest` — every field optional, at least one required:

```
{
  "add_mastered": "string (1..200, stripped)"?,
  "add_gap": "string (1..200, stripped)"?,
  "knowledge_level": "beginner" | "intermediate" | "advanced"?
}
```

- `add_mastered` / `add_gap` append one item to the respective list.
- `knowledge_level` sets the field.
- Empty body (no field set) → **422**.
- Returns the updated profile + new ETag.

### `DELETE /api/profile/{session_id}/mastered_concepts/{item}`
### `DELETE /api/profile/{session_id}/confirmed_gaps/{item}`

- Remove one item (URL-decoded, exact match after strip).
- Item not present → **404**.
- If a deleted `confirmed_gaps` item equals the current `focus_target_gap`,
  the server sets `focus_target_gap = null` in the same write (a gap the user
  deleted can no longer be the focus). This is the only indirect focus effect.
- Returns the updated profile + new ETag.

## 4. Rules

- **Validation:** item strings reuse the existing `constr(max_length=200)`
  pattern (as `focus_target_gap` already does), are stripped, and empty-after-
  strip is rejected (422).
- **Mutual exclusivity:** adding `X` to `mastered_concepts` removes `X` from
  `confirmed_gaps`, and vice versa. A concept cannot be simultaneously mastered
  and an open gap. Matches the learning semantics already encoded in the agent
  rules (tested mastery moves a concept out of gaps).
- **Focus auto-null (shared rule):** whenever an item leaves `confirmed_gaps`
  by *any* edit — a direct DELETE of a gap, or mutual-exclusion removing it
  because it was added to `mastered_concepts` — if that item equalled the
  current `focus_target_gap`, set `focus_target_gap = null` in the same write.
  A single shared helper enforces this so both the DELETE path (§3) and the
  PATCH `add_mastered` path stay consistent.
- **Dedup:** adding an item already in the target list is a no-op that still
  returns 200 with the (unchanged) profile and its ETag.
- **Agent path untouched:** `update_topic_profile` / `apply_patch` continue to
  write the blob directly. They do not need to know about ETags; because the
  ETag is derived from content, the next user GET simply returns the fresh hash.

## 5. API contract flow

Contracts are codegen, never hand-edited. Edit `docs/api/openapi.yaml` first —
add the two `DELETE` paths, the `PATCH` path, and the `ProfilePatchRequest`
schema (plus the ETag field on the profile GET response) — then run
`python backend/scripts/gen_contracts.py` from the repo root. CI enforces zero
drift between the YAML and `backend/contracts/`.

## 6. Frontend

Session-level `frontend/src/views/ProfileView.vue` only. `AggregateProfileView.vue`
stays read-only.

- **Chips:** each of `mastered_concepts` and `confirmed_gaps` renders as chips
  with an `x` delete affordance; an inline "+ add" input appends an item.
- **Level:** `knowledge_level` renders as a small select / segmented control.
- **API layer:** `frontend/src/services/profileApi.js` gains `patchProfile` and
  `deleteProfileItem`; `frontend/src/services/apiClient.js` gains `apiPatch` and
  `apiDelete` that thread the `If-Match` header.
- **ETag handling:** the view stores the ETag from the last GET, sends it on
  each write, and updates it from each write response. On **412** it refetches
  the profile and shows a non-blocking toast ("Profile changed elsewhere —
  reloaded") rather than losing the user's in-flight intent silently.
- **Optimistic vs pessimistic UI:** writes are pessimistic (await server, then
  apply returned profile) to keep the ETag authoritative and the chip state
  exactly matching the server. Simpler than reconciling optimistic rollback on
  412.

## 7. Testing

- **Backend (pytest):** per endpoint — happy path; `If-Match` missing → 428;
  stale `If-Match` → 412; mutual-exclusion (add to one list drops from the
  other); focus auto-null when the focused gap is deleted; delete-missing → 404;
  ownership/404; validation (empty add, over-length, empty body → 422); dedup
  no-op.
- **Frontend (vitest):** chip add and delete call the right endpoints with the
  ETag; 412 triggers refetch + toast; ETag is threaded from GET into writes and
  refreshed from write responses; level control PATCHes.

## 8. Risks / watch items

- **ETag over the whole profile, not per-field.** A concurrent agent write to
  *any* field invalidates the user's ETag even if they edit a different field.
  Acceptable: agent writes are infrequent per turn and the 412 → refetch loop is
  cheap; per-field ETags are over-engineering for a single-user profile.
- **URL-encoding of item strings in the DELETE path.** Items can contain spaces
  and punctuation; the client must `encodeURIComponent` and the server must
  decode and match after strip. Covered by a test with a spaced item.
- **Mutual-exclusion + focus interaction.** Adding a gap to `mastered_concepts`
  removes it from `confirmed_gaps`; if it was also the `focus_target_gap`, the
  focus is now dangling. Extend the focus auto-null rule to this path too:
  whenever an item leaves `confirmed_gaps` by any edit, null the focus if it
  matched. (Single shared helper.)
