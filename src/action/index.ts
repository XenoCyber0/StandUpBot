import * as core from '@actions/core';
import * as github from '@actions/github';
import { generatePRDescription } from '../core/generate';
import { LLMClient } from '../core/llm';
import { loadConfig } from '../core/config';
import { DEFAULT_MAX_DIFF_TOKENS } from '../core/types';

const MARKER = '<!-- standupbot -->';
const HANDLED_ACTIONS = new Set(['opened', 'synchronize']);
const MAX_DIFF_CHARS = DEFAULT_MAX_DIFF_TOKENS * 4; // ~4 chars/token

function shouldWrite(body: string | null | undefined): boolean {
  if (!body || body.trim() === '') return true; // empty description
  return body.includes(MARKER); // previously bot-generated
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';

    const { context } = github;
    if (context.eventName !== 'pull_request') {
      core.info(`Skipping: event "${context.eventName}" is not pull_request.`);
      return;
    }
    const action = context.payload.action as string | undefined;
    if (action && !HANDLED_ACTIONS.has(action)) {
      core.info(`Skipping: pull_request action "${action}" not in [opened, synchronize].`);
      return;
    }
    const pr = context.payload.pull_request;
    if (!pr) {
      core.warning('No pull_request payload found; nothing to do.');
      return;
    }

    if (!shouldWrite(pr.body)) {
      core.info('PR has a manual description without the standupbot marker; not overwriting.');
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = context.repo;

    // Fetch the diff for this PR.
    const diffResp = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pr.number,
      mediaType: { format: 'diff' },
    });
    let diff = diffResp.data as unknown as string;
    if (diff.length > MAX_DIFF_CHARS) {
      core.info(`Diff is large (${diff.length} chars); capping before summarisation.`);
      diff = diff.slice(0, MAX_DIFF_CHARS);
    }

    const commits = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pr.number,
      per_page: 50,
    });
    const commitSubjects = commits.data.map((c) => c.commit.message.split('\n')[0]);

    const config = await loadConfig(process.env.GITHUB_WORKSPACE ?? process.cwd());

    // Provider-agnostic LLM settings: Action inputs take precedence, with
    // same-named env vars (LLM_*) and .standupbot.yml as fallbacks. Fails
    // fast with a clear ConfigError if base URL / key / model are missing.
    const input = (name: string) => {
      const v = core.getInput(name).trim();
      return v === '' ? undefined : v;
    };
    const llm = LLMClient.fromConfig({
      llm: {
        baseUrl: input('llm-base-url') ?? config.llm?.baseUrl,
        apiKey: input('llm-api-key'), // inputs/env only — never from config
        model: input('model') ?? config.llm?.model,
        providerType: config.llm?.providerType,
      },
    });

    const result = await generatePRDescription(
      diff,
      { repo: `${owner}/${repo}`, branch: pr.head.ref, commits: commitSubjects },
      llm,
      { config },
    );

    const body = `${result.description}\n\n${MARKER}`;
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      title: result.title,
      body,
    });

    if (result.labels.length) {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels: result.labels,
      });
    }

    core.info(`standupbot: wrote description for PR #${pr.number}`);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
