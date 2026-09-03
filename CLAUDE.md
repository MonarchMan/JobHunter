# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JobHunter is a personal job hunting workbench that syncs job postings from company career sites, imports resumes, generates candidate profiles, and provides job matching. It runs locally with SQLite storage and an optional AI model integration.

**Tech Stack:** Node.js 24.x, TypeScript (strict mode), pnpm 11.x workspace, SQLite, Next.js, Playwright

**Languages:** Chinese UI with English technical identifiers

## Common Commands

### Setup & Initialization

```bash
pnpm install
cp .env.example .env  # Edit to configure model provider if needed
pnpm --filter @jobhunter/cli build
node apps/cli/dist/main.js init
node apps/cli/dist/main.js doctor
```

### Development

```bash
# Start web console (auto-launches worker)
pnpm --filter @jobhunter/web dev  # http://127.0.0.1:3210

# Build CLI only
pnpm --filter @jobhunter/cli build

# Build all packages
pnpm build
```

### Testing & Validation

```bash
pnpm typecheck           # Type check all packages
pnpm test                # Unit tests
pnpm test:integration    # Integration tests
pnpm test:e2e            # Browser E2E tests
pnpm boundaries          # Validate package dependencies
pnpm docs:check          # Validate spec documents
pnpm check               # Run all checks (format, lint, typecheck, test, boundaries, docs)
```

### CLI Operations

```bash
# After building CLI
node apps/cli/dist/main.js <command>

# Common commands
node apps/cli/dist/main.js source list
node apps/cli/dist/main.js source sync tencent-social --wait
node apps/cli/dist/main.js resume import "path/to/resume.pdf"
node apps/cli/dist/main.js job list --limit 20
node apps/cli/dist/main.js task list --status pending,running
node apps/cli/dist/main.js worker start  # Only if not using web auto-launch
```

## Architecture

### Modular Monolith with Unidirectional Dependencies

```
apps/           - Entry points (CLI, Worker, Web)
  cli/          - Command-line interface
  worker/       - Background task executor
  web/          - Next.js management console

packages/       - Reusable capabilities
  domain/       - Pure domain models, rules, domain-level abstractions (Clock, ID)
  application/  - Use case orchestration, repository ports
  db/           - SQLite persistence (implements repository ports)
  source-core/  - Source adapter contract, HTTP & browser ports
  sources/      - Company career site adapters
  agent-core/   - Model adapter contract
  llm/          - OpenAI/Anthropic model clients
  matching/     - Job matching logic
  resume/       - Resume parsing
  observability/ - Logging and monitoring
  testkit/      - Testing utilities

specs/          - Specification-Driven Development (SDD) documents
docs/           - Architecture decisions (ADR) and documentation
var/            - Local runtime data (not committed)
```

**Dependency Rules (Enforced by `pnpm boundaries`):**

1. `apps/` may import from `packages/` but not from other apps
2. `domain/` has NO dependencies on application, db, browser, model SDKs, or any infrastructure
3. `application/` declares ports (interfaces), never imports infrastructure implementations
4. Infrastructure packages (db, llm, sources) implement ports but cannot be imported by application layer
5. Cross-package imports must use public entry points only

### Key Architectural Patterns

- **Repository Pattern:** All data access through repository interfaces declared in `application/`, implemented in `db/`
- **Adapter Pattern:** External systems (sources, models) accessed through ports/adapters
- **Background Processing:** Long-running tasks (sync, OCR, matching) run in Worker with persistent task queue
- **Model Integration:** Optional - only needed for resume profiling, job understanding, and match suggestions

### Worker vs Web

- **Worker:** Executes background tasks (job sync, resume parsing, matching). Runs as subprocess when web starts, or standalone via CLI.
- **Web:** Next.js UI on port 3210. Auto-launches worker child process. Do not start a second worker manually.

## Development Workflow

### Specification-Driven Development (SDD)

**Before implementing any feature:**

1. Create or update `spec.md` in `specs/<feature-id>/` with requirements
2. Create `design.md` with technical design
3. Create `tasks.md` with implementation tasks
4. For architectural changes, update `docs/arch/` and add ADR in `docs/adr/`
5. Implement code and tests referencing the same terminology

All specs must be in `Ready` state before implementation begins.

### Testing Strategy

- **Unit tests:** Test domain logic and use cases in isolation
- **Integration tests:** Test repository implementations, adapters with real SQLite
- **E2E tests:** Test web UI flows with Playwright
- **Online tests:** Test real career site adapters (disabled by default, requires `JOBHUNTER_ONLINE_SOURCES=1`)

### Code Quality Gates

Every change must pass:

- `pnpm format:check` - Prettier formatting
- `pnpm lint` - ESLint
- `pnpm typecheck` - TypeScript strict mode
- `pnpm test` - Unit tests
- `pnpm boundaries` - Dependency rules
- `pnpm docs:check` - Spec document validation

Run `pnpm check` to execute all gates.

## Design System (DESIGN.md)

The web interface follows a restrained "档案工作台" (archive workbench) design:

- **Colors:** Archive indigo (`primary`) for main actions, coral (`action`) for decision cursor (next-step highlights only)
- **NO green brand colors** - Health status is the only exception with dedicated `health-*` tokens
- **Typography:** 16px base for prose, 14px for dense tables. Chinese uses Inter + Noto Sans SC
- **Motion:** Restrained - 120ms feedback, 180ms content changes, 260ms overlays
- **Desktop-first:** 1280px+ primary, 390px+ mobile support

Key components use specific variants detailed in DESIGN.md (e.g., "准备档案工作台" for interview prep, "在线简历工作台" for profile editing).

## Environment Configuration

Copy `.env.example` to `.env` and configure:

- `JOBHUNTER_DATA_ROOT=./var` - Local data directory
- `JOBHUNTER_LOG_LEVEL=info` - Logging level
- Model provider (optional, only for AI features):
  - OpenAI-compatible: `BASE_URL`, `API_KEY`, `MODEL`
  - Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`
- Browser path (optional): `JOBHUNTER_BROWSER_EXECUTABLE` - Auto-detects Chrome/Edge on macOS/Windows

Install Playwright Chromium if system browser not available:

```bash
pnpm exec playwright install chromium
```

## Important Notes

- **Data Safety:** `.env`, SQLite DB, resumes, and logs stay local in `var/`. Never commit them.
- **Career Site Adapters:** Must respect site access policies. No login forgery or captcha bypass.
- **Web Security:** Web binds to 127.0.0.1 only. Not for public exposure.
- **Backup/Restore:** Stop worker and web before backup operations.
- **Single Worker:** Never run multiple worker instances against the same database.

## Debugging

- Logs: `var/logs/jobhunter.log` (sanitized error chains)
- Task status: Web `/tasks` page or `node apps/cli/dist/main.js task list`
- Agent runs: Web `/agent-runs` page
- Database: `var/data/jobhunter.db` (SQLite)
- Health check: `node apps/cli/dist/main.js doctor`
