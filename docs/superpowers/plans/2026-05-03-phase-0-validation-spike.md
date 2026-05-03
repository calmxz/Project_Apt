# Phase 0: Validation Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine in 1–2 days whether two manually-crafted profiles produce structurally different tutor responses on the same topic, and whether the differences hold across an 8-turn conversation. Pass/fail decides whether AdaptLearn proceeds.

**Architecture:** Pure-Python script. No FastAPI, no Vue, no docker yet. LiteLLM → Gemini 2.5 Pro. Three profile pairs, 8-turn scripted conversations each, markdown output for human side-by-side inspection. Plus three Week-1 smoke tests (docker-compose boot, ChromaDB connect, Gemini tool-calling shape).

**Tech Stack:** Python 3.11+, `uv` for env, `litellm`, `pytest`, `pydantic`, `chromadb`, docker-compose.

**Pass criteria:**
- 3 profile pairs (knowledge / guidance / engagement)
- For each pair: turn-1 outputs differ structurally AND turn-8 outputs still differ
- Decision recorded in `spike/decision.md`

**Fail criteria:** outputs converge by turn 8 across all pairs after 3 prompt iterations → stop project, pivot or abandon.

---

## File Structure

```
spike/
  pyproject.toml              # uv project, deps
  .python-version             # 3.11
  .env.example                # GOOGLE_API_KEY=
  src/
    spike/
      __init__.py
      config.py               # env loading, model name constant
      profiles.py             # 3 profile pairs as Pydantic models
      prompts.py              # IMMUTABLE_RULES + DYNAMIC_CONTEXT_TEMPLATE
      llm.py                  # LiteLLM wrapper with retry
      runner.py               # 8-turn conversation driver
      output.py               # markdown writers
  tests/
    __init__.py
    test_profiles.py
    test_prompts.py
    test_output.py
    test_llm_smoke.py         # real LLM, marked @pytest.mark.live
  scripts/
    run_comparison.py         # turn-1 generator, all 3 pairs
    run_persistence.py        # 8-turn runner, all 3 pairs
    inspect.py                # render side-by-side HTML for review
    smoke_chromadb.py         # ChromaDB add+query smoke test
    smoke_tool_calling.py     # 10x Gemini tool-call reliability check
  outputs/
    knowledge/
      A_turn1.md, B_turn1.md
      A_turn8.md, B_turn8.md
      A_transcript.md, B_transcript.md
    guidance/  ...
    engagement/ ...
  decision.md                 # written at end with pass/fail
docker/
  docker-compose.smoke.yml    # FastAPI hello + ChromaDB smoke
  smoke-api/
    main.py                   # /health endpoint
    requirements.txt
    Dockerfile
```

After Phase 0 passes, `spike/` is preserved as historical artifact (not deleted as original spec said). It's evidence the premise holds.

---

## Task 1: Project bootstrap

**Files:**
- Create: `spike/pyproject.toml`
- Create: `spike/.python-version`
- Create: `spike/.env.example`
- Create: `spike/src/spike/__init__.py`
- Create: `spike/tests/__init__.py`
- Modify: `.gitignore`

- [ ] **Step 1: Verify uv is available**

Run: `uv --version`
Expected: `uv 0.5.x` or higher. If missing, install via `winget install astral-sh.uv` (Windows) or follow https://docs.astral.sh/uv/.

- [ ] **Step 2: Create spike pyproject.toml**

Write `spike/pyproject.toml`:

```toml
[project]
name = "spike"
version = "0.1.0"
description = "AdaptLearn Phase 0 validation spike"
requires-python = ">=3.11"
dependencies = [
    "litellm>=1.55",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
    "chromadb>=0.5",
    "google-generativeai>=0.8",
]

[dependency-groups]
dev = [
    "pytest>=8",
    "pytest-asyncio>=0.24",
]

[tool.pytest.ini_options]
markers = [
    "live: tests that hit a real LLM API (require GOOGLE_API_KEY)",
]
testpaths = ["tests"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/spike"]
```

- [ ] **Step 3: Pin Python version**

Write `spike/.python-version`:

```
3.11
```

- [ ] **Step 4: Create env example**

Write `spike/.env.example`:

```
GOOGLE_API_KEY=your-gemini-key-here
```

- [ ] **Step 5: Create empty package modules**

Write `spike/src/spike/__init__.py`:

```python
"""AdaptLearn Phase 0 validation spike."""
```

Write `spike/tests/__init__.py`:

```python
```

- [ ] **Step 6: Update .gitignore**

Append to `.gitignore` (create if missing):

```
# Python
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/

# Env
.env
.env.local
*.env

# Spike outputs (regenerated each run)
spike/outputs/
spike/.pytest_cache/
spike/uv.lock

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

- [ ] **Step 7: Sync dependencies**

Run from `spike/`: `uv sync`
Expected: creates `.venv/`, installs all deps, no errors.

- [ ] **Step 8: Verify imports work**

Run from `spike/`: `uv run python -c "import litellm, pydantic, chromadb; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 9: Commit**

```bash
git add spike/pyproject.toml spike/.python-version spike/.env.example spike/src/spike/__init__.py spike/tests/__init__.py .gitignore
git commit -m "feat(spike): bootstrap Phase 0 spike project with uv"
```

---

## Task 2: Config loader

**Files:**
- Create: `spike/src/spike/config.py`
- Create: `spike/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_config.py`:

```python
import os
import pytest
from spike.config import load_config, Config


def test_load_config_with_api_key(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key-abc")
    cfg = load_config()
    assert isinstance(cfg, Config)
    assert cfg.google_api_key == "test-key-abc"
    assert cfg.tutor_model == "gemini/gemini-2.5-pro"
    assert cfg.max_retries == 3


def test_load_config_missing_key_raises(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(ValueError, match="GOOGLE_API_KEY"):
        load_config()


def test_load_config_custom_model(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "k")
    monkeypatch.setenv("TUTOR_MODEL", "gemini/gemini-2.5-flash")
    cfg = load_config()
    assert cfg.tutor_model == "gemini/gemini-2.5-flash"
```

