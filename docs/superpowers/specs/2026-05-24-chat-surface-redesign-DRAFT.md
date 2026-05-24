# Chat Surface Redesign — Brainstorming Draft (DEFERRED)

> **Status: DRAFT — paused 2026-05-24.** Captured mid-brainstorming so we can
> resume after Phase 7 PR #17 lands in `dev`. Not a finalized spec; do not
> implement from this file. Resume by re-invoking
> `superpowers:brainstorming` with this file as the input.

## Problem

Tutor replies render raw markdown in the chat surface. From a live screenshot
on 2026-05-24:

```
**Efficiency.**                    ← stars visible, no bold render
*"As my data..."*                  ← stars visible, no italic render
$O(n)$ or $O(log n)$               ← dollar signs visible, no math render
```

Root cause: `frontend/src/views/SessionView.vue:133` renders message content
inside `<p class="content">{{ m.content }}</p>` with `white-space: pre-wrap`.
No markdown parser, no math renderer, no code highlighter.

## Scope (already chosen, per user)

| Decision | Choice |
|---|---|
| Surface | **Full chat redesign** — message bubbles, composer, layout, polish |
| Markdown features | **All GFM** — bold/italic/lists/headings + fenced code w/ highlight + LaTeX math + tables/blockquotes/task lists |
| Streaming | **Token streaming (ChatGPT-style)** — SSE from backend, progressive render |
| Visual reference | ChatGPT / Claude.ai-tier polish |
| Existing personality | Keep coral spark + Aura tokens; don't lose the editorial feel |

## PR strategy (paused)

User direction: finish merging Phase 7 PR #17 first. Chat work resumes on a
fresh branch off `dev` after `phase/7-auth-postgres-pgvector-costcap` lands.
Likely branch name when resumed: **`phase/7.5-chat-redesign`**.

## Current code surface (mapped 2026-05-24)

### Frontend

- `frontend/src/views/SessionView.vue` — 1298 lines, monolithic. Owns: header,
  cost-cap banner, daily-cap banner, empty state w/ quick prompts, message
  list, typing indicator, error banner, upload status, composer (native
  textarea + attach + send), summary dialog. Custom CSS (~600 lines), Aura
  tokens, breath-spark animation. Composer is well-built (sticky, focus-ring,
  grid layout). **Renders messages as plain text — this is the bug.**
- `frontend/src/stores/session.js` — Pinia store. `sendMessage()` appends a
  user message synchronously, then pushes the assistant message on `postChat`
  resolve with `{role, content, message_id, tool_calls, citations}`. Cost-cap
  + daily-cap 429 handling already in place. No streaming.
- `frontend/src/services/chatApi.js` — 8 lines, just `apiPost('/chat', ...)`.
- `frontend/src/services/apiClient.js` — fetch wrapper; reads `X-Cost-Warning`
  header and dispatches to `costBus`. Bearer token injection from auth store.
- `frontend/package.json` deps as of branch HEAD: `@primeuix/themes`,
  `@supabase/supabase-js`, `pinia`, `primeicons`, `primevue`, `vue`,
  `vue-router`. **No markdown / katex / highlight libs yet.**

### Backend

- `backend/routes/chat.py` — single `POST /api/chat` endpoint. Cost-cap check,
  rate-limit, JWT, calls `tutor.run()`, persists user + assistant message,
  returns `ChatResponse(assistant_message, message_id, tool_calls, citations)`
  as one JSON. Sets `X-Cost-Warning` header on soft breach.
- `backend/agent/tutor.py` — async loop, up to `MAX_ITERS=8` `litellm.acompletion`
  calls. Tool dispatch happens server-side between calls. Cost recorded per
  call via `litellm.completion_cost`. Mid-loop hard-cap circuit breaker.
  Returns `(reply, tool_calls, citations)`.
- `backend/contracts/models.py` — `ChatResponse` schema (regenerated from
  `docs/api/openapi.yaml`; edit YAML, then run `gen_contracts.py`).

## Open design questions (when we resume)

### 1. Library choice (recommendation pending user pick)

Trade-offs:

| Stack | Bundle (gz) | Plugin ecosystem | Notes |
|---|---|---|---|
| markdown-it + markdown-it-katex + highlight.js (selected langs) | ~280 KB | huge | mature, GFM via plugins, custom rules. Recommendation. |
| markdown-it + markdown-it-katex + shiki | ~600 KB+ | medium | shiki = TextMate-grade highlight, themed, heavier |
| marked + katex + highlight.js | ~250 KB | medium | marked lighter than mdit but fewer plugins |
| markdown-it + temml + highlight.js | ~200 KB | huge | temml (MathML output) lighter than katex, less widely tested |

