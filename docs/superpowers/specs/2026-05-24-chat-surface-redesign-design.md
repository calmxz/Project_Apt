# Chat Surface Redesign — Design Spec

**Status:** Approved 2026-05-24. Supersedes `2026-05-24-chat-surface-redesign-DRAFT.md`.
**Target branch:** `phase/7.5-chat-redesign` (cut from `dev` after Phase 7 PR #17 merged).
**Scope:** Full chat surface redesign — message rendering pipeline, SSE token streaming, Claude.ai-tier visual polish, aggressive component decomposition.

## 1. Problem

Tutor replies render raw markdown. `frontend/src/views/SessionView.vue:133` displays message content inside `<p class="content">{{ m.content }}</p>` with `white-space: pre-wrap`. No markdown parser, no math, no code highlight. Stars, dollar signs, and fences appear literally.

In addition, the whole turn arrives as one JSON blob — no progressive token render — so long RAG-heavy turns produce 3-5 seconds of silent waiting.

## 2. Goals

1. GFM markdown render with code highlight + LaTeX math + tables/blockquotes/task lists.
2. Token-streamed assistant replies via SSE (ChatGPT-style).
3. Tool-call status surfaced to user as inline status pills during stream.
4. Claude.ai-tier visual polish, preserving Aura cream/coral personality.
5. Stop button + clean cancellation with cost-accurate accounting.
6. Decompose 1298-line `SessionView.vue` into a `~150`-line shell + 10 focused children.
7. Preserve existing `POST /api/chat` JSON endpoint as a non-streaming fallback for tests and contract-strict clients.

## 3. Non-Goals

- Message editing, regeneration, multi-turn branching — deferred.
- Virtualized message list (160-msg cap is fine for v1).
- Mid-stream cost-cap abort (cap-check stays pre/post per `acompletion`).
- Hybrid streaming for tool-call args — only the final assistant text streams.

## 4. Architecture

```
Frontend (Vue 3 + Pinia)                Backend (FastAPI)              Supabase
─────────────────────────                ──────────────                  ────────
SessionView (shell)                                                    
 ├─ MessageList                          POST /api/chat        (json)  app schema
 │   └─ AssistantBubble                  POST /api/chat/stream (SSE) ◀─── pgvector
 │       └─ MarkdownContent                 │                          ─── auth (JWT)
 │           (markdown-it +                 │                          
 │            katex + hljs +                ▼                          
 │            dompurify)                  TutorAgent.run_streaming()
 │                                          │
 ├─ ToolCallChip (status pill)         emit: tool_call_start
 ├─ CitationsList                       emit: tool_call_done
 ├─ Composer (Stop button + send)      emit: assistant_delta…
 └─ chatStreamService                  emit: citations
     (fetch + ReadableStream +         emit: cost_warning
      AbortController)                 emit: done | error | cancelled
```

Two endpoints share one core. Existing `POST /api/chat` keeps current JSON semantics and contracts. New `POST /api/chat/stream` returns `text/event-stream`. Both call `TutorAgent`; the agent gets a new `run_streaming()` async generator that yields events. Non-streaming `run()` is retained and continues to return `(reply, tool_calls, citations)`.

## 5. Component Decomposition (aggressive)

```
frontend/src/components/chat/
├─ ChatHeader.vue           title, profile link, end-session button
├─ CapBanners.vue           daily-cap + cost-cap banners
├─ EmptyState.vue           coral breath-spark + quick prompts
├─ MessageList.vue          scroll container + auto-scroll + typing indicator
│  ├─ UserBubble.vue        coral pill, right-aligned
│  └─ AssistantBubble.vue   soft white card (Claude.ai-style)
│     ├─ MarkdownContent.vue   markdown-it pipeline (§7)
│     ├─ ToolCallChip.vue      status pills, one per tool call
│     └─ CitationsList.vue     dashed-border footer, doc + page
├─ Composer.vue             sticky textarea, attach button, send/stop button
└─ UploadStatus.vue         pending/ready/failed pill
```

`SessionView.vue` shrinks to a `~150`-line shell: route binding, store wiring, layout grid, top-level error boundary. No render logic.

Each component owns `<style scoped>`. Shared tokens stay in `frontend/src/assets/aura-tokens.css`; new tokens added there:

- `--chat-bubble-bg`, `--chat-bubble-border`, `--chat-bubble-shadow`
- `--code-block-bg`, `--code-block-border`, `--code-block-text`
- `--math-bg`, `--math-accent`
- `--tool-pill-bg`, `--tool-pill-border`, `--tool-pill-text`

### 5.1 Component contracts

| Component | Props | Emits |
|---|---|---|
| `MessageList` | `messages: Message[]`, `streamingMessage: Message \| null`, `streamState: StreamState` | `scroll-pinned`, `user-scrolled-away` |
| `UserBubble` | `content: string` | — |
| `AssistantBubble` | `message: Message`, `streaming: boolean` | — |
| `MarkdownContent` | `text: string`, `streaming: boolean` | — |
| `ToolCallChip` | `tool_call: ToolCall`, `state: 'running' \| 'done' \| 'error'` | — |
| `CitationsList` | `citations: Citation[]` | — |
| `Composer` | `disabled: boolean`, `streamState: StreamState` | `send(text)`, `stop()`, `attach(file)` |
| `CapBanners` | (none — reads from `costBus` + auth store) | — |
| `EmptyState` | (none) | `quick-prompt(text)` |
| `ChatHeader` | `session: Session` | `end-session` |
| `UploadStatus` | `upload: Upload` | — |

## 6. Frontend state (Pinia `session.js`)

Existing state preserved. Extensions:

```js
state: () => ({
  // existing
  session_id, messages, error, isLoading, ...,

  // new for streaming
  streamingMessage: null,     // { role: 'assistant', content: '', tool_calls: [], citations: [], message_id: null, status: 'streaming' }
  streamState: 'idle',        // 'idle' | 'streaming' | 'tool_running' | 'stopping'
  abortController: null,      // AbortController bound to current SSE fetch
})
```

Actions:

- `sendMessage(text)` — pushes user message; opens SSE via `chatStreamService.stream()`; mounts `abortController`; transitions `streamState: 'streaming'`.
- `stopStream()` — calls `abortController.abort()`; transitions `streamState: 'stopping'`.
- `appendAssistantDelta(text)` — concatenates to `streamingMessage.content`, leaves `streamingMessage` in place.
- `recordToolCall(start | done | error)` — appends to `streamingMessage.tool_calls[]`; transitions `streamState: 'tool_running' ↔ 'streaming'`.
- `setCitations(citations)` — assigns to `streamingMessage.citations`.
- `finalizeMessage(message_id)` — sets `streamingMessage.message_id`, pushes to `messages[]`, clears `streamingMessage`, transitions `streamState: 'idle'`.
- `handleCancelled(message_id, partial_content, cost_estimate_usd)` — sets `streamingMessage.status = 'cancelled'`, persists via same `finalizeMessage`-like path.

## 7. Markdown pipeline

### 7.1 Libraries

```
markdown-it          GFM core
markdown-it-katex    LaTeX math via KaTeX
highlight.js         syntax highlight (selected langs only)
katex                math rendering
dompurify            sanitize rendered HTML (belt-and-suspenders;
                     markdown-it has html: false by default)
```

Bundle target: `~280 KB` gzipped.

Eager-loaded highlight.js languages (covers tutor surface): `python, javascript, typescript, sql, bash, json, yaml, markdown`. Lazy-load others on demand via `highlight.js/lib/languages/<lang>`.

Configuration:

```js
const md = new MarkdownIt({
  html: false,         // keep html disabled
  linkify: true,
  breaks: false,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
    }
    return '';
  },
});
md.use(mdKatex, { throwOnError: false, errorColor: 'var(--math-accent)' });
```

### 7.2 Delimiter-aware streaming render (BLOCKER fix)

KaTeX throws on unclosed `$O(log `; highlight.js misclassifies partial fences. Mid-stream policy:

`MarkdownContent.vue` keeps a `parseSafeText` computed property that scans the live buffer and returns the prefix of `text` that ends *outside* any open math/code region. Any open region (and everything after it) is held back and rendered as literal monospace text in a "deferred" span until its closing delimiter arrives.

State machine over the buffer:

| Open delimiter | Look for close |
|---|---|
| `$$` (display math) | next `$$` |
| `$` (inline math) | next `$` on same line, no newline allowed |
| ` ``` ` (fenced code) | next ` ``` ` at line start |
| `` ` `` (inline code) | next `` ` `` on same line |

When a region closes, the buffer is reparsed and `parseSafeText` advances. On `done` event, full buffer re-runs through markdown-it one final time to flush any still-open region (defensive — server should not emit unclosed delimiters at `done`).

Output is then passed through DOMPurify with the default whitelist (plus `<math>`, `<semantics>`, `<annotation>` for MathML; KaTeX HTML mode used by default — MathML annotations only if KaTeX `output: 'htmlAndMathml'`).

### 7.3 Code-block chrome

Language tag + copy button rendered via a custom `markdown-it` rule (`code_block`/`fence` renderer override). Copy button uses Clipboard API; no library.

## 8. SSE protocol

### 8.1 Endpoint

`POST /api/chat/stream`. Request body identical to `POST /api/chat` (same `ChatRequest` Pydantic). Response: `text/event-stream`.

### 8.2 Event types

```
event: tool_call_start
data: {"id":"call_abc","name":"retrieve_chunks","args":{"query":"binary search"}}

event: tool_call_done
data: {"id":"call_abc","status":"ok","summary":"5 passages"}

event: assistant_delta
data: {"text":"Binary search "}

event: citations
data: [{"doc_id":"algo-ch3","page":42,"text":"..."}]

event: cost_warning
data: {"used_usd":"2.10","soft_cap_usd":"2.00","hard_cap_usd":"3.00"}

event: done
data: {"message_id":"msg_123","total_cost_usd":"0.0042"}

event: cancelled
data: {"message_id":"msg_123","partial_content_chars":482,"estimated_cost_usd":"0.0019"}

event: error
data: {"code":"daily_cost_cap_reached","message":"..."}
```

Ordering guarantees:

1. Tool events for a given `id` always emit `tool_call_start` before `tool_call_done`.
2. `citations` emits at most once per turn, after all `tool_call_done` events.
3. `assistant_delta` events are ordered; client concatenates in receive order.
4. Exactly one terminal event per turn: `done`, `cancelled`, or `error`.

### 8.3 Frontend service

`frontend/src/services/chatStreamService.js`:

```js
export function stream({ session_id, message, signal, onEvent }) {
  return fetch('/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify({ session_id, message }),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    signal,
  }).then(resp => parseSSE(resp.body, onEvent));
}
```

Native `EventSource` is not used because it doesn't support POST. Use `fetch` + `ReadableStream` + manual SSE framing parser. `AbortController.signal` cancels the read.

## 9. Cost-cap semantics

Existing semantics preserved (pre-call check raises 429; post-call sets `X-Cost-Warning`). Adapted for streaming:

- **Pre-call**: cap-check before each `acompletion`. If hard cap exceeded, emit `error` event with `code: "daily_cost_cap_reached"` on SSE; non-streaming `/api/chat` continues to raise HTTP 429.
- **Post-call**: after each `acompletion`, compute cost via `litellm.completion_cost(response_obj)` (works for stream and non-stream). If soft cap crossed, SSE emits `cost_warning` event; non-streaming `/api/chat` continues to set `X-Cost-Warning` header.
- **No mid-stream cap abort**. A stream in progress runs to completion.

### 9.1 Cancel-cost estimation

On `Stop` button or client disconnect, `litellm.completion_cost` cannot be called (no final response object). Cost is estimated from streamed deltas:

```python
# backend/services/cost_meter.py
def estimate_cancelled_cost(model: str, delta_text: str, prompt_tokens: int) -> Decimal:
    output_tokens = len(tokenizer_for(model).encode(delta_text))
    prompt_rate = MODEL_RATES[model]['input_per_1k']
    output_rate = MODEL_RATES[model]['output_per_1k']
    return (Decimal(prompt_tokens) * prompt_rate + Decimal(output_tokens) * output_rate) / Decimal(1000)
```

`prompt_tokens` is captured from the pre-stream `litellm.token_counter(model, messages=...)` call (already invoked for pre-call cap-check). A new constant `MODEL_RATES` table lives in `backend/services/cost_meter.py` keyed by LiteLLM model id. Initial entries cover the currently-used model(s); kept in sync manually when models swap (LiteLLM does not expose per-model rate tables programmatically).

The estimate is written to `daily_cost_ledger` like any other call. Tests must guard against estimator drift > 10% from final-response cost for non-cancelled calls.

## 10. Stop / cancel semantics

### 10.1 Frontend

`Composer.vue` swaps Send → Stop while `streamState !== 'idle'`. Stop calls `session.stopStream()` which calls `abortController.abort()`. The `fetch` Promise rejects with `AbortError`; service catches and is a no-op (the server emits `cancelled` on its end).

### 10.2 Backend cancellation pattern

`POST /api/chat/stream` handler:

```python
async def chat_stream(req: ChatRequest, request: Request, user_id, db):
    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        task = asyncio.create_task(
            tutor.run_streaming(req, user_id, db, on_event=queue.put_nowait)
        )
        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.25)
                except asyncio.TimeoutError:
                    continue
                yield format_sse(event)
                if event.type in ('done', 'error', 'cancelled'):
                    break
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await finalize_cancelled_message_if_needed(db, ...)
    return StreamingResponse(event_stream(), media_type='text/event-stream')
```

`tutor.run_streaming()` is structured so its inner `litellm.acompletion(stream=True)` call honors `asyncio.CancelledError`: on cancel, it persists the partial assistant message with `status='cancelled'` and `cancelled_at=now()`, records estimated cost via §9.1, and re-raises.

### 10.3 Database schema

`messages` table gains two columns:

```sql
ALTER TABLE messages
  ADD COLUMN status TEXT NOT NULL DEFAULT 'complete',  -- 'complete' | 'cancelled' | 'error'
  ADD COLUMN cancelled_at TIMESTAMPTZ NULL;
```

Alembic migration in `backend/db/alembic/versions/`. Existing rows backfill `status='complete'`. The resume-session flow (Phase 3) reads `status` and renders a "(stopped)" marker inline in `AssistantBubble.vue` for `status='cancelled'`.

## 11. Tool-call surfacing

`ToolCallChip.vue` props: `{ tool_call, state }`. Visual states:

- `running` — pulsing coral dot + tool-specific label ("Searching your document…", "Updating profile…", "Recording answer…")
- `done` — solid coral dot + summary ("Found 5 passages", "Profile updated", "Answer recorded")
- `error` — muted grey dot + ("Search failed — continuing")

Tool-name → label map lives in `frontend/src/components/chat/toolLabels.js`. Chips render inside `AssistantBubble.vue` before `MarkdownContent.vue`, stacked vertically if multiple tools fired. After `done` event for the turn, chips fade to a low-opacity collapsed strip (single line: "Searched · Updated profile") so they don't dominate the bubble on later scrolls.

## 12. Visual style (§6 = Claude.ai bubble)

| Element | Style |
|---|---|
| User bubble | Coral pill (`var(--coral-spark)`), right-aligned, `border-radius: 18px 18px 4px 18px`, max 75% width |
| Assistant bubble | Soft white card, `--chat-bubble-bg: #fff`, `--chat-bubble-border: rgba(0,0,0,0.06)`, `--chat-bubble-shadow: 0 1px 3px rgba(0,0,0,0.04)`, `border-radius: 14px`, max 92% width |
| Code block | `--code-block-bg: #f7f3ed` (warm cream), `--code-block-border: rgba(0,0,0,0.06)`, header strip w/ lang tag + copy btn |
| Inline code | `#f4e9d8` bg, `#8a4a00` text, slight padding |
| Math (display) | `--math-bg: #fff8ed`, 3px `--math-accent: #ff6b5b` left border, italic |
| Math (inline) | Same accent color, no background |
| Tool pill | `--tool-pill-bg: rgba(255,107,91,0.08)`, `--tool-pill-border: rgba(255,107,91,0.2)`, `--tool-pill-text: #c44` |
| Citations | Dashed-border top, `font-size: 11px`, muted text, doc name + page numbers |

Aura tokens preserved. Breath-spark animation on `EmptyState.vue` unchanged.

## 13. Error handling

- **Network drop mid-stream** — `chatStreamService` catches read error, dispatches `error` event with `code: 'stream_disconnected'`. Frontend persists partial message (same path as `cancelled`, `status='cancelled'`) and shows reconnect toast. Server-side, the same `request.is_disconnected()` path runs — partial message lands as `status='cancelled'` (not `'error'`); `status='error'` is reserved for server-originated failures (LLM provider error, tool exception bubble).
- **Tool error** — server emits `tool_call_done` with `status: 'error'`, agent continues. ToolCallChip shows error state.
- **KaTeX parse error post-close** — `throwOnError: false` renders in `--math-accent` color with raw source.
- **DOMPurify strip** — if sanitizer removes anything, log to console in dev; production silent. Sanitizer never throws.
- **Cost cap reached mid-loop** — pre-call check raises; emitted as `error` event with `code: 'daily_cost_cap_reached'`. Existing 429 path on `/api/chat` (non-streaming) preserved.

## 14. Testing strategy

| Layer | What | Where |
|---|---|---|
| Unit (frontend) | Markdown delimiter scanner, SSE parser, Pinia stream actions | `frontend/src/__tests__/` (vitest) |
| Component (frontend) | Each new chat component, snapshot + interaction | `frontend/src/components/chat/__tests__/` |
| Unit (backend) | `tutor.run_streaming` event sequence, cost estimator, cancel path | `backend/tests/test_tutor_stream.py` |
| Integration (backend) | `/api/chat/stream` end-to-end with mock LLM, cancellation, cost-cap pre-call | `backend/tests/test_chat_stream_route.py` |
| Contract | SSE event shapes match `docs/api/openapi.yaml` (extended w/ event schemas as `x-sse-events`) | `backend/scripts/gen_contracts.py` |
| E2E | Send → stream → render → stop → resume | `frontend/tests/e2e/` (Playwright, gated `continue-on-error: true` through this phase) |

Reliability checkpoint: stream cancellation cleanup (no leaked LiteLLM tasks, ledger balanced) must pass on first PR. Below threshold blocks merge.

## 15. Migration / sequencing

Implementation likely splits across 3 PRs (the implementation plan in `writing-plans` will finalize):

1. **PR 1 — markdown render only.** Add libs, build `MarkdownContent.vue` + `CitationsList.vue` + `ToolCallChip.vue` (static, no stream), wire into existing `SessionView.vue` minimally. Keeps `POST /api/chat` JSON path. Ships visual upgrade without backend churn.
2. **PR 2 — SSE backend + stream service.** New endpoint, `tutor.run_streaming`, cancel path, schema migration. Frontend opts in via feature flag (`VITE_CHAT_STREAM=true`). Both paths coexist.
3. **PR 3 — full component split + Claude.ai polish + stop button.** Pull out `MessageList` / `UserBubble` / `AssistantBubble` / `ChatHeader` / `CapBanners` / `EmptyState` / `Composer` / `UploadStatus`. Apply visual tokens. Flip flag default.

This sequence keeps each PR shippable and bisectable. The implementation plan owns the final task ordering.

## 16. Open items deferred to plan

- Message virtualization (160-msg cap acceptable for v1; revisit if Phase 8 onboarding adds long sessions).
- Resume-stream after reconnect (current spec re-sends as a new turn).
- Per-language code-block lazy load priority (initial eager-load list in §7.1 may need tuning after watching prod usage).
