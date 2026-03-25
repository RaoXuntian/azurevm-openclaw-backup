---
name: git-workflow
description: >
  Git workflow conventions for commits, branches, and pushes.
  Use when committing code, creating branches, pushing to remotes,
  writing commit messages, or performing any git operation.
  Enforces: conventional commits, default branch detection,
  branch naming, commit message format, and push behavior.
---

# Git Workflow

Standardized git workflow for all agents. Follow these rules for every git operation.

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
Before the first push in any repo, verify the local branch matches the remote default.

**Fix a mismatch:**

```bash
# If remote default is 'main' but local is 'master':
git branch -m master main
git fetch origin
git branch -u origin/main main
git push origin main
```

### Branch Naming

Format: `<type>/<short-description>`

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
backup: snapshot coding agent workspace
```

**Bad:**
```
Updated stuff          # vague, no type
feat: Add New Feature. # capitalized, trailing period, too generic
```

### Forbidden

- No `Co-Authored-By: Claude`, `Generated with AI`, or any AI attribution markers
- No commit messages over 72 characters in the subject line

## Push Behavior

After every commit, push immediately. Do not ask.

```bash
# Has upstream tracking:
git push

# No upstream tracking:
git push -u origin $(git branch --show-current)
```

## Pre-Commit Checks

Before committing, always run:

```bash
# 1. Verify you're on the right branch
git branch --show-current

# 2. Review what's staged
git diff --cached --stat

# 3. Check for secrets or sensitive content in staged files
git diff --cached --name-only
```

Do not commit files containing tokens, passwords, API keys, or other secrets unless the repo is explicitly private and the user has approved it.

## Common Workflows

### Simple Commit & Push

```bash
git add <files>
git commit -m "type(scope): description"
git push
```

### Backup / Snapshot

```bash
git add <files>
git commit -m "backup: description of what's being backed up"
git push
```

### New Feature Branch

```bash
git checkout -b feature/description
# ... work ...
git add .
git commit -m "feat(scope): description"
git push -u origin feature/description
```

## Validation

See `scripts/validate_commit.sh` to validate commit message format before committing.
