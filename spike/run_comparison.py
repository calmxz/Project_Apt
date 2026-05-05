"""
Phase 0 spike — turn-1 comparison.

For each of the three profile pairs, sends the same opening message through
both profiles (A and B) and saves the model response to:
  spike/outputs/{pair}/{side}_turn1.md

Run from the spike/ directory:
  python run_comparison.py

Requires GEMINI_API_KEY in environment or spike/.env file.
"""

import os
import time
from pathlib import Path

from dotenv import load_dotenv
import litellm

from prompt import build_system_prompt
from profiles import PAIRS, BASE_SESSION

load_dotenv(Path(__file__).parent / ".env")

MODEL = "gemini/gemini-3.1-flash-lite-preview"
TEMPERATURE = 0
OPENING_MESSAGE = "Teach me about database normalization. I have about 30 minutes."
OUTPUTS_DIR = Path(__file__).parent / "outputs"


def call_model(system_prompt: str, user_message: str) -> str:
    response = litellm.completion(
        model=MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=TEMPERATURE,
    )
    return response.choices[0].message.content


def save_output(pair: str, side: str, suffix: str, content: str) -> None:
    out_dir = OUTPUTS_DIR / pair
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{side}_{suffix}.md"
    path.write_text(content, encoding="utf-8")
    print(f"  saved -> {path.relative_to(Path(__file__).parent)}")


def main() -> None:
    print(f"Model: {MODEL}\n")
    seen_pairs: set[str] = set()

    for pair, side, profile in PAIRS:
        system_prompt = build_system_prompt(profile, BASE_SESSION)
        print(f"[{pair}/{side}] calling model for turn 1 ...")
        response = call_model(system_prompt, OPENING_MESSAGE)

        header = (
            f"# {pair.capitalize()} pair — Profile {side} — Turn 1\n\n"
            f"**Model:** {MODEL}  \n"
            f"**User:** {OPENING_MESSAGE}\n\n"
            f"---\n\n"
        )
        save_output(pair, side, "turn1", header + response)

        # Small delay to avoid rate-limiting when two sides of same pair run back-to-back.
        if pair in seen_pairs:
            time.sleep(2)
        seen_pairs.add(pair)

    print("\nDone. 6 turn-1 files written to spike/outputs/.")
    print("Next: run run_persistence.py for 8-turn transcripts.")


if __name__ == "__main__":
    main()
