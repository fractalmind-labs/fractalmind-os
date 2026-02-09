# Branch Protection & Required CI Gates Rollout (Issue #49)

This document defines a safe, auditable rollout to enforce CI + review governance on `main`.

## Scope

- Enforce required CI checks before merge
- Require at least 1 approving review
- Block direct pushes to `main`
- Keep rollout steps reusable for new repositories

## Required Checks (Current Baseline)

The following status check must be required for `main`:

- `Quality Checks` (from `.github/workflows/pr-quality.yml`)

`Quality Checks` currently includes:
- static compile sanity (`python3 -m compileall -q agent-manager`)
- full unittest discovery (`python3 -m unittest discover ...`)
- coverage gate (`python3 -m coverage report --fail-under=$QUALITY_COVERAGE_MIN`)

## Recommended Protection Settings

Apply on `main`:

- Require pull request before merging: `true`
- Required approving reviews: `1`
- Dismiss stale approvals on new commits: `true`
- Require conversation resolution before merge: `true`
- Require status checks to pass before merging: `true`
- Require branches to be up to date before merging: `true`
- Restrict direct pushes: `enabled` (admins included if policy requires)
- Enforce for administrators: `true`

## Safe Rollout Procedure (Auditable)

### 1) Pre-check current state (audit snapshot)

```bash
gh api repos/fractalmind-ai/agent-manager-skill/branches/main/protection > /tmp/bp-before.json
```

### 2) Verify required check names exist in recent PRs

```bash
gh pr checks 44
```

Expected required context name: `Quality Checks`.

### 3) Apply protection via GitHub API

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/fractalmind-ai/agent-manager-skill/branches/main/protection \
  -f required_status_checks.strict=true \
  -F required_status_checks.contexts[]='Quality Checks' \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -f required_pull_request_reviews.require_code_owner_reviews=false \
  -f required_conversation_resolution=true \
  -f restrictions=''
```

> Note: Prefer GitHub Rulesets if your org mandates centralized policy management.

### 4) Post-check and archive evidence

```bash
gh api repos/fractalmind-ai/agent-manager-skill/branches/main/protection > /tmp/bp-after.json
diff -u /tmp/bp-before.json /tmp/bp-after.json || true
```

### 5) Enforcement test

- Open a PR with failing CI: confirm merge button is blocked.
- Open a PR with CI passing but no review: confirm merge blocked until approval.

## Rollback Plan

If emergency rollback is required:

1. Capture current protection JSON (`/tmp/bp-after.json`).
2. Re-apply previous known-good config from `/tmp/bp-before.json` via `gh api --method PUT ...`.
3. Document rollback reason in the incident/change log.

## Reuse in New Repositories

For a new repo:

1. Replace owner/repo in commands.
2. Replace required check contexts with that repo's CI job names.
3. Keep the same audit pattern: `before -> apply -> after -> enforcement test`.
