# StandupBot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-StandupBot-purple?logo=github)](https://github.com/marketplace/actions/standupbot)
[![Open Source Love](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red)](https://github.com/XenoCyber0/StandUpBot)

A GitHub Action that writes your PR descriptions for you. It runs the real diff and commits through an LLM you choose, and fills in a structured **Summary / Changes / Testing** description plus up to three labels — so you stop hand-writing PR bodies and standup updates.

Bring your own model: it talks to **any OpenAI-compatible endpoint** (OpenAI, OpenRouter, Ollama, LM Studio, …). No provider, URL, or model is hardcoded.

---

## Sample output

Generated end-to-end by StandupBot for a real PR ([nodejs/node#64573](https://github.com/nodejs/node/pull/64573)) from its actual diff, using a real LLM endpoint. This is the description it produced verbatim:

> ## Summary
>
> Add `lchownSync` to the VFS implementation so that symbolic link ownership can be changed without following the link, matching the behavior of `fs.lchownSync`.
>
> ## Changes
>
> - doc/api/vfs.md: added `lchownSync(path, uid, gid)` to the list of VFS API signatures.
> - lib/internal/vfs/file_system.js: added synchronous `lchownSync` method to `VirtualFileSystem` and updated the async wrapper to call `provider.lchownSync`.
> - lib/internal/vfs/provider.js: added default `lchownSync` method to `VirtualProvider` (delegates to `chownSync`) with JSDoc comment.
> - lib/internal/vfs/providers/memory.js: implemented `lchownSync` that updates the uid/gid of the link entry itself.
> - lib/internal/vfs/setup.js: changed the `lchownSync` handler to invoke `vfs.lchownSync` instead of `vfs.chownSync`.
> - test/parallel/test-vfs-lchown-symlink.js: new test verifying sync, callback, and promise variants of `lchownSync` on VFS-mounted symlinks.
>
> ## Testing
>
> The new test exercises `fs.lchownSync`, `fs.lchown` (callback), and `fsp.lchown` (promise) on symlinks inside a VFS mount, asserting correct uid/gid changes.

Alongside the body it also returns a normalized `title` and `labels` (clamped to `bug | feature | chore | docs | refactor`).

---

## Use it in your repo

Add `.github/workflows/standupbot.yml`:

```yaml
name: StandupBot
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  describe:
    runs-on: ubuntu-latest
    steps:
      - uses: XenoCyber0/StandUpBot@main
        with:
          llm-base-url: ${{ secrets.LLM_BASE_URL }}
          llm-api-key: ${{ secrets.LLM_API_KEY }}
          model: ${{ vars.LLM_MODEL }}
```

Set `LLM_API_KEY` (and `LLM_BASE_URL`) as repo **secrets**; `LLM_MODEL` can be a repo variable.

It only writes when the PR description is empty (or already carries the StandupBot marker) — it never clobbers a hand-written description.

### Inputs

All optional in YAML; each overrides its env var, which in turn overrides `.standupbot.yml`. A run needs a base URL, a key, and a model from _somewhere_ or it fails fast.

| Input          | Env var        | Notes                                             |
| -------------- | -------------- | ------------------------------------------------- |
| `llm-base-url` | `LLM_BASE_URL` | e.g. `https://api.openai.com/v1`, OpenRouter, …   |
| `llm-api-key`  | `LLM_API_KEY`  | secret — env/input **only**, never in config      |
| `model`        | `LLM_MODEL`    | no default — must be provided                     |
| `github-token` | `GITHUB_TOKEN` | defaults to the workflow's `${{ github.token }}`  |

> Input names map to the UPPER_SNAKE `INPUT_*` / `LLM_*` env vars (`llm-base-url` → `INPUT_LLM_BASE_URL`, `model` → `INPUT_MODEL`). The Action then falls back to `LLM_BASE_URL` / `LLM_MODEL` / `.standupbot.yml`.

---

## Configuration (`.standupbot.yml`, optional)

Place at the repo root. Env vars override it.

```yaml
tone: concise        # free-form tone steer
maxDiffTokens: 6000  # diff budget before per-file summarisation kicks in
exclude:             # gitignore-style globs kept out of the prompt
  - package-lock.json
  - '**/*.lock'
  - '**/dist/**'
llm:                 # non-secret connection details (apiKey is rejected here)
  baseUrl: https://openrouter.ai/api/v1
  model: anthropic/claude-3.5-sonnet
```

See [`.standupbot.example.yml`](./.standupbot.example.yml).

---

## Known limitations

- **"Testing" claims can be inferred, not evidenced.** The model sometimes writes a Testing section that reads as if code was built/run when it wasn't (e.g. a doc-only change claiming it "builds and renders correctly"). Verification statements in summaries are not guaranteed — treat them as a draft. Known issue — prompt tightening planned.
- **Diffs larger than `maxDiffTokens` (default 6000 tokens ≈ 24KB) fall back to a map-reduce summarisation path** (per-file summaries, capped at 8 LLM calls) instead of embedding the full diff. Works, but not yet load-tested.
- The fetched diff itself is hard-capped at `maxDiffTokens × 4` characters (≈24KB by default) before summarising, so the tail of an enormous PR may not influence the output.
- GitHub PR reads are unauthenticated (~60 req/hr) unless you pass a `github-token`.

---

## License

[MIT](./LICENSE)
