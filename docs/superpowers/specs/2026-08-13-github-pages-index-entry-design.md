# GitHub Pages Root Entry Fix Design

**Date:** 2026-08-13
**Status:** Approved for specification by the student; implementation awaits spec review

## Problem

GitHub Actions run 31702918019 completed successfully and deployed the static demo artifact. The deployed artifact contains `static-demo.html`, so `/CodingAgentHarness/static-demo.html` returns HTTP 200, but the required root URL `/CodingAgentHarness/` returns GitHub Pages 404 because the artifact root has no `index.html`.

The existing boundary verifier checks JavaScript for server-only dependencies but does not assert that the artifact has a Pages-compatible root entry. CI therefore reported success without proving the published root URL was usable.

## Scope

Change only the server package's static-demo build contract:

- the static artifact root must contain `index.html`;
- the page must continue loading its generated CSS and JavaScript through relative URLs;
- the local full WebUI entry, API server, credentials, sessions, and artifact persistence must not change;
- no server runtime or API key may enter the static artifact.

## Considered Approaches

### A. Rename the HTML asset inside the Vite bundle (selected)

Add a small static-build-only Vite plugin that changes the generated HTML asset name from `static-demo.html` to `index.html` during bundle generation.

This keeps the existing source entry and all static-demo code in place, makes the desired output part of Vite's own build, and avoids a second build command.

### B. Create a dedicated static root containing another `index.html`

This gives the source file the same name as the deployed entry, but adds another directory and requires source-path or root changes. It is more structural change than this defect needs.

### C. Rename or copy the file after Vite finishes

This is operationally simple, but splits one build contract across Vite and a separate script. A caller could run Vite without the post-build step and recreate the broken artifact.

## Test-Driven Implementation

1. Extend the static boundary verifier test coverage to require `dist/static-demo/index.html` and reject a build containing only `static-demo.html`.
2. Run the focused test/build verification and observe RED against the current configuration.
3. Add the minimal static-only Vite output rename.
4. Rebuild and verify GREEN: `index.html` exists, `static-demo.html` does not, referenced assets exist, and the static boundary scan passes.
5. Run the relevant package and documentation verification before requesting commit approval.

## Release and Remote Verification

After a separately approved commit and push:

- GitHub Actions `unit-test` and `deploy-static-demo` must both succeed;
- `https://sherryicecream.github.io/CodingAgentHarness/` must return HTTP 200;
- the returned HTML must contain the Harness demo title, React root, and relative asset references;
- the direct `static-demo.html` path is not a required compatibility URL.

Release creation remains out of scope until these checks pass.
