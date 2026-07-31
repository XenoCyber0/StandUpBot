# StandupBot

Auto-generate high-quality **PR descriptions** and **changelog entries** from git diffs, using **any LLM you point it at**. It's provider-agnostic: bring-your-own OpenAI-compatible endpoint (OpenAI, OpenRouter, omniroute, freellmapi, Ollama, LM Studio, …). No provider, base URL, or model is hardcoded — everything is user-configurable.

<!-- Badges -->

<!-- TODO(RELEASE): replace `your-org/standupbot` with the real `owner/repo` path (2 occurrences in this file) before publishing. -->

[![CI](https://github.com/your-org/standupbot/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/standupbot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-brightgreen.svg)](https://nodejs.org/)

<!-- TODO(RELEASE): docs/demo.gif is a placeholder — record a real demo (see docs/README.md) before publishing. -->

![StandupBot demo](docs/demo.gif)

---

## What it does

Given the diff of a pull request, StandupBot produces:

- a concise **PR title** (≤ 72 chars, imperative mood),
- a structured **description** with `## Summary` / `## Changes` / `## Testing` sections,
- up to three **labels** chosen from `bug`, `feature`, `chore`, `docs`, `refactor`.

It handles large diffs **intelligently**: excluded files (lockfiles, generated code) and oversized files are collapsed to one-line stats or summarised by the LLM — never blindly truncated mid-body.

It runs in two ways:

1. **CLI** — `npx standupbot pr-description` on a branch prints a description; `--write` fills the open PR via `gh pr edit`.
2. **GitHub Action** — on `pull_request` opened/synchronize, it writes the description via the API, **only if** the PR description is empty or already contains the `<!-- standupbot -->` marker (so it never clobbers a hand-written description).

---

## Setup

StandupBot is **bring-your-own-provider**: point it at any OpenAI-compatible chat-completions endpoint and set three things — a **base URL**, an **API key**, and a **model**. There is no built-in default or hidden fallback; if one of these is missing it fails fast with a clear error.

**Precedence:** environment variables override `.standupbot.yml`. The API key is **only ever read from the environment — never from a committed config file.**

| Setting       | Environment variable | `.standupbot.yml` key | Required | Default                               |
| ------------- | -------------------- | --------------------- | -------- | ------------------------------------- |
| Base URL      | `LLM_BASE_URL`       | `llm.baseUrl`         | yes      | —                                     |
| API key       | `LLM_API_KEY`        | — (env only)          | yes      | —                                     |
| Model         | `LLM_MODEL`          | `llm.model`           | yes      | — (no default)                        |
| Provider type | `LLM_PROVIDER_TYPE`  | `llm.providerType`    | no       | `openai-compatible` (only impl today) |

`LLM_PROVIDER_TYPE` selects the wire format. Only `openai-compatible` is implemented today; it's reserved for future providers (e.g. an Anthropic-shaped client) that can be swapped in without changing calling code.

### Example configurations

**OpenAI (direct):**

```bash
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_API_KEY="sk-..."
export LLM_MODEL="gpt-4o-mini"
```

**OpenRouter:**

```bash
export LLM_BASE_URL="https://openrouter.ai/api/v1"
export LLM_API_KEY="sk-or-..."
export LLM_MODEL="anthropic/claude-3.5-sonnet"
```

**Any OpenAI-compatible gateway** (omniroute, freellmapi, Ollama, LM Studio, …):

```bash
export LLM_BASE_URL="https://your-gateway.example.com/v1"   # or http://localhost:11434/v1 for Ollama
export LLM_API_KEY="your-key"
export LLM_MODEL="the-model-your-gateway-expects"
```

> The client sends `POST {LLM_BASE_URL}/chat/completions` with `Authorization: Bearer {LLM_API_KEY}` and `response_format: { type: "json_object" }` — the OpenAI-compatible shape every gateway above speaks.

**Commit non-secret config** (model, base URL) in `.standupbot.yml`, keep the key in env:

```yaml
llm:
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-3.5-sonnet
  # apiKey is NOT allowed here — set LLM_API_KEY in your environment instead.
```

### CLI

```bash
pnpm install
pnpm build

# generate a description for the current branch vs. the default branch
node dist/cli/index.js pr-description

# or, once linked:
npx standupbot pr-description
```

On a branch with an open PR, auto-fill it:

```bash
node dist/cli/index.js pr-description --write
```

Useful flags:

| Flag                  | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `--base <ref>`        | ref to diff against (default: `origin/<default-branch>`, merge-base)  |
| `--repo <owner/repo>` | override the repo slug used in the prompt context                     |
| `--tone <tone>`       | override prompt tone (`concise`, `detailed`, `playful`, …)            |
| `-w, --write`         | fill the current branch's PR via `gh pr edit` (requires the `gh` CLI) |

### GitHub Action

Add to `.github/workflows/standupbot.yml`:

```yaml
name: StandupBot
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  issues: write # for labels
  contents: read

jobs:
  describe:
    runs-on: ubuntu-latest
    steps:
      # TODO(RELEASE): replace `your-org/standupbot` with the real `owner/repo` path.
      - uses: your-org/standupbot@v1
        with:
          llm-base-url: ${{ secrets.LLM_BASE_URL }}
          llm-api-key: ${{ secrets.LLM_API_KEY }}
          model: ${{ vars.LLM_MODEL }} # required (no default)
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The Action inputs mirror the env vars (`llm-base-url` → `LLM_BASE_URL`, `llm-api-key` → `LLM_API_KEY`, `model` → `LLM_MODEL`); inputs take precedence and both fall back to `.standupbot.yml`. Because `model` has **no default**, it must come from the input, the `LLM_MODEL` env var, or config — otherwise the run fails fast with a clear error.

Store `LLM_API_KEY` (and optionally `LLM_BASE_URL`) as **repository secrets**.

> **Note for the Action to run:** the `dist/` output must be committed (the `action.yml` runtime is `node20` and executes `dist/action/index.js` directly). `pnpm build` regenerates it.

---

## Configuration (`.standupbot.yml`)

Optional. Place at the repo root.

```yaml
tone: concise # any free-form tone steer
maxDiffTokens: 6000 # budget before hierarchical summarisation kicks in
exclude: # gitignore-style globs, excluded from the prompt
  - package-lock.json
  - pnpm-lock.yaml
  - yarn.lock
  - '**/*.lock'
  - '**/*.min.js'
  - '**/dist/**'
  - '**/generated/**'

# Non-secret bring-your-own-provider LLM settings (env vars override these):
llm:
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-3.5-sonnet
  # apiKey is never allowed here — use the LLM_API_KEY env var.
```

See [`.standupbot.example.yml`](./.standupbot.example.yml).

---

## Development

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run
pnpm lint          # eslint
pnpm format        # prettier --write
pnpm build         # emit dist/         (CLI + library via tsc)
pnpm package       # emit dist-action/ (self-contained ncc bundle for the Action)
```

> **Two separate build outputs.** `pnpm build` (tsc → `dist/`) builds the CLI/library and is what npm publishes. `pnpm package` (ncc → `dist-action/index.js`) builds the GitHub Action into a single self-contained file with no runtime `node_modules`. Keep them independent — only the Action uses the ncc bundle.

### Releasing the GitHub Action

The Action (`action.yml`) runs `dist-action/index.js` directly (no install step on the runner), so **the compiled `dist-action/` bundle must be committed to the repo and kept in sync with `src/action/`**. `dist/` stays untracked.

Release flow:

```bash
pnpm build && pnpm package   # regenerate dist/ and dist-action/index.js
git add dist-action action.yml src
git commit -m "Release <version>"
git tag vX.Y.Z && git push --tags
```

CI (`.github/workflows/ci.yml`) runs `install → typecheck → lint → test → build → package` on every push/PR, so build drift is caught automatically; run `pnpm package` locally before tagging a release. (Optionally, publish a floating major tag like `v1` pointing at the latest release so users can `uses: <owner>/standupbot@v1`.)

### Project layout

```
src/
  core/      shared logic: diff parsing, prompt building, chunking, LLM client
  cli/       CLI entrypoint (npx standupbot)
  action/    GitHub Action entrypoint
action.yml   GitHub Action manifest
tests/       vitest suites (LLM is mocked)
```

---

## How the LLM call works

- One **system prompt** defines the exact JSON contract (`title`, `description`, `labels`).
- The **user prompt** carries repo/branch/commits, tone, the label taxonomy, and the (possibly summarised) diff.
- The client calls `POST {LLM_BASE_URL}/chat/completions` (OpenAI-compatible) with `response_format: { type: "json_object" }`, retries transient failures (429/5xx/timeouts) with exponential backoff + jitter, and enforces a per-request timeout. The concrete endpoint and model come from your config — nothing is hardcoded.
- The response is parsed defensively: JSON is extracted even if the model wraps it in prose/code fences, labels are clamped to the allowed taxonomy, and the title is normalised.

---

## License

[MIT](./LICENSE)
