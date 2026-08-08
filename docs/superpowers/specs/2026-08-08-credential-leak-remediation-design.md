# Credential Leak Remediation Design

## Goal

Remove the revoked GitHub OAuth token from local project configuration, prevent the local configuration file from being committed, and verify that no equivalent credential exists in the working tree or Git history.

## Scope

This step only addresses the exposed token in `.claude/settings.local.json` and the repository rule needed to keep that machine-local file out of Git. It does not redesign application API-key storage, public-server authentication, or deployment security; those are separate follow-up fixes.

## Chosen approach

Preserve the machine-local permission configuration but remove every permission entry containing the revoked token. Add `.claude/settings.local.json` to the root `.gitignore` so the file cannot be accidentally staged.

Deleting the whole file was rejected because it would also discard unrelated local permission settings. Keeping the file unchanged was rejected because a revoked credential is still sensitive material and may be copied into logs, backups, or future prompts.

## Changes

- Remove the two command entries containing the revoked `gho_` token from `.claude/settings.local.json`.
- Add `.claude/settings.local.json` to `.gitignore` under a machine-local configuration section.
- Do not add a sample token or placeholder credential anywhere in the repository.

## Verification

1. Parse `.claude/settings.local.json` as JSON to ensure the surgical edit leaves valid syntax.
2. Scan non-generated workspace files for GitHub OAuth token patterns without printing secret values.
3. Scan all Git revisions for the same token pattern.
4. Verify `git check-ignore -v .claude/settings.local.json` identifies the new ignore rule.
5. Inspect the staged diff for credential-like content before any commit.

## Rollback and safety

The GitHub token has already been revoked by the user. Removing the local command entries does not delete repository data or source code. Other local Claude permission entries remain intact. If a removed GitHub operation is needed later, it must use a newly authenticated credential through the operating-system credential manager rather than embedding a token in a command.
