# Public API Security and BYOK Design

## Goal

Keep the Web UI anonymously accessible while removing the public remote-code-execution boundary. Visitors can run a deterministic no-key demonstration or provide their own DeepSeek API key for a real-LLM experience with restricted tools. Full Shell, Git, test execution, server-owned credentials, and HITL remain available only in trusted local mode.

## Runtime modes

`HARNESS_MODE` has two explicit values:

- `public`: anonymous Internet-facing deployment. It exposes demo and BYOK experiences but never registers arbitrary Shell, Git, publishing, or test-process tools.
- `local`: trusted single-user deployment. It may use the locally configured server credential and the complete tool set, but the workspace is still selected by the server rather than accepted from a request.

Missing or invalid `HARNESS_MODE` fails closed to `public`. The UI displays the effective mode and the capabilities available in that mode.

## Public experiences

### Deterministic demo

The no-key path uses a scripted mock adapter and a controlled in-process demonstration validator. It demonstrates context construction, tool dispatch, a blocked dangerous action, an injected failure, feedback reinjection, and a corrected next action. It does not execute visitor-supplied code or commands.

### Bring your own key

The visitor may enter a DeepSeek API key to use a real model. The key remains in React component memory, is sent only with the run request over HTTPS, is used to construct one adapter for that run, and is then released. It is never written to browser storage, the credential store, session JSON, SSE events, logs, or error responses.

BYOK mode registers only workspace-confined read, write, and search tools. It does not promise arbitrary test execution or a full autonomous repair loop; the UI explains that those capabilities require local mode. BYOK requests are rejected unless the request is HTTPS or originates from a loopback development address.

## Components

### RuntimePolicy

Parses `HARNESS_MODE`, returns the allowed experience modes and tool capabilities, and decides whether server-owned credentials may be read. Public policy cannot be weakened by request fields.

### WorkspaceManager

Creates a server-owned root and one cryptographically random child directory per issued session. All tool roots come from this manager. It rejects paths outside the root and deletes only directories it created after a one-hour TTL. Clients never submit `workingDir`.

### SessionRegistry

Issues server-generated session IDs, records their owning client fingerprint, effective mode, status, workspace, creation time, and expiry, and enforces a maximum of two running sessions per source IP. Secrets are not part of the record.

### PublicDemoAdapter

Provides deterministic scripted responses for the mechanism demonstration and uses an in-process validator rather than `child_process`. The adapter is injectable so the scenario is covered without network access.

### RequestLimiter

Uses a maintained Express rate-limiting package for per-IP request limits and a separate SessionRegistry concurrency limit. The exact defaults are 20 run attempts per hour per IP and two concurrent runs per IP, with environment-variable overrides for deployment tuning.

## API and data flow

1. `POST /api/agent/sessions` creates a server-owned session and workspace and returns the session ID plus public capability metadata.
2. The browser opens `GET /api/agent/stream/:sessionId`.
3. `POST /api/agent/run` accepts `{ sessionId, task, mode, apiKey? }`. It rejects unknown fields, tasks longer than 4000 characters, unissued or expired sessions, and a second run for the same session.
4. The server selects the adapter and tool registry from RuntimePolicy. Request fields cannot enable local tools.
5. Progress travels through SSE. Event serialization applies a final secret-redaction guard.
6. Completion releases the adapter reference and schedules workspace cleanup at the session expiry time.

Public mode returns 403 for `/api/config/*`. Local mode keeps credential status, update, clear, and test operations. CORS is same-origin by default; an optional explicit origin list can be supplied by deployment configuration. Express accepts at most 64 KB JSON bodies and does not expose `X-Powered-By`.

## HTTPS boundary

The server trusts one configured reverse proxy hop in production. BYOK checks `req.secure` after proxy processing. Loopback HTTP is accepted only for local development. The public deployment must terminate TLS before BYOK is enabled; an HTTP deployment can still serve the no-key mock demonstration.

## Error handling and observability

- Validation errors return stable error codes without echoing request bodies.
- Upstream LLM errors expose only provider status and a safe summary; response bodies are not returned.
- Logs include session ID, mode, duration, and outcome, but exclude task text, key material, tool file contents, and provider response bodies.
- Workspace cleanup failures are logged as path-free error codes and retried without expanding the deletion boundary.

## Testing strategy

Server code is refactored into an app factory so Supertest can exercise it without binding a port. Tests are written before each behavior change and use injected adapters, clocks, and temporary workspace roots.

Required tests prove:

- request-supplied `workingDir` is rejected and never reaches a tool factory;
- public registries omit Shell, Git, publishing, and process-based test tools;
- separate sessions cannot read or write each other's files;
- public configuration endpoints return 403 without touching the credential store;
- insecure BYOK is rejected while loopback development is accepted;
- keys do not appear in persisted sessions, SSE payloads, logs, or sanitized upstream errors;
- unknown fields, missing fields, overlong tasks, expired sessions, duplicate runs, concurrency excess, and rate excess receive deterministic 4xx responses;
- local policy retains the complete trusted tool set;
- the deterministic demo reproduces guardrail and feedback behavior without network or subprocess execution;
- all existing core tests remain green.

## Deployment and documentation

README documents the public/local distinction, HTTPS requirement, capability limitations, environment variables, and BYOK data lifecycle. The Web UI labels the active mode and does not render the key input when the page is not a secure context, except on loopback development. CI runs core tests, server tests, and the production build.

## Non-goals

- Multi-tenant production code execution is not provided.
- Public arbitrary Shell, package installation, Git push, and test execution are not provided.
- Container-per-request isolation, outbound network sandboxes, billing, user accounts, and durable public workspaces are outside this change.
- Fixing the existing dependency audit findings, HITL resume defect, credential encryption design, and CI Node-version mismatch remains separate work.
