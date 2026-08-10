# I Built a GitHub Action That Writes PR Descriptions From Real Diffs (Works With Ollama)

Yep, this does what the title says. StandupBot reads the actual PR diff and commit messages, runs them through any OpenAI-compatible LLM endpoint, and writes a structured Summary / Changes / Testing description — so you never have to write "fixed stuff" again.

I built this for my own team because I was tired of staring at empty PR boxes after every fix. Then I put it on GitHub Marketplace so anyone can use it. MIT licensed, no strings.

{% github XenoCyber0/StandUpBot %}

---

## The Problem

You open a PR. Forty files changed. Two hours of focused work. The description field is empty.

So you write: `fixed stuff`. Or `updated code`. Or `changes requested by reviewer`.

Three months later, someone (you) is running `git log -p` trying to figure out why the config format changed in April. The PR description was supposed to save that investigation. Nobody wrote it.

We tried before:

| Approach | Why it failed |
|----------|---------------|
| PR templates | Everyone types "see title" into the template |
| Checklist bots | Nagging doesn't scale; people ignore them |
| Reviewer enforcement | Becomes the team's most hated job |

The gap isn't discipline. It's that writing PR descriptions is **unrewarded work**. You get the same merge button whether you write a detailed description or "fixed stuff."

So I built [StandupBot](https://github.com/marketplace/actions/standupbot-pr-describer).

---

## What It Produces (Real Example, No Cherry-Picking)

This is verbatim output from [nodejs/node#64573](https://github.com/nodejs/node/pull/64573), generated from the actual diff:

> ## Summary
>
> Add `lchownSync` to the VFS implementation so that symbolic link ownership can be changed without following the link, matching the behavior of `fs.lchownSync`.
>
> ## Changes
>
> - doc/api/vfs.md: added `lchownSync(path, uid, gid)` to VFS API signatures.
> - lib/internal/vfs/file_system.js: added synchronous `lchownSync` method and updated the async wrapper.
> - lib/internal/vfs/provider.js: added default `lchownSync` method with JSDoc comment.
> - lib/internal/vfs/providers/memory.js: implemented `lchownSync` that updates uid/gid of the link entry.
> - lib/internal/vfs/setup.js: changed handler to invoke `vfs.lchownSync` instead of `vfs.chownSync`.
> - test/parallel/test-vfs-lchown-symlink.js: new test verifying sync, callback, and promise variants.
>
> ## Testing
>
> The new test exercises `fs.lchownSync`, `fs.lchown` (callback), and `fsp.lchown` (promise) on symlinks inside a VFS mount, asserting correct uid/gid changes.

Nobody edited that. It went straight from the model into the PR body. The action also returns a normalized `title` and `labels` clamped to `bug | feature | chore | docs | refactor` — so your label taxonomy stays clean.

---

## 30-Second Setup

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
      - uses: XenoCyber0/StandUpBot@v1
        with:
          llm-base-url: ${{ secrets.LLM_BASE_URL }}
          llm-api-key: ${{ secrets.LLM_API_KEY }}
          model: ${{ vars.LLM_MODEL }}
```

Set `LLM_API_KEY` as a **secret**, `LLM_MODEL` as a **variable**. That's the whole thing.

---

## BYO Endpoint: No Vendor Lock-In

The action talks to **any** OpenAI-compatible chat API. Nothing is hardcoded. All of these work:

```
OpenAI        → https://api.openai.com/v1
OpenRouter    → https://openrouter.ai/api/v1
Ollama        → http://localhost:11434/v1
LM Studio     → http://localhost:1234/v1
LocalAI       → http://localai:8080/v1
You decide.
```

You pick the model. You control the data path. Switching providers later is one secret update.

---

## The Self-Hosted Setup (My Favorite Part)

If you want your code to never leave your network:

```
GitHub repo ──webhook──▶ self-hosted Actions runner ──HTTP──▶ Ollama
                             (on your LAN)              (your LLM box)
```

1. Run a self-hosted Actions runner on the same LAN as your LLM box
2. Point `llm-base-url` at your Ollama/LM Studio instance
3. The `llm-api-key` can be any non-empty string — Ollama ignores it

Your diff never crosses the internet. The only outbound call is writing the PR body back to GitHub, which... GitHub already owns.

**Model notes:** In my testing, **Qwen2.5-Coder 7B** and similar 7–9B instruction-tuned models work well. Below ~3B params, file-name hallucinations start appearing.

---

## It Never Overwrites You

The rule is simple:

- **PR body empty** → StandupBot writes it
- **PR body has StandupBot's marker** → updates its own output
- **PR body has anything else** → does absolutely nothing

Your hand-written descriptions are safe. If you ever overwrite what it generated, it takes the hint and stays out.

---

## How It Works Internally

Three parts worth stealing:

**1. Diff budget.** Fetches the PR diff, applies gitignore-style exclusions from `.standupbot.yml` before anything hits a prompt:

```yaml
exclude:
  - package-lock.json
  - '**/*.lock'
  - '**/dist/**'
```

The diff is hard-capped at ~24KB — a monster PR can't blow up your LLM context window.

**2. Map-reduce for big diffs.** Under the budget, one call. Over it? Each file gets summarized individually (max 8 LLM calls), then merged into the final description.

**3. Structured output enforcement.** The prompt requires a rigid schema — `title`, `summary`, `changes[]`, `testing`, `labels[]` — and the parser clamps labels to the allowed set. If the model invents `urgent-pls`, it gets dropped, not shipped.

---

## Honest Limitations

- **Testing section can be inferred, not evidenced.** Sometimes the model writes "built and renders correctly" for a docs-only change because the pattern is tempting. Treat it as a draft. Known issue, prompt tightening planned.
- **Huge PRs lose their tail.** Beyond the character cap, the map-reduce path works on summaries — a detail in file #47 may not survive.
- **GitHub reads are rate-limited** (~60/hr) without a token, but the default workflow token covers this.

---

## What's Next

- Prompt tightening for the testing-overclaim problem
- More testing on genuinely enormous PRs
- Whatever GitHub issues say — the roadmap is user-adaptive because there are currently about four users

---

## Try It

**Marketplace:** [github.com/marketplace/actions/standupbot-pr-describer](https://github.com/marketplace/actions/standupbot-pr-describer)
**Source:** [github.com/XenoCyber0/StandUpBot](https://github.com/XenoCyber0/StandUpBot) (MIT)
**Issues/feedback:** [github.com/XenoCyber0/StandUpBot/issues](https://github.com/XenoCyber0/StandUpBot/issues)

Written by the person who finally read "fixed stuff" one too many times and decided to do something about it.