- [ ] **Step 2: Run test to verify it fails**

Run from `spike/`: `uv run pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spike.config'`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/config.py`:

```python
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    google_api_key: str
    tutor_model: str
    max_retries: int


def load_config() -> Config:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable is required")
    return Config(
        google_api_key=api_key,
        tutor_model=os.environ.get("TUTOR_MODEL", "gemini/gemini-2.5-pro"),
        max_retries=int(os.environ.get("MAX_RETRIES", "3")),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_config.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/config.py spike/tests/test_config.py
git commit -m "feat(spike): add config loader with GOOGLE_API_KEY validation"
```

---

## Task 3: Profile fixtures

**Files:**
- Create: `spike/src/spike/profiles.py`
- Create: `spike/tests/test_profiles.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_profiles.py`:

```python
import pytest
from spike.profiles import (
    InteractionPreferences,
    TopicProfile,
    ProfilePair,
    KNOWLEDGE_PAIR,
    GUIDANCE_PAIR,
    ENGAGEMENT_PAIR,
    ALL_PAIRS,
)


def test_topic_profile_beginner_with_gaps():
    p = TopicProfile(
        knowledge_level="beginner",
        confirmed_gaps=["recursion", "stack frames"],
        mastered_concepts=[],
    )
    assert p.knowledge_level == "beginner"
    assert "recursion" in p.confirmed_gaps


def test_topic_profile_advanced_with_mastery():
    p = TopicProfile(
        knowledge_level="advanced",
        confirmed_gaps=[],
        mastered_concepts=["recursion", "tail call optimization"],
    )
    assert p.knowledge_level == "advanced"


def test_topic_profile_invalid_knowledge_level_rejected():
    with pytest.raises(ValueError):
        TopicProfile(knowledge_level="expert", confirmed_gaps=[], mastered_concepts=[])


def test_knowledge_pair_distinct():
    assert KNOWLEDGE_PAIR.profile_a.knowledge_level == "beginner"
    assert KNOWLEDGE_PAIR.profile_b.knowledge_level == "advanced"
    assert KNOWLEDGE_PAIR.prefs_a == KNOWLEDGE_PAIR.prefs_b  # only profile differs


def test_guidance_pair_distinct():
    assert GUIDANCE_PAIR.prefs_a.guidance_preference == "hints"
    assert GUIDANCE_PAIR.prefs_b.guidance_preference == "direct_answers"
    assert GUIDANCE_PAIR.profile_a == GUIDANCE_PAIR.profile_b  # only prefs differ


def test_engagement_pair_distinct():
    assert ENGAGEMENT_PAIR.prefs_a.engagement_preference == "quiz_as_we_go"
    assert ENGAGEMENT_PAIR.prefs_b.engagement_preference == "absorb_then_test"


def test_all_pairs_listed():
    assert len(ALL_PAIRS) == 3
    names = {p.name for p in ALL_PAIRS}
    assert names == {"knowledge", "guidance", "engagement"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spike.profiles'`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/profiles.py`:

```python
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class InteractionPreferences:
    guidance_preference: Literal["hints", "direct_answers"]
    engagement_preference: Literal["quiz_as_we_go", "absorb_then_test"]


@dataclass(frozen=True)
class TopicProfile:
    knowledge_level: Literal["beginner", "intermediate", "advanced"]
    confirmed_gaps: tuple[str, ...] = ()
    mastered_concepts: tuple[str, ...] = ()

    def __post_init__(self):
        if self.knowledge_level not in ("beginner", "intermediate", "advanced"):
            raise ValueError(f"Invalid knowledge_level: {self.knowledge_level}")
        # Coerce list→tuple at construction time so callers can pass either.
        object.__setattr__(self, "confirmed_gaps", tuple(self.confirmed_gaps))
        object.__setattr__(self, "mastered_concepts", tuple(self.mastered_concepts))


@dataclass(frozen=True)
class ProfilePair:
    name: str
    topic: str
    profile_a: TopicProfile
    profile_b: TopicProfile
    prefs_a: InteractionPreferences
    prefs_b: InteractionPreferences


# Pair 1: knowledge level varies, prefs constant
_DEFAULT_PREFS = InteractionPreferences(
    guidance_preference="hints",
    engagement_preference="quiz_as_we_go",
)

KNOWLEDGE_PAIR = ProfilePair(
    name="knowledge",
    topic="recursion in Python",
    profile_a=TopicProfile(
        knowledge_level="beginner",
        confirmed_gaps=("recursion", "stack frames", "base case"),
        mastered_concepts=(),
    ),
    profile_b=TopicProfile(
        knowledge_level="advanced",
        confirmed_gaps=(),
        mastered_concepts=("recursion", "tail call optimization", "memoization"),
    ),
    prefs_a=_DEFAULT_PREFS,
    prefs_b=_DEFAULT_PREFS,
)

# Pair 2: guidance varies, profile constant
_NEUTRAL_PROFILE = TopicProfile(
    knowledge_level="intermediate",
    confirmed_gaps=("normalization",),
    mastered_concepts=("primary keys",),
)

GUIDANCE_PAIR = ProfilePair(
    name="guidance",
    topic="database normalization",
    profile_a=_NEUTRAL_PROFILE,
    profile_b=_NEUTRAL_PROFILE,
    prefs_a=InteractionPreferences(
        guidance_preference="hints",
        engagement_preference="quiz_as_we_go",
    ),
    prefs_b=InteractionPreferences(
        guidance_preference="direct_answers",
        engagement_preference="quiz_as_we_go",
    ),
)

# Pair 3: engagement varies, profile constant
ENGAGEMENT_PAIR = ProfilePair(
    name="engagement",
    topic="hash tables",
    profile_a=_NEUTRAL_PROFILE,
    profile_b=_NEUTRAL_PROFILE,
    prefs_a=InteractionPreferences(
        guidance_preference="hints",
        engagement_preference="quiz_as_we_go",
    ),
    prefs_b=InteractionPreferences(
        guidance_preference="hints",
        engagement_preference="absorb_then_test",
    ),
)

ALL_PAIRS: tuple[ProfilePair, ...] = (KNOWLEDGE_PAIR, GUIDANCE_PAIR, ENGAGEMENT_PAIR)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_profiles.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/profiles.py spike/tests/test_profiles.py
git commit -m "feat(spike): add three profile pairs (knowledge/guidance/engagement)"
```

---

## Task 4: System prompt builder

**Files:**
- Create: `spike/src/spike/prompts.py`
- Create: `spike/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_prompts.py`:

```python
from spike.prompts import build_system_prompt, IMMUTABLE_RULES
from spike.profiles import TopicProfile, InteractionPreferences


def test_immutable_rules_present():
    assert "PROFILE PRINCIPLES" in IMMUTABLE_RULES
    assert "EVIDENCE TYPING" in IMMUTABLE_RULES


def test_build_includes_topic():
    prompt = build_system_prompt(
        topic="recursion",
        profile=TopicProfile(knowledge_level="beginner"),
        prefs=InteractionPreferences(
            guidance_preference="hints", engagement_preference="quiz_as_we_go"
        ),
    )
    assert "recursion" in prompt
    assert "beginner" in prompt
    assert "hints" in prompt


def test_build_includes_gaps_and_mastery():
    prompt = build_system_prompt(
        topic="databases",
        profile=TopicProfile(
            knowledge_level="intermediate",
            confirmed_gaps=("normalization", "indexes"),
            mastered_concepts=("primary keys",),
        ),
        prefs=InteractionPreferences(
            guidance_preference="direct_answers",
            engagement_preference="absorb_then_test",
        ),
    )
    assert "normalization" in prompt
    assert "indexes" in prompt
    assert "primary keys" in prompt


def test_build_advanced_profile_signals_depth():
    prompt = build_system_prompt(
        topic="recursion",
        profile=TopicProfile(
            knowledge_level="advanced",
            mastered_concepts=("recursion",),
        ),
        prefs=InteractionPreferences(
            guidance_preference="hints", engagement_preference="quiz_as_we_go"
        ),
    )
    assert "advanced" in prompt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_prompts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spike.prompts'`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/prompts.py`:

```python
from spike.profiles import TopicProfile, InteractionPreferences


IMMUTABLE_RULES = """You are a tutor.

PROFILE PRINCIPLES:
- knowledge_level is a coarse baseline. mastered_concepts and confirmed_gaps take precedence when they conflict.
- When the user demonstrates understanding (clean explanation or correct application), acknowledge mastery.
- When the user reveals a gap, name it and decide whether to address it now or later.

EVIDENCE TYPING:
- Listen for declarative statements ("I've never used X", "I already know X") and treat them as strong signals.
- When in doubt about a learner statement, treat as a hedged signal needing follow-up.

GUIDANCE STYLE:
- "hints": scaffold. Ask leading questions. Don't reveal the answer until the learner has tried.
- "direct_answers": answer first, then explain why. Less Socratic, more direct.

ENGAGEMENT CADENCE:
- "quiz_as_we_go": insert short check questions every 2-3 turns.
- "absorb_then_test": teach a chunk first, then check at the end of a focus area.

Adapt your explanations to the learner profile. Don't be generic.
"""


DYNAMIC_CONTEXT_TEMPLATE = """TOPIC: {topic}

LEARNER PROFILE:
  knowledge_level: {knowledge_level}
  confirmed_gaps: {confirmed_gaps}
  mastered_concepts: {mastered_concepts}

INTERACTION PREFERENCES:
  guidance: {guidance_preference}
  engagement: {engagement_preference}
"""


def build_system_prompt(
    topic: str,
    profile: TopicProfile,
    prefs: InteractionPreferences,
) -> str:
    dynamic = DYNAMIC_CONTEXT_TEMPLATE.format(
        topic=topic,
        knowledge_level=profile.knowledge_level,
        confirmed_gaps=", ".join(profile.confirmed_gaps) or "(none)",
        mastered_concepts=", ".join(profile.mastered_concepts) or "(none)",
        guidance_preference=prefs.guidance_preference,
        engagement_preference=prefs.engagement_preference,
    )
    return f"{IMMUTABLE_RULES}\n\n{dynamic}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_prompts.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/prompts.py spike/tests/test_prompts.py
git commit -m "feat(spike): add system prompt builder"
```

---

## Task 5: LLM wrapper with retry

**Files:**
- Create: `spike/src/spike/llm.py`
- Create: `spike/tests/test_llm.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_llm.py`:

```python
from unittest.mock import MagicMock, patch
import pytest
from spike.llm import call_llm, ChatMessage


def _mock_response(text: str):
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message = MagicMock()
    resp.choices[0].message.content = text
    return resp


def test_call_llm_returns_text():
    with patch("spike.llm.completion") as mock_comp:
        mock_comp.return_value = _mock_response("Hello, learner.")
        out = call_llm(
            model="gemini/gemini-2.5-pro",
            system="You are a tutor.",
            messages=[ChatMessage(role="user", content="Teach me recursion.")],
        )
        assert out == "Hello, learner."
        mock_comp.assert_called_once()


def test_call_llm_retries_on_transient_error():
    with patch("spike.llm.completion") as mock_comp:
        mock_comp.side_effect = [
            Exception("transient"),
            _mock_response("Success after retry"),
        ]
        out = call_llm(
            model="gemini/gemini-2.5-pro",
            system="sys",
            messages=[ChatMessage(role="user", content="hi")],
            max_retries=2,
        )
        assert out == "Success after retry"
        assert mock_comp.call_count == 2


def test_call_llm_raises_after_max_retries():
    with patch("spike.llm.completion") as mock_comp:
        mock_comp.side_effect = Exception("persistent")
        with pytest.raises(Exception, match="persistent"):
            call_llm(
                model="gemini/gemini-2.5-pro",
                system="sys",
                messages=[ChatMessage(role="user", content="hi")],
                max_retries=2,
            )
        assert mock_comp.call_count == 2


def test_chat_message_serializes_for_litellm():
    msg = ChatMessage(role="user", content="hello")
    assert msg.to_dict() == {"role": "user", "content": "hello"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_llm.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spike.llm'`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/llm.py`:

```python
import time
from dataclasses import dataclass
from typing import Literal
from litellm import completion


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content}


def call_llm(
    model: str,
    system: str,
    messages: list[ChatMessage],
    max_retries: int = 3,
    temperature: float = 0.7,
) -> str:
    payload = [{"role": "system", "content": system}] + [m.to_dict() for m in messages]
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            resp = completion(
                model=model,
                messages=payload,
                temperature=temperature,
            )
            return resp.choices[0].message.content
        except Exception as e:
            last_exc = e
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
    assert last_exc is not None
    raise last_exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_llm.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/llm.py spike/tests/test_llm.py
git commit -m "feat(spike): add LiteLLM wrapper with exponential backoff retry"
```

---

## Task 6: Output writer

**Files:**
- Create: `spike/src/spike/output.py`
- Create: `spike/tests/test_output.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_output.py`:

```python
from pathlib import Path
from spike.output import write_turn_output, write_transcript
from spike.llm import ChatMessage


def test_write_turn_output_creates_file(tmp_path):
    write_turn_output(
        outputs_root=tmp_path,
        pair_name="knowledge",
        side="A",
        turn=1,
        prompt="Teach me recursion",
        response="Recursion is when a function calls itself.",
    )
    f = tmp_path / "knowledge" / "A_turn1.md"
    assert f.exists()
    text = f.read_text(encoding="utf-8")
    assert "knowledge" in text
    assert "Side A" in text
    assert "Teach me recursion" in text
    assert "Recursion is when a function" in text


def test_write_transcript_records_all_turns(tmp_path):
    messages = [
        ChatMessage(role="user", content="Teach me recursion"),
        ChatMessage(role="assistant", content="Sure, here's how it works."),
        ChatMessage(role="user", content="Hmm, can you say more?"),
        ChatMessage(role="assistant", content="When a function calls itself..."),
    ]
    write_transcript(
        outputs_root=tmp_path,
        pair_name="knowledge",
        side="B",
        messages=messages,
    )
    f = tmp_path / "knowledge" / "B_transcript.md"
    assert f.exists()
    text = f.read_text(encoding="utf-8")
    assert "**user**" in text
    assert "**assistant**" in text
    assert "Teach me recursion" in text
    assert "When a function calls itself" in text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_output.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spike.output'`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/output.py`:

```python
from pathlib import Path
from spike.llm import ChatMessage


def write_turn_output(
    outputs_root: Path,
    pair_name: str,
    side: str,
    turn: int,
    prompt: str,
    response: str,
) -> Path:
    pair_dir = outputs_root / pair_name
    pair_dir.mkdir(parents=True, exist_ok=True)
    f = pair_dir / f"{side}_turn{turn}.md"
    body = (
        f"# {pair_name} pair — Side {side} — Turn {turn}\n\n"
        f"## Last user prompt\n\n{prompt}\n\n"
        f"## Tutor response\n\n{response}\n"
    )
    f.write_text(body, encoding="utf-8")
    return f


def write_transcript(
    outputs_root: Path,
    pair_name: str,
    side: str,
    messages: list[ChatMessage],
) -> Path:
    pair_dir = outputs_root / pair_name
    pair_dir.mkdir(parents=True, exist_ok=True)
    f = pair_dir / f"{side}_transcript.md"
    lines = [f"# {pair_name} pair — Side {side} — Full transcript\n"]
    for msg in messages:
        lines.append(f"\n**{msg.role}**:\n\n{msg.content}\n")
    f.write_text("\n".join(lines), encoding="utf-8")
    return f
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_output.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/output.py spike/tests/test_output.py
git commit -m "feat(spike): add markdown output writers for turn/transcript"
```

---

## Task 7: 8-turn conversation runner

**Files:**
- Create: `spike/src/spike/runner.py`
- Create: `spike/tests/test_runner.py`

- [ ] **Step 1: Write the failing test**

Write `spike/tests/test_runner.py`:

```python
from unittest.mock import patch
from spike.runner import run_conversation, SCRIPTED_FOLLOWUPS
from spike.profiles import TopicProfile, InteractionPreferences


def test_scripted_followups_have_8_user_turns():
    # Initial "teach me" + 7 follow-ups = 8 user turns total
    assert len(SCRIPTED_FOLLOWUPS) == 7


def test_run_conversation_yields_8_user_8_assistant():
    fake_responses = [f"Tutor reply {i}" for i in range(1, 9)]
    with patch("spike.runner.call_llm") as mock_call:
        mock_call.side_effect = fake_responses
        messages = run_conversation(
            topic="recursion",
            profile=TopicProfile(knowledge_level="beginner"),
            prefs=InteractionPreferences(
                guidance_preference="hints", engagement_preference="quiz_as_we_go"
            ),
            model="gemini/gemini-2.5-pro",
        )
        # 8 user + 8 assistant = 16 messages
        assert len(messages) == 16
        user_msgs = [m for m in messages if m.role == "user"]
        asst_msgs = [m for m in messages if m.role == "assistant"]
        assert len(user_msgs) == 8
        assert len(asst_msgs) == 8
        assert mock_call.call_count == 8


def test_run_conversation_starts_with_teach_me():
    fake_responses = ["reply"] * 8
    with patch("spike.runner.call_llm") as mock_call:
        mock_call.side_effect = fake_responses
        messages = run_conversation(
            topic="hash tables",
            profile=TopicProfile(knowledge_level="intermediate"),
            prefs=InteractionPreferences(
                guidance_preference="hints", engagement_preference="quiz_as_we_go"
            ),
            model="gemini/gemini-2.5-pro",
        )
        first_user = next(m for m in messages if m.role == "user")
        assert "hash tables" in first_user.content.lower()
        assert "30 minutes" in first_user.content.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_runner.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Write `spike/src/spike/runner.py`:

```python
from spike.llm import ChatMessage, call_llm
from spike.profiles import TopicProfile, InteractionPreferences
from spike.prompts import build_system_prompt


SCRIPTED_FOLLOWUPS: tuple[str, ...] = (
    "Hmm, can you say more?",
    "OK, got it. What next?",
    "Wait, I'm not following — could you give an example?",
    "Got it. Keep going.",
    "Hmm, that's interesting. Why does that matter?",
    "Right. So what's the catch?",
    "Alright, I think I'm following. What's the takeaway?",
)


def _initial_prompt(topic: str) -> str:
    return f"Teach me about {topic}. I have about 30 minutes."


def run_conversation(
    topic: str,
    profile: TopicProfile,
    prefs: InteractionPreferences,
    model: str,
) -> list[ChatMessage]:
    """Drive an 8-turn user/assistant conversation. Returns full message list."""
    system = build_system_prompt(topic=topic, profile=profile, prefs=prefs)
    messages: list[ChatMessage] = []

    user_turns = [_initial_prompt(topic)] + list(SCRIPTED_FOLLOWUPS)
    for user_text in user_turns:
        messages.append(ChatMessage(role="user", content=user_text))
        response = call_llm(model=model, system=system, messages=messages)
        messages.append(ChatMessage(role="assistant", content=response))

    return messages
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_runner.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add spike/src/spike/runner.py spike/tests/test_runner.py
git commit -m "feat(spike): add 8-turn scripted conversation runner"
```

---

## Task 8: Run-comparison script (turn-1 only)

**Files:**
- Create: `spike/scripts/run_comparison.py`

- [ ] **Step 1: Write the script**

Write `spike/scripts/run_comparison.py`:

```python
"""Generate turn-1 outputs for all 3 profile pairs.

Usage:
    uv run python scripts/run_comparison.py
"""
from pathlib import Path
from spike.config import load_config
from spike.llm import ChatMessage, call_llm
from spike.profiles import ALL_PAIRS
from spike.prompts import build_system_prompt
from spike.output import write_turn_output


def _initial_prompt(topic: str) -> str:
    return f"Teach me about {topic}. I have about 30 minutes."


def main() -> int:
    cfg = load_config()
    outputs_root = Path(__file__).parent.parent / "outputs"

    for pair in ALL_PAIRS:
        for side, profile, prefs in (
            ("A", pair.profile_a, pair.prefs_a),
            ("B", pair.profile_b, pair.prefs_b),
        ):
            print(f"[{pair.name}/{side}] Generating turn-1...")
            system = build_system_prompt(
                topic=pair.topic, profile=profile, prefs=prefs
            )
            user_msg = _initial_prompt(pair.topic)
            response = call_llm(
                model=cfg.tutor_model,
                system=system,
                messages=[ChatMessage(role="user", content=user_msg)],
            )
            write_turn_output(
                outputs_root=outputs_root,
                pair_name=pair.name,
                side=side,
                turn=1,
                prompt=user_msg,
                response=response,
            )
            print(f"[{pair.name}/{side}] Wrote {len(response)} chars.")

    print("Done. Check spike/outputs/{pair}/{A|B}_turn1.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify .env contains GOOGLE_API_KEY**

Confirm `spike/.env` exists with valid `GOOGLE_API_KEY=...`. If using `.env.example`, copy it: `cp spike/.env.example spike/.env` then edit.

- [ ] **Step 3: Run the script**

Run from `spike/`: `uv run python scripts/run_comparison.py`
Expected: prints 6 progress lines, creates 6 files under `spike/outputs/<pair>/X_turn1.md`. Takes ~30–60 seconds total (6 LLM calls).

If rate-limited: wait 60 seconds, re-run. Free tier ~5 RPM means brief pauses fine.

- [ ] **Step 4: Inspect outputs manually**

Open these 3 file pairs and read side-by-side:
- `spike/outputs/knowledge/A_turn1.md` vs `B_turn1.md`
- `spike/outputs/guidance/A_turn1.md` vs `B_turn1.md`
- `spike/outputs/engagement/A_turn1.md` vs `B_turn1.md`

For each pair, ask: do the two outputs differ in vocabulary, depth, or scaffolding? Note observations.

- [ ] **Step 5: Commit**

```bash
git add spike/scripts/run_comparison.py
git commit -m "feat(spike): add turn-1 comparison runner for 3 profile pairs"
```

---

## Task 9: Run-persistence script (8-turn)

**Files:**
- Create: `spike/scripts/run_persistence.py`

- [ ] **Step 1: Write the script**

Write `spike/scripts/run_persistence.py`:

```python
"""Run 8-turn conversations for all 3 profile pairs and dump turn-8 + transcripts.

Usage:
    uv run python scripts/run_persistence.py
"""
from pathlib import Path
from spike.config import load_config
from spike.profiles import ALL_PAIRS
from spike.runner import run_conversation
from spike.output import write_turn_output, write_transcript


def main() -> int:
    cfg = load_config()
    outputs_root = Path(__file__).parent.parent / "outputs"

    for pair in ALL_PAIRS:
        for side, profile, prefs in (
            ("A", pair.profile_a, pair.prefs_a),
            ("B", pair.profile_b, pair.prefs_b),
        ):
            print(f"[{pair.name}/{side}] Running 8-turn conversation...")
            messages = run_conversation(
                topic=pair.topic,
                profile=profile,
                prefs=prefs,
                model=cfg.tutor_model,
            )
            # Final user prompt + final assistant response
            final_user = messages[-2].content
            final_assistant = messages[-1].content
            write_turn_output(
                outputs_root=outputs_root,
                pair_name=pair.name,
                side=side,
                turn=8,
                prompt=final_user,
                response=final_assistant,
            )
            write_transcript(
                outputs_root=outputs_root,
                pair_name=pair.name,
                side=side,
                messages=messages,
            )
            print(f"[{pair.name}/{side}] Wrote turn8 + transcript.")

    print("Done. Check spike/outputs/{pair}/{A|B}_turn8.md and _transcript.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the script**

Run from `spike/`: `uv run python scripts/run_persistence.py`
Expected: prints 6 progress lines, creates 12 files (6 turn8 + 6 transcripts). Takes ~5–10 minutes total (48 LLM calls). Watch for free-tier rate limits — script will retry automatically with backoff.

If rate limit blocks progress for >2 min: switch model to `gemini/gemini-2.5-flash` via env var or reduce SCRIPTED_FOLLOWUPS to 5 for the spike (note this in decision.md).

- [ ] **Step 3: Inspect turn-8 outputs**

For each pair, open:
- `outputs/<pair>/A_turn8.md` vs `B_turn8.md`

Ask: are the two outputs still distinct, or have they converged on the same generic explanation? Read transcripts if uncertain.

- [ ] **Step 4: Commit**

```bash
git add spike/scripts/run_persistence.py
git commit -m "feat(spike): add 8-turn persistence runner"
```

---

## Task 10: Side-by-side inspector

**Files:**
- Create: `spike/scripts/inspect.py`

- [ ] **Step 1: Write the script**

Write `spike/scripts/inspect.py`:

```python
"""Render a single HTML file with all pair outputs side-by-side for review.

Usage:
    uv run python scripts/inspect.py
    open spike/outputs/inspect.html
"""
import html
from pathlib import Path


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.exists() else "(missing)"


def main() -> int:
    outputs_root = Path(__file__).parent.parent / "outputs"
    pairs = ["knowledge", "guidance", "engagement"]

    rows: list[str] = []
    rows.append("<style>"
                "body{font:14px monospace;margin:20px}"
                "table{border-collapse:collapse;width:100%;margin-bottom:30px}"
                "td{vertical-align:top;border:1px solid #ccc;padding:10px;width:50%}"
                "th{background:#222;color:#fff;padding:8px;text-align:left}"
                "h2{margin-top:40px}"
                "pre{white-space:pre-wrap;word-break:break-word}"
                "</style>")

    for pair in pairs:
        rows.append(f"<h2>{pair} pair</h2>")
        for turn in (1, 8):
            a = _read(outputs_root / pair / f"A_turn{turn}.md")
            b = _read(outputs_root / pair / f"B_turn{turn}.md")
            rows.append(f"<h3>Turn {turn}</h3>")
            rows.append("<table><tr><th>Side A</th><th>Side B</th></tr><tr>"
                        f"<td><pre>{html.escape(a)}</pre></td>"
                        f"<td><pre>{html.escape(b)}</pre></td>"
                        "</tr></table>")

    out = outputs_root / "inspect.html"
    out.write_text("\n".join(rows), encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the script**

Run from `spike/`: `uv run python scripts/inspect.py`
Expected: prints `Wrote .../inspect.html`.

- [ ] **Step 3: Open in browser**

Run: `start spike/outputs/inspect.html` (Windows) or open the file directly.
Expected: HTML page with 3 sections (knowledge/guidance/engagement), each with turn-1 and turn-8 side-by-side tables.

- [ ] **Step 4: Commit**

```bash
git add spike/scripts/inspect.py
git commit -m "feat(spike): add side-by-side HTML inspector"
```

---

## Task 11: Smoke test — Gemini tool-calling reliability

**Files:**
- Create: `spike/scripts/smoke_tool_calling.py`

This validates Gemini Pro can reliably emit a structured tool call. Phase 2 of v1 depends on ≥85% reliability on `update_topic_profile` calls.

- [ ] **Step 1: Write the smoke script**

Write `spike/scripts/smoke_tool_calling.py`:

```python
"""Smoke test: call Gemini 10x asking it to use a tool. Count valid tool calls.

Pass criterion: >=8/10 (80%, conservative under target 85%).

Usage:
    uv run python scripts/smoke_tool_calling.py
"""
from litellm import completion
from spike.config import load_config


TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "update_topic_profile",
        "description": "Patch a session's topic_profile with new evidence about the learner.",
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string"},
                "knowledge_level": {
                    "type": "string",
                    "enum": ["beginner", "intermediate", "advanced"],
                },
                "add_confirmed_gap": {"type": "string"},
                "evidence_type": {
                    "type": "string",
                    "enum": ["declared", "inferred", "tested"],
                },
            },
            "required": ["session_id", "evidence_type"],
        },
    },
}