Open: confirm langs to load eagerly. Likely: `python, javascript, typescript, sql, bash, json, yaml, markdown` covers tutor's surface.

### 2. Tool-call surfacing during stream

Today: tool calls happen server-side, dispatched in the loop, surfaced only
after final reply lands. With SSE we can stream events. Three patterns:

- **Silent** — only stream final-answer tokens; tool calls invisible to user
- **Status pill** — "Searching your document…" / "Updating profile…" chips
  between user message and final answer
- **Collapsible reasoning block** — Claude.ai-style "Thought for 3s" panel
  the user can expand

Recommendation pending user pick. Status pill is the simplest middle ground.

### 3. Cost cap × streaming

Today: cost-cap checked pre-call (raise 429 immediately) and post-call (set
header). With streaming, options:

- **Cap-check stays pre/post per `acompletion`** — easiest. Stream tokens
  from final acompletion freely; mid-loop check still aborts if a tool round
  triggers the cap. No mid-stream cancel.
- **Mid-stream abort** — wrap the `acompletion(stream=True)` async generator
  in a check that closes the generator if hard cap is crossed mid-token.
  Requires reconciling partial cost (LiteLLM `completion_cost` may need final
  response object, not stream chunks).

Recommendation: pre/post only — simplest, matches current semantics.

### 4. SSE protocol shape

Proposed event types on the `POST /api/chat` SSE stream:

```
event: tool_call_start    data: {"id":"...", "name":"retrieve_chunks"}
event: tool_call_done     data: {"id":"...", "status":"ok"}
event: assistant_delta    data: {"text":"In "}
event: assistant_delta    data: {"text":"computer science, "}
event: citations          data: [{"doc_id":"...", "text":"..."}]
event: cost_warning       data: {"used_usd":"2.10", "soft_cap_usd":"2.00", "hard_cap_usd":"3.00"}
event: done               data: {"message_id":"abc"}
event: error              data: {"code":"daily_cost_cap_reached", ...}
```

Frontend store needs: `appendAssistantDelta(text)`, `setCitations(...)`,
`finalizeMessage(message_id)`. Re-use existing `costBus` for `cost_warning`
events.

Open: cancel semantics (browser `AbortController` on stop button?).

### 5. Component decomposition

`SessionView.vue` is 1298 lines. Likely split:

```
SessionView.vue              shell + routing concerns
├── ChatHeader.vue           title, profile link, end button
├── CapBanners.vue           daily + cost cap banners
├── EmptyState.vue           spark animation, quick prompts
├── MessageList.vue          scroll container + typing indicator
│   ├── UserBubble.vue       coral pill, right-aligned
│   └── AssistantBubble.vue  surface card, left-aligned
│       ├── MarkdownContent.vue   markdown-it render + katex + highlight
│       ├── ToolCallChip.vue      streaming status pills
│       └── CitationsList.vue     dashed-border footer
├── Composer.vue             sticky textarea + attach + send
└── UploadStatus.vue         pending/ready/failed pill
```

Open: how much to keep monolithic for now vs. extract aggressively.

### 6. Visual reference (still need to ask)

User said "same behavior like other chatbots like yours in the web." Both
Claude.ai and ChatGPT have meaningfully different bubble styles, code-block
chrome, and reasoning surfacing. Need a side-by-side mockup decision before
implementing. Push to visual companion when we resume.

## Library install commands (for reference when resumed)

```bash
cd frontend
npm install markdown-it markdown-it-katex highlight.js katex dompurify
npm install --save-dev @types/markdown-it
```

## Backend stream surface (for reference when resumed)

```python
# backend/routes/chat.py
from fastapi.responses import StreamingResponse

@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    async def event_stream():
        async for event in tutor.run_streaming(...):
            yield f"event: {event.type}\ndata: {event.payload_json}\n\n"
    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

Existing non-streaming `POST /api/chat` likely stays as the fallback path for
clients that don't want SSE (tests, robots).

## Resume checklist

When the user is ready to come back to this:

1. Verify Phase 7 PR #17 is merged to `dev` and CI is green.
2. Branch `phase/7.5-chat-redesign` off `dev`.
3. Re-invoke `superpowers:brainstorming`, feed this file as context.
4. Continue from open question 1 (library choice) — get user picks for §1-§6.
5. Visual companion: push library bundle-size comparison + Claude.ai vs
   ChatGPT bubble mockups for §6.
6. Once design approved, write final spec (drop -DRAFT suffix, replace with
   `2026-XX-XX-chat-surface-redesign-design.md`), then invoke
   `superpowers:writing-plans` per the brainstorming skill's terminal step.
