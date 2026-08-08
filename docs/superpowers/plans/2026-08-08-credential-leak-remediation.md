# Credential Leak Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the revoked GitHub OAuth token from machine-local project configuration and prevent that configuration file from entering Git.

**Architecture:** Keep `.claude/settings.local.json` as a machine-local permissions file, surgically remove only entries containing the revoked credential, and protect the file with a repository ignore rule. Verification uses JSON parsing, token-pattern scans, Git-history scans, and `git check-ignore`; no application runtime behavior changes.

**Tech Stack:** JSON, `.gitignore`, Git, PowerShell

## Global Constraints

- Never print, copy, or replace the revoked token with another real credential.
- Preserve every unrelated permission entry in `.claude/settings.local.json`.
- Do not modify application source code in this task.
- Treat configuration verification as the test strategy; this task has no production-code unit-test surface.

---

### Task 1: Remove the revoked credential and protect the local file

**Files:**
- Modify: `.claude/settings.local.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the existing JSON `permissions.allow` array and root Git ignore rules.
- Produces: valid local settings containing no GitHub OAuth token and an ignore rule matching `.claude/settings.local.json`.

- [ ] **Step 1: Record the failing security checks without exposing values**

Run a scan that reports only file names and line numbers for `gho_` token patterns, then run:

```powershell
git -c safe.directory=D:/CodingAgentHarness check-ignore -q .claude/settings.local.json
```

Expected before the change: the token-pattern scan reports `.claude/settings.local.json`, and `git check-ignore` exits non-zero.

- [ ] **Step 2: Remove only secret-bearing permission entries**

Delete each complete JSON array item whose command contains a `gho_` credential. Preserve all other entries and valid comma placement. Do not substitute a placeholder token.

- [ ] **Step 3: Add the machine-local ignore rule**

Append this focused section to `.gitignore`:

```gitignore
# Machine-local agent settings
.claude/settings.local.json
```

- [ ] **Step 4: Verify JSON validity and ignore behavior**

Run:

```powershell
Get-Content -Raw .claude/settings.local.json | ConvertFrom-Json | Out-Null
git -c safe.directory=D:/CodingAgentHarness check-ignore -v .claude/settings.local.json
```

Expected: JSON parsing exits zero and Git identifies the new `.gitignore` rule.

- [ ] **Step 5: Verify the working tree and all Git revisions contain no OAuth token**

Run redacted scans for `gho_[A-Za-z0-9]{20,}` across non-generated workspace files and every Git revision. Output must contain only paths/counts, never matched secret text.

Expected: zero matches.

- [ ] **Step 6: Review and commit the tracked change**

Stage only `.gitignore`; `.claude/settings.local.json` must remain ignored and untracked. Inspect the staged diff and scan it for credential patterns, then commit:

```powershell
git add .gitignore
git commit -m "security: ignore machine-local agent settings"
```

Expected: the commit contains only `.gitignore`; the local settings cleanup remains intentionally untracked.
