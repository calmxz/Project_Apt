# Crux screencast — 2 to 3 min walkthrough script

Goal: show that Crux adapts. The hook is the profile view: at the end
the viewer sees concrete evidence the system learned something about the
learner (mastered concepts, confirmed gaps, focus target).

Total target: **150-180 seconds**. Run a stopwatch.

## Setup (off-camera)

- `docker compose -f docker-compose.prod.yml --env-file .env up -d`
- Set `DAILY_CAP=50` in `.env` (repo root, avoid hitting the cap mid-recording).
- Start from a clean account (no prior sessions) so the demo starts fresh.
- Pre-stage a short PDF (e.g. a 2-page primer on SQL joins).
- Browser at 1280x800. Hide bookmarks bar. Use light theme.
- Recorder: OBS Studio (preferred) or Loom.

## Scenes

### 1 (~10s) — Title

> "Crux is an AI study companion that remembers what you've learned
> across sessions. Here's a two-minute tour."

Card on screen: project name + "Phase 5 v1 walkthrough".

### 2 (~15s) — Onboarding

Navigate to <http://localhost>. The router-guard sends you to `/onboarding`.

> "First time visitors land on onboarding. Give the tutor a name and pick
> a feedback style — hints, or direct answers."

Type `Eddy`. Pick **Hints**. Submit.

### 3 (~15s) — New session

You land on the empty Sessions shelf. Click **New session**, type `SQL joins`,
pick the default seed mode.

> "Each topic is its own session. The tutor starts cold for a new topic, or
> can seed from a prior session you choose."

### 4 (~40s) — Chat + tool use

In the session, type:

```
I know how to write SELECT statements but I'm shaky on joins.
What's the difference between INNER and LEFT?
```

> "The tutor decides whether it needs to retrieve from your documents,
> updates your profile when it learns something, and logs a check-question
> when it tests you."

When the reply arrives, follow up:

```
Quiz me.
```

Answer the quiz question correctly. Mention out loud:

> "That check-question is now in my learning event log — the system can
> tell I've mastered LEFT JOIN."

### 5 (~20s) — PDF upload

Click the paperclip / **Attach PDF**. Drop in the pre-staged primer.

> "Documents are chunked, embedded, and stored as vectors in pgvector on
> Supabase Postgres."

Wait for `is ready`. Ask:

```
What does my doc say about NULL handling in LEFT JOIN?
```

The reply shows citations.

### 6 (~20s) — End + resume

Click **End session**. The summary dialog appears. Close it.

> "Sessions can be ended and reopened later. The next session inherits the
> profile state, so the tutor doesn't re-teach what you already know."

From the **Ended** tab, click **Resume**. Send `continue`. The reply
acknowledges the resumption.

### 7 (~15s) — Per-session profile

Click the **Profile** link in the session header.

> "This is the per-session view. It shows what the tutor recorded for this
> single conversation — knowledge level, mastered concepts, confirmed gaps,
> the gap currently in focus, and the check-question log."

### 8 (~20s) — Combined profile (the hook)

Click the user icon in the topnav. You're at `/profile`.

> "The combined view is the point of all this. It aggregates every session
> for this learner — combined mastered concepts with frequency, gaps to
> revisit, and the knowledge-level distribution across sessions."

Hover over a concept to show the count badge. Click a recent topic to jump
back into its profile.

### 9 (~5s) — Close

> "App runs in Docker with Postgres and auth on Supabase. Docker plus ngrok
> if you want to share it. Repo link below."

Title card: GitHub URL + name.

## Output

- File: `docs/screencast/crux-walkthrough.mp4`
- Embed in `README.md` (or link to YouTube/Loom).
- Keep raw OBS project file out of the repo (large).

## Editing notes

- Speed up obvious wait points (PDF ingestion poll, LLM latency) to 1.5x.
- Add a brief lower-third for each scene title so a muted viewer can follow.
- One single cut between scenes 7 and 8 is OK; otherwise prefer continuous.
