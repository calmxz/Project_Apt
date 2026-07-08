"""Token-volume controls for the tutor turn (roadmap P2).

Pure functions, no DB, no LLM. Char-based rather than tokenizer-based:
deterministic, zero hot-path tokenizer cost, model-independent. 6000 chars
approximates a 1.5k-token per-message cap at ~4 chars/token.
"""

import json

TRUNCATION_MARKER = "\n...[truncated]...\n"
MAX_MESSAGE_CHARS = 6000
_HEAD_FRACTION = 0.7  # keep more head than tail: openings carry the intent


def truncate_message(content, max_chars: int = MAX_MESSAGE_CHARS):
    """Cap a history message's content, preserving head and tail around an
    explicit marker so the model sees that material was elided. Returns the
    input unchanged when it fits (or is None/empty)."""
    if not content or len(content) <= max_chars:
        return content
    budget = max_chars - len(TRUNCATION_MARKER)
    head = int(budget * _HEAD_FRACTION)
    tail = budget - head
    return content[:head] + TRUNCATION_MARKER + content[-tail:]


_EXCERPT_SENTINEL = "<document_excerpt"
_STUB_PREFIX = "[superseded retrieval:"


def _excerpt_stub(content: str) -> str:
    """One-line replacement for a superseded retrieval payload, retaining
    just enough (doc ids + names) for the model to re-request if needed."""
    try:
        payload = json.loads(content)
        chunks = ((payload.get("data") or {}).get("chunks")) or []
        ids = sorted({str(c.get("doc_id")) for c in chunks if c.get("doc_id")})
        names = sorted({str(c.get("doc_name")) for c in chunks if c.get("doc_name")})
        detail = ", ".join(ids + names) or "unknown"
        count = len(chunks)
    except Exception:  # noqa: BLE001 - stub must never fail the turn
        detail = "unparseable payload"
        count = 0
    return f"{_STUB_PREFIX} {count} chunks from {detail}; a newer retrieval supersedes this]"


def prune_superseded_excerpts(messages: list[dict]) -> None:
    """In-place: stub retrieval payloads from earlier dispatch ROUNDS, keeping
    every carrier in the newest round. A round is all tool results answering
    one assistant tool-call message, so sibling retrievals dispatched together
    survive together (they cannot supersede each other). Transport fields are
    preserved; assistant and non-retrieval tool messages are never touched."""
    round_key = None
    carriers_by_round: dict[int, list[int]] = {}
    for i, m in enumerate(messages):
        if m.get("role") == "assistant":
            round_key = i
        elif m.get("role") == "tool" and _EXCERPT_SENTINEL in (m.get("content") or ""):
            # No dispatching assistant message seen yet (malformed/synthetic
            # transcript) -> fall back to the carrier's own position so it
            # doesn't get silently grouped as a "sibling" of an unrelated
            # carrier that also lacks a preceding assistant message.
            key = round_key if round_key is not None else i
            carriers_by_round.setdefault(key, []).append(i)
    if len(carriers_by_round) < 2:
        return
    newest = max(carriers_by_round)
    for rk, idxs in carriers_by_round.items():
        if rk == newest:
            continue
        for i in idxs:
            if not messages[i]["content"].startswith(_STUB_PREFIX):
                messages[i]["content"] = _excerpt_stub(messages[i]["content"])
