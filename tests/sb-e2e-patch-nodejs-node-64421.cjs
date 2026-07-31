'use strict';
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
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pathname}`;
  const r = await fetch(url, {
    headers: {
      'Accept': useDiff ? 'application/vnd.github.v3.diff' : 'application/vnd.github+json',
      'User-Agent': 'standupbot-e2e-runner',
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '(no body)');
    throw new Error(`GitHub GET ${url} failed -> HTTP ${r.status}: ${text.slice(0, 300)}`);
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
