"""Deterministic knowledge-level assignment from a diagnostic check batch."""
from __future__ import annotations


def level_for_score(n_correct: int, total: int) -> str:
    """Map a diagnostic score to a coarse knowledge level.

    Tuned for a 3-question batch: 0-1 beginner, 2 intermediate, 3 advanced.
    Generalizes by ratio for other batch sizes."""
    if total <= 0:
        return "beginner"
    ratio = n_correct / total
    if ratio >= 1.0:
        return "advanced"
    if ratio >= (2 / 3):
        return "intermediate"
    return "beginner"
