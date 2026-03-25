---
name: git-workflow
description: >
  Git workflow conventions for commits, branches, PRs, and code review.
  Use when committing code, creating branches, pushing to remotes,
  writing commit messages, opening pull requests, or performing any git operation.
  Enforces: conventional commits, default branch detection, branch naming,
  commit message format, PR-based merge flow, and automated code review via sub-agent.
---

# Git Workflow

Standardized git workflow for all agents. Follow these rules for every git operation.

## Golden Rules

1. **Never push directly to the default branch.** Always work on a private branch and open a PR.
2. **Never merge your own PR.** The human reviews and approves the final version.
3. **Always detect the default branch.** Never assume `main` or `master`.

## Branch Conventions

### Default Branch Detection (MANDATORY)

**Never assume the default branch name.** Always detect it:

```bash
# Detect remote default branch
git remote show origin | sed -n 's/.*HEAD branch: //p'

# Or from local refs
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's#refs/remotes/origin/##'
```

If the remote default is `main`, do not push to `master` (and vice versa).

### Branch Naming

Always create a local branch before committing. Format: `<type>/<short-description>`

| Type | Use |
|------|-----|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `refactor/` | Code restructuring |
| `chore/` | Maintenance, deps, CI |
| `backup/` | Snapshot / backup commits |

Examples: `feature/add-login`, `fix/null-pointer`, `docs/update-readme`

## Commit Message Format

### Conventional Commits (MANDATORY)

```
<type>(<scope>): <subject>

<body>  (optional)
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `backup`

**Rules:**
- Subject line: imperative mood, lowercase, no period, ≤72 chars
- Scope: optional but preferred (e.g., `feat(auth):`, `fix(api):`)
- Body: wrap at 72 chars, explain *why* not *what* (the diff shows what)

**Good:**
```
feat(agent): add coding agent with ui-ux-pro-max skill
fix(config): correct default branch reference
chore(deps): upgrade openclaw-weixin to 2.0.1
```

**Bad:**
```
Updated stuff          # vague, no type
feat: Add New Feature. # capitalized, trailing period, too generic
```

### Forbidden

- No `Co-Authored-By: Claude`, `Generated with AI`, or any AI attribution markers
- No commit messages over 72 characters in the subject line

## Git Identity (MANDATORY)

Set the git committer name to the **model name** that produced the commit. This makes it clear which model authored each change.

Before committing, detect your current model and configure git identity:

```bash
# Set committer name to the model name (e.g. claude-opus-4.6, gpt-5.4, gemini-2.5-pro)
# The model name is available from the runtime context or session_status.
git config user.name "<model-name>"

# Use a shared no-reply email for all agents
git config user.email "agent@openclaw.local"
```

Examples of valid committer names:
- `claude-opus-4.6`
- `gpt-5.4`
- `gemini-2.5-pro`
- `claude-sonnet-4.6`

Do **not** use generic names like `Ubuntu`, `root`, `OpenClaw`, or `AI Assistant`.

## Push Behavior

After every commit, push to **your feature branch** immediately. Do not ask.

```bash
# Has upstream tracking:
git push

# No upstream tracking:
git push -u origin $(git branch --show-current)
```

**Never push directly to the default branch (main/master).**

## Pre-Commit Checks

Before committing, always run:

```bash
# 1. Verify you're NOT on the default branch
CURRENT=$(git branch --show-current)
DEFAULT=$(git remote show origin | sed -n 's/.*HEAD branch: //p')
if [ "$CURRENT" = "$DEFAULT" ]; then
  echo "ERROR: You are on the default branch. Create a feature branch first."
  exit 1
fi

# 2. Review what's staged
git diff --cached --stat