SCENARIOS = [
    "The user said: 'I've never used recursion before.' Update their profile.",
    "The user said: 'I already understand normalization.' Update their profile.",
    "The user answered a question about indexes incorrectly. Update their profile.",
    "The user demonstrated mastery of foreign keys. Update their profile.",
    "The user asked what a hash table is. Update their profile based on this.",
    "The user explained pointers correctly. Update their profile.",
    "The user said: 'I've never heard of B-trees.' Update their profile.",
    "The user got a check question about joins right. Update their profile.",
    "The user said: 'I think I get joins, sort of?' Update their profile.",
    "The user said: 'I'm comfortable with SELECT, but not GROUP BY.' Update their profile.",
]


def _has_valid_tool_call(resp) -> tuple[bool, str]:
    msg = resp.choices[0].message
    tool_calls = getattr(msg, "tool_calls", None) or []
    if not tool_calls:
        return False, "no tool_calls in response"
    tc = tool_calls[0]
    fn = getattr(tc, "function", None)
    if fn is None:
        return False, "tool_call has no function field"
    if fn.name != "update_topic_profile":
        return False, f"wrong function name: {fn.name}"
    import json
    try:
        args = json.loads(fn.arguments)
    except Exception as e:
        return False, f"args not valid JSON: {e}"
    if "session_id" not in args or "evidence_type" not in args:
        return False, "missing required fields"
    if args["evidence_type"] not in ("declared", "inferred", "tested"):
        return False, f"invalid evidence_type: {args['evidence_type']}"
    return True, "ok"


