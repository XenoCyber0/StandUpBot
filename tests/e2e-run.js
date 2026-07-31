// E2E harness: runs the action's *real* compiled entry (dist/action/index.js)
// against real public GitHub PRs, with read API calls hitting api.github.com
// via native fetch, and the LLM endpoint being the one you set in the shell
// env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). The octokit instance is fully
// fabricated *inside the child preload* (unauthenticated remote reads, captured
// writes). The action IS run against its real compiled entry.
//
// Usage (PowerShell):
//   $env:LLM_BASE_URL='https://openrouter.ai/api/v1'
//   $env:LLM_API_KEY='sk-or-...'
//   $env:LLM_MODEL='nvidia/nemotron-3-super-120b-a12b:free'
//   node tests/e2e-run.js nodejs node 64421
//
// Never writes the key to disk or config; keys only passed via child process env.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [, , owner, repo, prStr] = process.argv;
const pr = Number(prStr);
if (!owner || !repo || !Number.isFinite(pr) || pr <= 0) {
  console.error('usage: node tests/e2e-run.js <owner> <repo> <prNumber>');
  process.exit(2);
}
for (const req of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
  if (!process.env[req]) {
    console.error(`missing required env var: ${req} (set in shell, NOT in config)`);
    process.exit(3);
  }
}

const root = path.resolve(__dirname, '..');
const entryJs = path.join(root, 'dist', 'action', 'index.js');
if (!fs.existsSync(entryJs)) throw new Error(`action entry missing: ${entryJs}. Run pnpm build first.`);

const payload = {
  action: 'opened',
  pull_request: {
    number: pr,
    body: null,
    head: { ref: 'e2e-test-branch' },
    base: { ref: 'main' },
  },
};
const eventPath = path.join(os.tmpdir(), `sb-e2e-event-${owner}-${repo}-${pr}.json`);
fs.writeFileSync(eventPath, JSON.stringify(payload));

console.log('=== SB E2E: real action vs real GitHub PR ===');
console.log(`PR: ${owner}/${repo}#${pr}   LLM=${process.env.LLM_MODEL}@${process.env.LLM_BASE_URL}`);

// Fabricated octokit that performs real unauthenticated HTTP GETs against
// api.github.com and captures the two POST calls (pulls.update, issues.addLabels).
const childEnv = {
  ...process.env,
  INPUT_GITHUB_TOKEN: 'e2e-faker-token-0000000',
  // actions/core getInput normalizes name to INPUT_<UPPER_UNDERSCORE>
  INPUT_LLM_BASE_URL: process.env.LLM_BASE_URL,
  INPUT_LLM_API_KEY: process.env.LLM_API_KEY,
  INPUT_MODEL: process.env.LLM_MODEL,
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_EVENT_PATH: eventPath,
  GITHUB_REPOSITORY: `${owner}/${repo}`,
  GITHUB_WORKSPACE: process.cwd(),
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: '0000000000000000000000000000000000000000',
  GITHUB_REF: 'refs/heads/e2e-test-branch',
};
childEnv.SB_E2E_OUT_PATH = path.join(os.tmpdir(), `sb-e2e-out-${owner}-${repo}-${pr}.md`);

// Instrument the child process with fetch logging so we can surface real
// HTTP statuses/bodies when the action's LLM call fails (action swallows
// the details into ::error:: strings).

// Preload: run BEFORE action entry; swaps in a fully fabricated octokit with
// real HTTP GETs + captured mutations.
const patchPath = path.join(root, 'tests', `sb-e2e-patch-${owner}-${repo}-${pr}.cjs`);
fs.writeFileSync(
  patchPath,
  `'use strict';
const fs = require('fs');
const path = require('path');

// --- Debug instrumentation: log every outbound fetch the action makes ---
const origFetch = globalThis.fetch;
globalThis.fetch = async function(url, opts) {
  const u = String(url);
  const m = url.includes('/chat/completions') ? 'LLM' : 'GH';
  console.log('E2E:FETCH ' + m + ' ' + u);
  try {
    const r = await origFetch.apply(this, arguments);
    console.log('E2E:FETCH-RESP ' + m + ' HTTP ' + r.status + ' ' + r.statusText);
    if (!r.ok && r.text) {
      const clone = r.clone();
      const b = await clone.text().catch(() => '(no text)');
      if (b.length < 4000) console.log('E2E:FETCH-RESP-BODY ' + m + ' ' + b.slice(0, 400));
    }
    return r;
  } catch (e) {
    console.log('E2E:FETCH-ERROR ' + m + ' ' + (e && e.message ? e.message : String(e)));
    throw e;
  }
};

function captureBody(marker, body) {
  // only capture the PR description from pulls.update (not the addLabels payload)
  if (marker === 'pulls.update') fs.writeFileSync(process.env.SB_E2E_OUT_PATH, body);
}

async function ghGet(pathname, owner, repo, useDiff = false) {
  const url = \`https://api.github.com/repos/\${owner}/\${repo}/pulls/\${pathname}\`;
  const r = await fetch(url, {
    headers: {
      'Accept': useDiff ? 'application/vnd.github.v3.diff' : 'application/vnd.github+json',
      'User-Agent': 'standupbot-e2e-runner',
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '(no body)');
    throw new Error(\`GitHub GET \${url} failed -> HTTP \${r.status}: \${text.slice(0, 300)}\`);
  }
  return r;
}

// Wrapping synchronously at require-time via IIFE; entry calls the patched
// github.getOctokit() synchronously after require, but only AWAITS payload
// operations at git call time inside async run(), so we can synchronously
// return a Proxy octokit whose path resolves to our fetch() functions.
const ghPath = path.join(__dirname, '..', 'node_modules', '@actions', 'github');
const gh = require('@actions/github');
const orig = gh.getOctokit;

gh.getOctokit = function(token) {
  const octo = {
    rest: {
      pulls: {
        get: async function(args) {
          // pulls.get with diff format: fetch text via content-negotiation
          const r = await ghGet(String(args.pull_number), args.owner, args.repo, true);
          return { data: await r.text() };
        },
        listCommits: async function(args) {
          const r = await ghGet(String(args.pull_number) + '/commits', args.owner, args.repo, false);
          return { data: await r.json() };
        },
        update: async function(args) {
          captureBody('pulls.update', args.body);
          return { data: {} };
        },
      },
      issues: {
        addLabels: async function(args) {
          // do NOT overwrite the captured PR description
          return { data: {} };
        },
      },
    },
    request: async function(route, args) {
      return { data: {} };
    },
  };
  return octo;
};
`,
);
childEnv.NODE_OPTIONS = `--require ${patchPath}`;

console.log('spawning action entry...');
const run = spawnSync(process.execPath, [entryJs], {
  env: childEnv,
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120_000,
});

console.log('--- action stdout ---');
process.stdout.write(run.stdout || '(silent)\n');
console.log('--- action stderr ---');
process.stdout.write(run.stderr || '(silent)\n');
if (run.error) { console.error('spawn error:', run.error); process.exit(1); }
if (run.signal) { console.error('signal:', run.signal); process.exit(1); }
if (run.status !== 0) { console.error('exited', run.status); process.exit(run.status ?? 1); }

console.log('=== action exited cleanly ===');
const outStr = fs.existsSync(childEnv.SB_E2E_OUT_PATH) ? fs.readFileSync(childEnv.SB_E2E_OUT_PATH, 'utf8') : '';
if (outStr) {
  console.log('\n=== GENERATED PR DESCRIPTION (verbatim, as would be posted) ===\n');
  console.log(outStr);
} else {
  console.log('\n(no captured PR body — action returned before write)');
}
process.exit(0);
