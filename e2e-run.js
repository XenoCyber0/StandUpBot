// E2E driver: runs the REAL action entry (src/action/index.ts via ts-sucrase
// / compiled dist) against REAL GitHub PRs, with a REAL LLM endpoint injected
// only into the child process env. Captures the final PR description (or
// markers of the map-reduce summdry paths) for review.
//
// Usage:
//   $env:LLM_BASE_URL = '...'; $env:LLM_API_KEY = '...'; $env:LLM_MODEL = '...';
//   node e2e-run.js <owner> <repo> <prNumber> [--large]
//
// Never writes the key to disk; never edits package/config.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.error('usage: node e2e-run.js <owner> <repo> <prNumber> [--large]');
  process.exit(2);
}

const [, , owner, repo, prStr, ...flags] = process.argv;
const prNumber = Number(prStr);
if (!owner || !repo || !Number.isFinite(prNumber) || prNumber <= 0) usage();

const wantLarge = flags.includes('--large');

// Verify creds in-process (set by caller's shell before invoking).
const LLM_BASE_URL = process.env.LLM_BASE_URL;
const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL;
if (!LLM_API_KEY || !LLM_BASE_URL || !LLM_MODEL) {
  console.error('LLM_BASE_URL / LLM_API_KEY / LLM_MODEL must be set in your shell env before running this script.');
  console.error('They are only forwarded to the spawned child process env for the test.');
  process.exit(3);
}

// package root (this script lives in the repo root on disk; we run from there)
const root = path.resolve(__dirname);

// =============== action entry (compiled) ===============
const entry = path.join(root, 'dist', 'action', 'index.js');
// entry does not exist in repo root; it lives in dist/action/index.js
const realEntry = fs.existsSync(entry) ? entry : path.join(root, 'dist/action/index.js');
if (!fs.existsSync(realEntry)) {
  console.error(`action entry missing: ${realEntry}. Run pnpm build first.`);
  process.exit(4);
}

// =============== event payload ===============
const payload = {
  action: 'opened',
  pull_request: {
    number: prNumber,
    body: null, // empty -> shouldWrite() true
    head: { ref: 'e2e-head-branch' },
    base: { ref: 'main' },
  },
};
const eventPath = path.join(os.tmpdir(), `e2e-event-${owner}-${repo}-${prNumber}.json`);
fs.writeFileSync(eventPath, JSON.stringify(payload));

// =============== spawn env for child ===============
const childEnv = {
  ...process.env,
  // action inputs (tools read these in preference order)
  INPUT_GITHUB_TOKEN: '',               // unauthenticated: public-read only
  'INPUT_LLM-BASE-URL': LLM_BASE_URL,
  'INPUT_LLM-API-KEY': LLM_API_KEY,
  INPUT_MODEL: LLM_MODEL,
  // github context the action expects
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_EVENT_PATH: eventPath,
  GITHUB_REPOSITORY: `${owner}/${repo}`,
  GITHUB_WORKSPACE: process.cwd(),
  GITHUB_API_URL: 'https://api.github.com',
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: 'e2e-deadbeef',
  GITHUB_REF: 'refs/heads/e2e-head-branch',
  // Action prints to stdout via core.info / core.info, so we don't need to
  // suppress anything. Force pretty logging.
  ACTIONS_RUNTIME_TOKEN: 'e2e',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'e2e',
};

console.log('=== E2E RUN ===');
console.log(`PR: ${owner}/${repo}#${prNumber}`);
console.log(`large-max mode: ${wantLarge}`);
console.log('spawning real action entry:', realEntry);

const child = spawnSync('node', [realEntry], {
  env: childEnv,
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

console.log('--- action stdout ---');
console.log(child.stdout);
console.log('--- action stderr ---');
console.log(child.stderr);
console.log('--- exit code ---');
console.log(child.status);
console.log('--- signal ---', child.signal);
console.log('=== END E2E RUN ===');

if (child.status !== 0) process.exit(child.status || 1);
