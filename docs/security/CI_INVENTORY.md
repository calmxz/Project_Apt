# CI Security Inventory — AdaptLearn

**Audience:** future maintainers ("why is this CI job here?")
**Companion to:** [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) and `.github/workflows/ci.yml`.
**Phase introduced:** Phase 6 (`phase/6-ci-security-tests`, 2026-05-23).

Every job below blocks PR merge once branch protection is enabled on `dev`
(staging) and `main` (prod). See "Manual post-merge" at the end of this file.

---

## SAST and code analysis

| Tool | Catches | Where | Fail threshold | Upstream |
|---|---|---|---|---|
| **bandit** | Python SAST: insecure use of `subprocess`, weak crypto, `eval`, hardcoded secrets, etc. | `security` job in `ci.yml` | `-lll -iii` (high severity + high confidence only — suppresses noise) | https://bandit.readthedocs.io |
| **semgrep** | Cross-language pattern-based rules: OWASP top-10 + security-audit ruleset | `security` job in `ci.yml` | Any rule match (`semgrep ci --error`) | https://semgrep.dev |
| **CodeQL** | GitHub-native semantic analysis for Python + JavaScript/TypeScript | `.github/workflows/codeql.yml` | Default `security-and-quality` query pack | https://codeql.github.com |

## Dependency and supply-chain

| Tool | Catches | Where | Fail threshold | Upstream |
|---|---|---|---|---|
| **pip-audit** | Known CVEs in Python deps (resolves transitive tree from `pyproject.toml`) | `security` job in `ci.yml` | Any advisory | https://github.com/pypa/pip-audit |
| **npm audit** | Known CVEs in npm prod deps (skips devDeps) | `security` job in `ci.yml` | `--audit-level=high` | https://docs.npmjs.com/cli/v10/commands/npm-audit |
| **Dependabot** | Weekly automated PRs to bump outdated deps (pip + npm + github-actions + docker) | `.github/dependabot.yml` | Opens PRs, doesn't fail CI directly | https://docs.github.com/en/code-security/dependabot |

## Container and Dockerfile

| Tool | Catches | Where | Fail threshold | Upstream |
|---|---|---|---|---|
| **hadolint** (backend + frontend) | Dockerfile lint: unsafe `apt-get`, missing `USER`, latest tags, etc. | `security` job in `ci.yml` | `warning+` | https://github.com/hadolint/hadolint |
| **trivy** (backend image) | OS + lang-pkg CVEs in the built backend image | `security` job in `ci.yml` | `CRITICAL` only (with `ignore-unfixed`) | https://aquasecurity.github.io/trivy |
| **trivy** (frontend image) | OS + lang-pkg CVEs in the built frontend (nginx) image | `security` job in `ci.yml` | `CRITICAL` only | same |

## Secrets

| Tool | Catches | Where | Fail threshold | Upstream |
|---|---|---|---|---|
| **gitleaks** | API keys, tokens, private-key PEMs in full git history + PR diff | `security` job in `ci.yml` | Any leak | https://github.com/gitleaks/gitleaks |

## Coverage

| Tool | Purpose | Where | Threshold |
|---|---|---|---|
| **pytest-cov** | Enforces minimum backend coverage on `services/` + `lib/` | `backend/pyproject.toml` (`--cov-fail-under=75`) | 75% (current: ~92%) |
| **Codecov** | Trend visibility + PR coverage delta comments | `backend` + `frontend` jobs in `ci.yml` | No-op on failure (`fail_ci_if_error: false`) |

---

## Regression tests added in Phase 6

These tests lock the resolutions from `SECURITY_REVIEW.md` so a future
refactor reintroducing the finding will fail CI deterministically.

| Finding | Test | Location |
|---|---|---|
| H-3 (maxLength caps) | `test_field_rejects_above_max_length` / `test_field_accepts_at_max_length` (15 parametrized cases each) | `backend/tests/test_max_length_validation.py` |
| H-4 (sessions/end ownership 404) | `test_post_end_404_for_wrong_user` | `backend/tests/test_sessions_route.py` |
| H-4 (profile ownership 404) | `test_profile_route_404_for_wrong_user` (pre-existing, retained) | `backend/tests/test_profile_route.py` |
| H-5 (generic retrieval error, no internal leak) | `test_chroma_exception_returns_failed` + `test_chroma_exception_does_not_leak_internal_message` | `backend/tests/test_retrieval_service.py` |
| M-3 (chunk wrapper present + payload preserved + immutable-rule warns) | `test_retrieved_chunks_wrapped_as_untrusted_in_tool_message`, `test_immutable_rules_warn_about_document_excerpt_tags`, and citation-cleanliness assertion at line 155 (all pre-existing from Phase 3, retained) | `backend/tests/test_tutor_loop.py` |

---

## Manual post-merge (user configures via GitHub web UI)

Branch protection and signed commits are documented here but **not executed by
the Phase 6 PR** — both require admin scope on the repo and (for signed
commits) a configured signing key on the user's machine.

Branch model:
- `dev` = staging (PRs land here first)
- `main` = production (only fast-forward from `dev` after staging verification)

### Branch protection — apply to BOTH `dev` and `main`

Settings → Branches → Add branch protection rule. Create one rule per branch
(`dev` and `main`) with the same status checks. Staging must enforce the same
gates as prod; otherwise broken commits sneak into `dev` and get promoted to
`main` later under a false-pass assumption.

Required status checks (must match exact job names from `ci.yml` and
`codeql.yml`):
- `Backend (pytest)`
- `Frontend (Vitest + lint)`
- `Security (SAST + deps + secrets + images)`
- `Analyze (python)`
- `Analyze (javascript-typescript)`

Other settings (both branches):
- Require branches to be up to date before merging: ON
- Include administrators (enforce_admins): ON
- Required approving reviews: 0 (solo-maintainer phase; revisit at v2)
- Restrict who can push: OFF

### Signed commits — `main` only

Settings → Branches → `main` rule → Require signed commits: ON.

Skip on `dev` — staging churns fast and per-commit signing adds friction with
no security gain (staging is not the deploy artifact).

Prereq on local machine: `git config --global commit.gpgsign true` and a GPG
or SSH signing key registered with GitHub (Settings → SSH and GPG keys).

### Equivalent gh CLI (if web UI unavailable)

```bash
# Repeat for both branches: dev, main
gh api -X PUT repos/:owner/:repo/branches/<branch>/protection \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]='Backend (pytest)' \
  -f required_status_checks.contexts[]='Frontend (Vitest + lint)' \
  -f required_status_checks.contexts[]='Security (SAST + deps + secrets + images)' \
  -f required_status_checks.contexts[]='Analyze (python)' \
  -f required_status_checks.contexts[]='Analyze (javascript-typescript)' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.required_approving_review_count=0 \
  -f restrictions=null

# Signed commits on main only
gh api -X POST repos/:owner/:repo/branches/main/protection/required_signatures
```
