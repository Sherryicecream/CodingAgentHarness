# Task 4 Report

## Status

The stale-build artifact bug is fixed and covered by a passing package-manifest regression test. The required clean-install runtime proof is **not completed**: the first full install attempt timed out during `npm install`, and no later network install is claimed as evidence.

## Root cause and minimal fix

`@harness/server` ran `tsup` without cleaning `packages/server/dist`. Vite's `--emptyOutDir` cleans only the client output (`dist/client`), so an obsolete server chunk such as `privileged-agent-run-*.js` remained under `dist` and was included by the package `files: ["dist"]` rule.

The server build script now uses:

```text
tsup src/server.ts --format esm --clean && vite build client --emptyOutDir
```

No shell-process behavior was changed.

## TDD evidence

### RED

Command:

```text
npm.cmd test --workspace @harness/cli
```

Exit code: `1` (8.2 s). The added test wrote `dist/privileged-agent-run-stale.js`, rebuilt the server, and inspected `npm pack --dry-run --json`. The expected failure showed that the tarball manifest still contained:

```text
dist/privileged-agent-run-stale.js
```

### GREEN

Command:

```text
node --test --test-name-pattern "server build removes stale chunks" test/installed-runtime.test.mjs
```

Working directory: `packages/cli`.

Exit code: `0` (4.0 s): `1` passed, `0` failed. The test uses a fresh temporary npm cache, adds the stale chunk, rebuilds, runs `npm pack --dry-run --json`, asserts the stale file is absent, and removes its cache directory.

## Clean-install runtime proof (not completed)

The installed-runtime test packs `@harness/core`, `@harness/server`, and `@harness/cli` into a fresh temporary directory, uses a per-run `npm_config_cache`, installs the three tarballs with `npm install --ignore-scripts`, starts the installed `harness` command with fake/no credentials, and requests:

```text
http://127.0.0.1:<random-port>/api/health
http://127.0.0.1:<random-port>/
```

Command:

```text
npm.cmd test --workspace @harness/cli
```

Exit code: `124` after `60.2` seconds. It reached the full integration test but produced no result after the Node `DEP0190` shell warning; the bounded command was stopped during the package-install portion. Per coordination direction, no further network install was attempted.

An earlier approved manual install runner returned exit code `0` after 39 seconds but emitted no stdout/stderr, so it did not provide auditable evidence for tarball names, install result, server start, health, Web UI, process cleanup, or fake-credential use. It is intentionally excluded from verification claims.

## Completed local verification

| Command | Exit code | Result |
| --- | ---: | --- |
| `npm.cmd run build --workspace @harness/core` | 0 | built |
| `npm.cmd run build --workspace @harness/server` | 0 | built client and cleaned server `dist` |
| `npm.cmd run build --workspace @harness/cli` | 0 | built |
| `npm.cmd test --workspace @harness/core` | 0 | 297 passed |
| `npm.cmd test --workspace @harness/server` | 0 | 184 passed |
| stale-chunk manifest test above | 0 | 1 passed |

## Other Task 4 changes retained

- Added server `main`/`exports` metadata for the installed runtime.
- Replaced workspace-only runtime dependency specifiers with publishable `^0.1.0` ranges.
- Removed CLI monorepo-relative server resolution; it resolves `@harness/server` through package metadata.
- Uses loopback `127.0.0.1` by default and serves packaged client assets relative to the installed server entry.
