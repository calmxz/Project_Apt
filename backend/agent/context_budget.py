"""Token-volume controls for the tutor turn (roadmap P2).

Pure functions, no DB, no LLM. Char-based rather than tokenizer-based:
deterministic, zero hot-path tokenizer cost, model-independent. 6000 chars
approximates a 1.5k-token per-message cap at ~4 chars/token.
"""

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
