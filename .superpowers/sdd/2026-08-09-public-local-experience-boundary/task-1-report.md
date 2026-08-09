# Task 1 Report: Public server policy

- status: DONE
- files changed and why:
  - `packages/server/src/security/runtime-policy.ts`: makes the public policy demo-only and unconditionally disables BYOK-over-HTTP.
  - `packages/server/test/security/runtime-policy.test.ts`: asserts the exact public capability set and preserves the full local capability set.
  - `packages/server/test/routes/public-agent-routes.test.ts`: verifies session capabilities and rejects forged public BYOK/server runs with `403 EXPERIENCE_NOT_ALLOWED` before invoking the agent runner.

- RED command: `npm.cmd test --workspace @harness/server -- runtime-policy.test.ts public-agent-routes.test.ts`
- RED exact failure summary: `2 failed test files; 6 failed, 40 passed (46)` because the current public policy reported `allowByok: true` with `['demo', 'byok']`, and a forged BYOK run returned `202` rather than `403`.
- GREEN command: `npm.cmd test --workspace @harness/server -- runtime-policy.test.ts public-agent-routes.test.ts`
- GREEN exact pass summary: `2 passed test files; 46 passed (46)`.
- commit hash: pending
- self-review findings and remaining concerns:
  - No findings. The change is scoped to public runtime policy and its route/policy tests; local behavior remains unchanged.
  - `git diff --check` passed. The scoped diff contains only the non-secret fixture literal `forged-public-key`; no realistic credentials were found.
