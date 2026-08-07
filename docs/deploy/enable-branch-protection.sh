#!/usr/bin/env bash
# W-07: enable branch protection on dev + main with the 4 required CI checks.
set -e
for BR in dev main; do
  echo "=== protecting $BR ==="
  gh api -X PUT "repos/calmxz/Project_Apt/branches/$BR/protection" --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["Backend (pytest)", "Frontend (Vitest + lint)", "Playwright (chromium)", "Security (SAST + deps + secrets + images)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
done
echo "=== enabling code scanning default setup ==="
gh api -X PATCH repos/calmxz/Project_Apt/code-scanning/default-setup -f state=configured
echo "=== verify ==="
gh api repos/calmxz/Project_Apt/branches/dev/protection --jq '.required_status_checks.contexts'
