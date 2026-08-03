# Coding Agent Harness

A TypeScript implementation of a coding agent harness. **Agent = LLM + Harness.** The harness provides the engineering layer: main loop, tools, guardrails, feedback loop, memory, and configuration.

---

## What is this?

This project implements the harness side of a coding agent -- the deterministic software infrastructure that surrounds an LLM to turn it from a text generator into a reliable coding assistant. The harness is the "engineering" part; the LLM is the "intelligence" part.

The harness provides six core mechanisms:

1. **Agent Loop** -- the main orchestration loop that drives the LLM-tool-feedback cycle
2. **Tools** -- filesystem, shell, git, code search, and test execution
3. **Guardrail + HITL** -- safety checks that block dangerous commands and require human approval
4. **Feedback Loop** (key contribution) -- automatic test-driven fix iteration: run tests, classify failures, build fix suggestions, feed back to LLM
5. **Memory** -- cross-session knowledge storage and retrieval via SQLite
6. **Configuration** -- declarative YAML config with secure credential management

---

## Architecture

```
harness/
├── packages/
│   ├── core/          @harness/core  — Pure logic, mock-testable, zero UI
│   ├── server/        @harness/server — Express + React full-stack app
│   └── cli/           @harness/cli   — Optional CLI launcher
```

- **`@harness/core`**: All deterministic logic -- LLM adapters, tool registry, guardrail, HITL state machine, feedback loop (test runner, result parser, failure classifier, fix suggestion builder), memory store, config loader, agent loop, session store. All interfaces are injectable, making the entire system testable with mock LLMs.
- **`@harness/server`**: Express server with REST API + SSE streaming, React frontend with ChatPanel, ToolCallCard, GuardrailDialog, FeedbackTimeline, and SessionHistory.
- **`@harness/cli`**: Minimal CLI that starts the server and opens the browser.

---

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run all tests (278 tests)
npm test

# Start the server
cd packages/server && npm start
# Open http://localhost:3000
```

### Using the CLI

```bash
cd packages/cli && npm run build && npm start
# Or: npx harness
```

### Using Docker

```bash
# Build the image
docker build -t harness .

# Run the container
docker run -d -p 3000:3000 -e DEEPSEEK_API_KEY=your_key_here harness

# Open http://localhost:3000
```

### npm Packages (Global Install)

```bash
# Install the CLI globally
npm install -g @harness/cli

# Start the harness
harness
```

---

## Key Features

### 1. Agent Loop

The main loop orchestrates the full agent workflow:
- Build context from task, tools, memory, and feedback state
- Call LLM to get next action
- Parse response, extract tool calls
- Execute tools with guardrail checks
- Run feedback loop on test results
- Check stop conditions (task complete, max iterations, HITL blocked)

### 2. Tools

Seven built-in tools:
| Tool | Risk Level | Description |
|------|-----------|-------------|
| `read_file` | safe | Read file contents with path traversal protection |
| `write_file` | moderate | Write files with .git protection |
| `execute_shell` | moderate | Run shell commands with timeout |
| `run_tests` | safe | Execute test suite (entry point for feedback loop) |
| `search_code` | safe | Search codebase with pattern matching |
| `git_diff` | safe | View git working tree changes |
| `git_commit` | dangerous | Commit changes (triggers guardrail + HITL) |

### 3. Guardrail + HITL

The guardrail system intercepts dangerous operations before execution:
- Built-in patterns: `rm -rf`, `DROP TABLE`, `git push --force`, `npm publish`, `chmod 777`, disk formatting
- Human-in-the-loop (HITL) state machine: `running -> blocked -> waiting_user -> approved/rejected -> running`
- Configurable blocked commands via `.harness/config.yaml`

### 4. Feedback Loop (Key Contribution)

The feedback loop is the core innovation -- automated test-driven iteration:
1. **TestRunner** executes the test suite
2. **ResultParser** extracts structured failure data from test output (Jest/Vitest plugins)
3. **FailureClassifier** categorizes failures (syntax, assertion, timeout, runtime) and prioritizes them
4. **FixSuggestionBuilder** builds structured fix context
5. **FeedbackLoop** orchestrates the pipeline and injects results back into the LLM context

### 5. Memory

Cross-session knowledge storage:
- SQLite-backed persistent storage
- Four memory types: convention, decision, knowledge, rule
- Keyword search with relevance ranking
- Per-project isolation

### 6. Configuration

Declarative YAML configuration (`.harness/config.yaml`):
- `maxIterations`, `testCommand`, `allowedTools`, `blockedCommands`, `ignoredPaths`
- Defaults with user overrides
- Validation on load

---

## Directory Structure

```
packages/
├── core/
│   ├── src/
│   │   ├── types.ts              # All shared TypeScript interfaces
│   │   ├── index.ts              # Unified exports
│   │   ├── llm/                  # LLM abstraction layer
│   │   │   ├── adapter.ts        # LLMAdapter interface
│   │   │   ├── mock.ts           # MockLLMAdapter (deterministic testing)
│   │   │   ├── deepseek.ts       # DeepSeekAdapter (real API)
│   │   │   └── response-parser.ts # Response parsing
│   │   ├── tools/                # Tool system
│   │   │   ├── tool.ts           # ToolRegistry
│   │   │   ├── read-file.ts
│   │   │   ├── write-file.ts
│   │   │   ├── execute-shell.ts
│   │   │   ├── run-tests.ts
│   │   │   ├── search-code.ts
│   │   │   ├── git-diff.ts
│   │   │   └── git-commit.ts
│   │   ├── guardrail/            # Safety + HITL
│   │   │   ├── guardrail.ts      # Command pattern matching
│   │   │   ├── hitl.ts           # HITL state machine
│   │   │   └── index.ts          # GovernanceService
│   │   ├── feedback/             # Feedback loop (key contribution)
│   │   │   ├── test-runner.ts
│   │   │   ├── result-parser.ts
│   │   │   ├── failure-classifier.ts
│   │   │   ├── fix-suggestion.ts
│   │   │   ├── feedback-loop.ts
│   │   │   └── index.ts
│   │   ├── memory/               # Memory system
│   │   │   └── memory-store.ts
│   │   ├── config/               # Configuration
│   │   │   └── config-loader.ts
│   │   └── loop/                 # Agent loop
│   │       ├── agent-loop.ts
│   │       ├── context-builder.ts
│   │       ├── stop-condition.ts
│   │       └── session-store.ts
│   └── test/                     # 278 tests
│       ├── llm/
│       ├── tools/
│       ├── guardrail/
│       ├── feedback/
│       ├── memory/
│       ├── config/
│       ├── loop/
│       └── demo/
├── server/
│   ├── src/
│   │   ├── server.ts             # Express app
│   │   ├── routes/
│   │   │   ├── agent.ts          # POST /api/agent/run + SSE
│   │   │   ├── session.ts        # GET /api/sessions
│   │   │   └── config.ts         # API key management
│   │   └── sse/
│   │       └── sse-manager.ts    # SSE connection manager
│   └── client/                   # React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ChatPanel.tsx
│       │   │   ├── ToolCallCard.tsx
│       │   │   ├── GuardrailDialog.tsx
│       │   │   ├── FeedbackTimeline.tsx
│       │   │   └── SessionHistory.tsx
│       │   └── hooks/
│       │       └── useSSE.ts
│       └── vite.config.ts
└── cli/
    └── src/
        └── cli.ts                # CLI entry point