# 3. Scan staged content for potential secrets
#    (This is a basic grep check, not a substitute for dedicated secret scanners)
git diff --cached | grep -iE '(password|secret|token|api_key|private_key|BEGIN RSA|BEGIN OPENSSH)' && echo "WARNING: Possible secret detected in staged changes — review before committing"
```

Do not commit files containing tokens, passwords, API keys, or other secrets unless the repo is explicitly private and the user has approved it.

## Standard Workflow (MANDATORY)

Every code change follows this 5-step flow.

### Step 1: Get on a Feature Branch

**Starting new work:**

```bash
DEFAULT=$(git remote show origin | sed -n 's/.*HEAD branch: //p')
git fetch origin
git checkout -b <type>/<description> origin/$DEFAULT
```

**Continuing work on an existing PR branch:**

```bash
git checkout <existing-branch>
git pull origin <existing-branch>
```

If you already have local changes on the correct feature branch, skip this step.

### Step 2: Commit & Push to Feature Branch

```bash
git add <files>
git commit -m "type(scope): description"
git push -u origin $(git branch --show-current)
```

Repeat as needed. Each commit should be a single logical change.

### Step 3: Open a Pull Request

When the work is ready for review, create a PR targeting the default branch:

```bash
DEFAULT=$(git remote show origin | sed -n 's/.*HEAD branch: //p')
gh pr create \
  --base "$DEFAULT" \
  --title "type(scope): description" \
  --body "## Summary
- What this PR does

## Changes
- List of changes

## Testing
- How it was tested"
```

**Do NOT merge the PR yourself.** Proceed to Step 4.

### Step 4: Automated Code Review (Sub-Agent)

After the PR is created, spawn a reviewer sub-agent to review the PR.

**Reviewer model selection (MANDATORY):** The reviewer must use a **different model** from the one that authored the PR. This ensures independent review and avoids blind spots from the same model reviewing its own patterns.

Model priority for the reviewer (pick the first that is different from the author):

| Priority | Model family |
|----------|-------------|
| 1st | Claude (claude-opus-4.6, claude-sonnet-4.6) |
| 2nd | GPT (gpt-5.4, gpt-5.4-mini) |
| 3rd | Gemini (gemini-2.5-pro, gemini-3.1-pro-preview) |

Example: if the PR was authored by `claude-opus-4.6`, the reviewer should be `gpt-5.4`. If authored by `gpt-5.4`, use `claude-opus-4.6`. If authored by `gemini-2.5-pro`, use `claude-opus-4.6`.

The reviewer should be a separate session (use `sessions_spawn` with the `model` parameter in OpenClaw, or any equivalent isolated sub-agent mechanism). The key requirements are:

1. **Tell the reviewer who authored the PR.** Include the author model name in the task description so the reviewer knows whose code they are reviewing (e.g. "This PR was authored by claude-opus-4.6"). This context helps the reviewer calibrate their review for model-specific blind spots.
2. The reviewer reads the PR diff: `gh pr diff <number> --repo <owner/repo>`
3. The reviewer posts comments: `gh pr review <number> --repo <owner/repo> --comment --body '<review>'`
4. The reviewer focuses on: correctness, style consistency, missing edge cases, security concerns, naming, readability
5. The reviewer does **NOT** approve or merge — only leaves comments

If `sessions_spawn` is not available in your environment, you may manually review the diff and post comments, but always as a separate review step before declaring the PR ready.

### Step 5: Address Review Comments & Wait for Human Approval

1. Read the reviewer's comments
2. Fix issues on the same feature branch
3. Commit and push the fixes
4. **Stop.** Tell the human the PR is ready for their final review.

```
The PR is ready: <PR URL>
- Reviewer comments have been addressed.
- Please review and merge when satisfied.
```

**Never approve or merge the PR.** Only the human does that.

## Quick Reference

| Action | Command |
|--------|---------|
| Detect default branch | `git remote show origin \| sed -n 's/.*HEAD branch: //p'` |
| Create feature branch | `git checkout -b type/desc origin/$DEFAULT` |
| Push feature branch | `git push -u origin $(git branch --show-current)` |
| Create PR | `gh pr create --base $DEFAULT --title "..." --body "..."` |
| View PR diff | `gh pr diff <number>` |
| Post review comment | `gh pr review <number> --comment --body "..."` |
| Check PR status | `gh pr status` |

## Validation

See `scripts/validate_commit.sh` to validate commit message format before committing.
See `references/examples.md` for commit message and branch naming examples.
