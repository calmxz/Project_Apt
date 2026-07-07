"""context_budget: char-based token-volume controls (roadmap P2).

Char-based on purpose: deterministic, no tokenizer in the billed turn path,
model-independent tests. 6000 chars approximates a 1.5k-token cap at ~4
chars/token.
"""
from agent import context_budget
from agent.context_budget import MAX_MESSAGE_CHARS, TRUNCATION_MARKER, truncate_message


def test_short_content_unchanged():
    assert truncate_message("hello") == "hello"


def test_content_at_cap_unchanged():
    s = "x" * MAX_MESSAGE_CHARS
    assert truncate_message(s) == s


def test_content_over_cap_truncated_to_cap_with_marker():
    s = "H" * 5000 + "T" * 5000
    out = truncate_message(s)
    assert len(out) == MAX_MESSAGE_CHARS
    assert TRUNCATION_MARKER in out
    assert out.startswith("H")
    assert out.endswith("T")


def test_head_tail_split_preserves_both_ends():
    s = "".join(str(i % 10) for i in range(20000))
    out = truncate_message(s, max_chars=1000)
    head, tail = out.split(TRUNCATION_MARKER)
    assert s.startswith(head)
    assert s.endswith(tail)
    assert len(head) > len(tail) > 0


def test_none_and_empty_are_safe():
    assert truncate_message(None) is None
    assert truncate_message("") == ""