```

---

## Security

### Credential Storage

API keys are stored securely using the operating system's native credential manager:
- **Windows**: Windows Credential Manager
- **macOS**: Keychain
- **Linux**: Secret Service API / libsecret

The API key is never:
- Hardcoded in source code
- Logged to console or files
- Included in git commits
- Exposed in API responses (status endpoint only returns `hasKey: boolean`)

### Threat Model

- **In scope**: credential theft from filesystem, log leakage, git exposure
- **Out of scope**: memory scraping, kernel-level attacks, supply chain attacks on dependencies

---

## Deployment

### Docker (Recommended for Cloud)

```bash
# Build and run
docker build -t harness .
docker run -d -p 3000:3000 \
  -e DEEPSEEK_API_KEY=your_key_here \
  -e NODE_ENV=production \
  harness
```

### Docker Compose (with auto-restart)

```yaml
version: '3'
services:
  harness:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DEEPSEEK_API_KEY=your_key_here
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### Alibaba Cloud (ECS)

1. RDP into your Windows ECS instance
2. Install Node.js 22+ from `https://nodejs.org`
3. `git clone https://github.com/Sherryicecream/CodingAgentHarness.git`
4. `cd CodingAgentHarness && npm install && npm run build`
5. `cd packages/server && NODE_ENV=production npm start`
6. Configure security group: allow inbound on port 3000
7. Visit `http://<your-ip>:3000`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js 18+ |
| Web Server | Express 4 |
| Frontend | React 19 + Vite |
| LLM | DeepSeek (OpenAI-compatible API) |
| Database | SQLite (via sql.js) |
| Test Framework | Vitest |
| Build | tsup |
| Deployment | Alibaba Cloud ECS (Docker) |
| Monorepo | npm workspaces |

---

## Known Limitations

1. **Windows Server Deployment**: The project was developed for Unix-like environments. On Windows Server, ensure Node.js 22+ is installed and the Vite frontend build succeeds. The `npm run build` command handles both backend and frontend.
2. **Localhost-Only Web**: The web interface is designed for local use. Remote deployment requires security group configuration.
3. **Test Parser Scope**: The feedback loop's ResultParser supports Jest and Vitest output formats. Other test frameworks (pytest, go test) require custom plugins.
4. **Single-User**: The harness is designed for single-user, single-project use. No multi-tenancy or concurrent session isolation.
5. **Windows Paths**: Some shell commands assume Unix-style paths. On Windows, use Git Bash or WSL for full compatibility.