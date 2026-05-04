# Phase 0 — Validation Spike

Tests whether two manually-crafted profiles produce structurally different tutor
responses on the same topic, and whether the differences hold across a longer
conversation (DevPlan §Phase 0).

## Setup

```bash
cd spike/
python -m venv .venv
.venv/Scripts/activate   # Windows
pip install -r requirements.txt
```

Create `spike/.env` (gitignored):

```
GEMINI_API_KEY=your_key_here
```

## Run

```bash
# Turn-1 comparison only (~6 LLM calls, fast)
python run_comparison.py

# 8-turn persistence run (~24 LLM calls, slower)
python run_persistence.py
```

Outputs land in `spike/outputs/{knowledge|guidance|engagement}/{A|B}_*.md`.

## Outputs

| File | Committed? |
|---|---|
| `outputs/{pair}/{side}_transcript.md` | Yes |
| `outputs/{pair}/{side}_turn8.md` | No (gitignored, recoverable from transcript) |
| `outputs/{pair}/{side}_turn1.md` | No (gitignored, recoverable from run_comparison.py) |
| `decision.md` | Yes |

## Decision

After running both scripts, read `outputs/` side-by-side and fill in
`decision.md` with the four-way verdict per DevPlan §Phase 0:

- **Pass** — all three pairs differ at turn 1 AND turn 8.
- **Knowledge only** — pair 1 differs; pairs 2 & 3 don't. Drop interaction_preferences.
- **First turn only** — all differ at turn 1 but converge by turn 8. Iterate prompt (max 3x).
- **Fail** — outputs differ only in preamble. Stop, rebuild spec.

## Spec drift note

Spec §6 names Claude as the default LLM. This spike uses Gemini (gemini-2.5-flash)
via LiteLLM, matching the existing `.env.example` placeholder. If the spike
passes, Claude must be re-validated on the first real Phase 2 run before the
pass can be considered fully confirmed.