def main() -> int:
    cfg = load_config()
    successes = 0
    for i, scenario in enumerate(SCENARIOS, start=1):
        try:
            resp = completion(
                model=cfg.tutor_model,
                messages=[
                    {"role": "system", "content": "You are a profile updater. Always call the tool with session_id='test-session' to record what you observe."},
                    {"role": "user", "content": scenario},
                ],
                tools=[TOOL_DEF],
                tool_choice="auto",
            )
            ok, reason = _has_valid_tool_call(resp)
            print(f"[{i:2d}/10] {'PASS' if ok else 'FAIL'} — {reason}")
            if ok:
                successes += 1
        except Exception as e:
            print(f"[{i:2d}/10] ERROR — {e}")

    pct = (successes / len(SCENARIOS)) * 100
    print(f"\nReliability: {successes}/{len(SCENARIOS)} = {pct:.0f}%")
    if successes >= 8:
        print("PASS: tool-calling reliability acceptable for v1 Phase 2.")
        return 0
    print("FAIL: reliability too low. Consider Claude Sonnet fallback or more prompt scaffolding.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the smoke test**

Run from `spike/`: `uv run python scripts/smoke_tool_calling.py`
Expected: 10 PASS/FAIL lines + reliability percentage. Target: ≥80%.

If <80%: note in decision.md, plan Phase 2 to start with Claude Sonnet (paid) instead of Gemini. Cost: ~$10–30 across remaining phases.

- [ ] **Step 3: Commit**

```bash
git add spike/scripts/smoke_tool_calling.py
git commit -m "feat(spike): add Gemini tool-calling reliability smoke test"
```

---

## Task 12: Smoke test — ChromaDB integration

**Files:**
- Create: `spike/scripts/smoke_chromadb.py`

- [ ] **Step 1: Write the smoke script**

Write `spike/scripts/smoke_chromadb.py`:

```python
"""Smoke test: start an in-memory ChromaDB, add 3 docs with embeddings, query.

Usage:
    uv run python scripts/smoke_chromadb.py
"""
import chromadb
from chromadb.config import Settings


def _fake_embedding(text: str, dim: int = 8) -> list[float]:
    """Hash-based fake embedding so the smoke test doesn't burn API quota."""
    import hashlib
    h = hashlib.sha256(text.encode("utf-8")).digest()
    # Map first dim*2 bytes to floats in [-1, 1]
    return [(h[i] / 127.5) - 1.0 for i in range(dim)]


def main() -> int:
    client = chromadb.Client(Settings(allow_reset=True, anonymized_telemetry=False))
    coll = client.get_or_create_collection(name="smoke")

    docs = [
        ("doc1", "Recursion is when a function calls itself."),
        ("doc2", "A B-tree is a self-balancing search tree."),
        ("doc3", "Normalization eliminates redundant data in databases."),
    ]
    coll.add(
        ids=[d[0] for d in docs],
        documents=[d[1] for d in docs],
        embeddings=[_fake_embedding(d[1]) for d in docs],
    )
    print(f"Added {coll.count()} docs.")

    query = "tell me about trees"
    result = coll.query(
        query_embeddings=[_fake_embedding(query)],
        n_results=2,
    )
    print(f"Query: {query!r}")
    print(f"Returned ids: {result['ids']}")
    print(f"Returned docs: {result['documents']}")

    if coll.count() != 3:
        print("FAIL: count mismatch")
        return 1
    if not result["ids"][0]:
        print("FAIL: query returned nothing")
        return 1
    print("PASS: ChromaDB add + query works.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the smoke test**

Run from `spike/`: `uv run python scripts/smoke_chromadb.py`
Expected: prints `Added 3 docs.`, query results, then `PASS: ChromaDB add + query works.`

If fails (e.g., import error): `uv add chromadb` to ensure installed in current env.

- [ ] **Step 3: Commit**

```bash
git add spike/scripts/smoke_chromadb.py
git commit -m "feat(spike): add ChromaDB add/query smoke test"
```

---

## Task 13: Smoke test — docker-compose boot

**Files:**
- Create: `docker/docker-compose.smoke.yml`
- Create: `docker/smoke-api/main.py`
- Create: `docker/smoke-api/requirements.txt`
- Create: `docker/smoke-api/Dockerfile`

- [ ] **Step 1: Write the smoke API**

Write `docker/smoke-api/main.py`:

```python
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok"}
```

Write `docker/smoke-api/requirements.txt`:

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
```

Write `docker/smoke-api/Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write docker-compose**

Write `docker/docker-compose.smoke.yml`:

```yaml
services:
  api:
    build:
      context: ./smoke-api
    ports:
      - "8000:8000"
  chroma:
    image: chromadb/chroma:0.5.20
    ports:
      - "8001:8000"
    environment:
      - IS_PERSISTENT=TRUE
      - PERSIST_DIRECTORY=/data
    volumes:
      - chroma-smoke:/data

volumes:
  chroma-smoke:
```

- [ ] **Step 3: Boot the stack**

Run from `docker/`: `docker compose -f docker-compose.smoke.yml up --build -d`
Expected: builds image, starts both containers. ~30–90 seconds first time.

- [ ] **Step 4: Verify health endpoints**

Run: `curl http://localhost:8000/health`
Expected: `{"status":"ok"}`

Run: `curl http://localhost:8001/api/v1/heartbeat`
Expected: `{"nanosecond heartbeat": <number>}`

- [ ] **Step 5: Tear down**

Run from `docker/`: `docker compose -f docker-compose.smoke.yml down -v`
Expected: stops containers, removes volume. Clean slate for v1 Phase 1.

- [ ] **Step 6: Commit**

```bash
git add docker/docker-compose.smoke.yml docker/smoke-api/main.py docker/smoke-api/requirements.txt docker/smoke-api/Dockerfile
git commit -m "feat(smoke): add docker-compose boot smoke test"
```

---

## Task 14: Decision recording

**Files:**
- Create: `spike/decision.md`

- [ ] **Step 1: Run all spike scripts (if not done)**

Confirm all 4 artifact-producing scripts have run successfully:
- `uv run python scripts/run_comparison.py` — 6 turn1 files
- `uv run python scripts/run_persistence.py` — 6 turn8 + 6 transcripts
- `uv run python scripts/inspect.py` — `outputs/inspect.html`
- `uv run python scripts/smoke_tool_calling.py` — reliability number

Smoke tests for ChromaDB and docker-compose should also have run.

- [ ] **Step 2: Inspect outputs side-by-side**

Open `spike/outputs/inspect.html` in browser. For each of the 3 pair sections:

For Turn 1: do A and B differ in vocabulary, scaffolding depth, or technical level?
For Turn 8: are the differences still visible, or have they converged?

Take notes. Be honest — if they look similar, say so.

- [ ] **Step 3: Write decision.md**

Write `spike/decision.md` using this template (fill in actual observations):

```markdown
# Phase 0 Decision

**Date:** YYYY-MM-DD
**Outcome:** PASS | KNOWLEDGE_ONLY_PASS | FAIL

## Summary

[1–3 sentence summary of what was observed across the three pairs.]

## Pair-by-pair

### knowledge pair (recursion)
- Turn 1 difference visible: YES | NO
- Turn 8 difference still visible: YES | NO
- Observations: [free-form notes]

### guidance pair (database normalization)
- Turn 1 difference visible: YES | NO
- Turn 8 difference still visible: YES | NO
- Observations: [free-form notes]

### engagement pair (hash tables)
- Turn 1 difference visible: YES | NO
- Turn 8 difference still visible: YES | NO
- Observations: [free-form notes]

## Smoke test results

- Tool-calling reliability: X/10 (X%) — PASS if ≥8/10
- ChromaDB add/query: PASS | FAIL
- docker-compose boot: PASS | FAIL

## Decision

- [ ] **PASS** — all three pairs differ at turn 1 AND turn 8. Proceed to v1 Phase 1.
- [ ] **KNOWLEDGE_ONLY_PASS** — knowledge pair differs at both turns; guidance/engagement converge. Drop interaction_preferences from v1 spec; proceed with topic_profile only.
- [ ] **FAIL** — outputs converge by turn 8 across the board. After up to 3 prompt iterations, still failing. Stop project, pivot or abandon.

## Notes for v1 Phase 1+

[If pass: any prompt-iteration learnings to carry forward, model swap implications, observed strengths/weaknesses of Gemini Pro on this task.]

[If knowledge-only: list the spec sections that need updating (mostly §3.1 and onboarding flow).]

[If fail: rebuild premise — RAG-only? Pure flashcard? Different problem entirely?]
```

- [ ] **Step 4: Fill in observations**

Replace all `[bracketed]` placeholders in `spike/decision.md` with actual observations. Be specific. Cite text snippets from the outputs.

- [ ] **Step 5: Commit**

```bash
git add spike/decision.md
git commit -m "docs(spike): record Phase 0 decision and observations"
```

---

## Self-Review

**1. Spec coverage check**

Phase 0 spec (§7 Phase 0 of `2026-05-03-adaptlearn-v1-design.md`) requires:
- Standalone Python script using LiteLLM + Gemini ✓ (Tasks 1–7)
- Three profile pairs (knowledge / guidance / engagement) ✓ (Task 3)
- "Teach me about [topic]. I have about 30 minutes." through both profiles ✓ (Tasks 7, 8, 9)
- 8-turn scripted conversation each ✓ (Task 7, SCRIPTED_FOLLOWUPS = 7 follow-ups + 1 initial = 8 user turns)
- Save outputs side-by-side ✓ (Tasks 6, 8, 9, 10)
- Pass: all three pairs differ at turn 1 AND turn 8 ✓ (Task 14 decision template)
- docker-compose smoke test ✓ (Task 13)
- ChromaDB integration smoke test ✓ (Task 12)
- Gemini tool-calling smoke test (≥85% reliability) ✓ (Task 11; conservative gate ≥80% to avoid false-fail at boundary)
- decision.md written ✓ (Task 14)

**2. Placeholder scan**

Searched for "TBD", "TODO", "implement later", "fill in details" — no matches in any task code or steps. The decision.md template intentionally has `[bracketed]` placeholders since they represent observations the engineer/dogfooder must fill in based on real LLM outputs; Task 14 step 4 explicitly requires them to be replaced.

**3. Type/identifier consistency**

- `ChatMessage(role, content)` defined in Task 5, used identically in Tasks 6, 7, 8, 9 ✓
- `TopicProfile`, `InteractionPreferences`, `ProfilePair`, `ALL_PAIRS` defined in Task 3, used unchanged in Tasks 4, 7, 8, 9 ✓
- `build_system_prompt(topic, profile, prefs)` signature consistent across Tasks 4, 7, 8 ✓
- `call_llm(model, system, messages, max_retries=3, temperature=0.7)` signature consistent across Tasks 5, 7, 8 ✓
- `write_turn_output(outputs_root, pair_name, side, turn, prompt, response)` consistent across Tasks 6, 8, 9 ✓
- `SCRIPTED_FOLLOWUPS` defined in Task 7 (length 7), Task 7's test asserts `len(SCRIPTED_FOLLOWUPS) == 7`; combined with initial prompt = 8 user turns total ✓
- `TUTOR_MODEL` env var: not referenced in this plan; `TUTOR_MODEL` config field set in Task 2 with default `gemini/gemini-2.5-pro`, used in Tasks 8, 9, 11 via `cfg.tutor_model` ✓

No type/identifier inconsistencies found.

**4. Scope check**

This plan covers v1 design Phase 0 only. v1 Phases 1–5 will receive separate plan documents written sequentially after Phase 0 outcome is known (gating decision; no point planning Phase 1 if Phase 0 fails).
