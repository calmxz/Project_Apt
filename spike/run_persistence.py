"""
Phase 0 spike — 8-turn persistence run.

For each of the three profile pairs, runs an 8-turn scripted conversation
through both profiles (A and B). Scripted user turns at positions 1, 3, 5, 7;
model responds at 2, 4, 6, 8.

Saves:
  spike/outputs/{pair}/{side}_transcript.md  — full conversation
  spike/outputs/{pair}/{side}_turn8.md       — turn-8 model response only

Run from the spike/ directory:
  python run_persistence.py

Requires GEMINI_API_KEY in environment or spike/.env file.
"""

import time
from pathlib import Path

from dotenv import load_dotenv
import litellm

from prompt import build_system_prompt
from profiles import PAIRS, BASE_SESSION

load_dotenv(Path(__file__).parent / ".env")

MODEL = "gemini/gemini-3.1-flash-lite-preview"
TEMPERATURE = 0
OUTPUTS_DIR = Path(__file__).parent / "outputs"

# Scripted user turns (1-indexed, odd positions in the conversation).
USER_TURNS = {
    1: "Teach me about database normalization. I have about 30 minutes.",
    3: "Hmm, can you say more?",
    5: "OK got it",
    7: "Hmm, can you say more?",
}

# Seconds to sleep between LLM calls within a conversation (free tier = 5 RPM).
INTER_CALL_SLEEP = 13
# Extra sleep between full pair runs.
INTER_RUN_SLEEP = 5


def call_with_backoff(system_prompt: str, messages: list[dict], max_retries: int = 6) -> str:
    for attempt in range(max_retries):
        try:
            response = litellm.completion(
                model=MODEL,
                messages=[{"role": "system", "content": system_prompt}] + messages,
                temperature=TEMPERATURE,
            )
            if not response.choices:
                # Gemini may return empty choices on safety block or partial failure.
                print(f"    WARNING: empty choices list. Full response: {response}")
                raise ValueError("empty choices")
            content = response.choices[0].message.content
            if content is None:
                print(f"    WARNING: null content. Finish reason: {response.choices[0].finish_reason}")
                raise ValueError("null content")
            return content
        except (litellm.RateLimitError, litellm.ServiceUnavailableError) as e:
            if attempt == max_retries - 1:
                raise
            wait = 15 * (attempt + 1)
            label = "rate limited" if isinstance(e, litellm.RateLimitError) else "503 unavailable"
            print(f"    {label}, waiting {wait}s before retry ...")
            time.sleep(wait)
        except (ValueError, IndexError) as e:
            if attempt == max_retries - 1:
                raise
            wait = 5 * (attempt + 1)
            print(f"    response error ({e}), waiting {wait}s before retry ...")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def run_conversation(system_prompt: str) -> list[dict]:
    """Run 8-turn scripted conversation. Returns list of {role, content} dicts."""
    messages: list[dict] = []

    for turn in range(1, 9):
        if turn % 2 == 1:
            user_content = USER_TURNS[turn]
            messages.append({"role": "user", "content": user_content})
        else:
            print(f"    turn {turn}: calling model ...")
            assistant_content = call_with_backoff(system_prompt, messages)
            messages.append({"role": "assistant", "content": assistant_content})
            # Stay within 5 RPM free-tier quota.
            if turn < 8:
                time.sleep(INTER_CALL_SLEEP)

    return messages


def format_transcript(pair: str, side: str, messages: list[dict]) -> str:
    lines = [
        f"# {pair.capitalize()} pair — Profile {side} — Full transcript\n",
        f"**Model:** {MODEL}  \n",
        f"**Turns:** 8 (user scripted at 1, 3, 5, 7)\n\n---\n",
    ]
    for i, msg in enumerate(messages, start=1):
        role = msg["role"].upper()
        lines.append(f"\n## Turn {i} — {role}\n\n{msg['content']}\n")
    return "\n".join(lines)


def format_turn8(pair: str, side: str, messages: list[dict]) -> str:
    last_assistant = messages[-1]["content"]
    return (
        f"# {pair.capitalize()} pair — Profile {side} — Turn 8 (model)\n\n"
        f"**Model:** {MODEL}  \n\n---\n\n{last_assistant}"
    )


def save_output(pair: str, side: str, suffix: str, content: str) -> None:
    out_dir = OUTPUTS_DIR / pair
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{side}_{suffix}.md"
    path.write_text(content, encoding="utf-8")
    print(f"  saved -> {path.relative_to(Path(__file__).parent)}")


def main() -> None:
    print(f"Model: {MODEL}  (inter-call sleep: {INTER_CALL_SLEEP}s)\n")

    for pair, side, profile in PAIRS:
        transcript_path = OUTPUTS_DIR / pair / f"{side}_transcript.md"
        if transcript_path.exists():
            print(f"[{pair}/{side}] already done, skipping.")
            continue

        system_prompt = build_system_prompt(profile, BASE_SESSION)
        print(f"[{pair}/{side}] running 8-turn conversation ...")
        messages = run_conversation(system_prompt)

        save_output(pair, side, "transcript", format_transcript(pair, side, messages))
        save_output(pair, side, "turn8", format_turn8(pair, side, messages))

        time.sleep(INTER_RUN_SLEEP)

    print(
        "\nDone. 6 transcripts + 6 turn-8 files written to spike/outputs/.\n"
        "Next: read side-by-side and fill in spike/decision.md."
    )


if __name__ == "__main__":
    main()
