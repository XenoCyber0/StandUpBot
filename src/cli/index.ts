#!/usr/bin/env node
import { Command } from 'commander';
import { generatePRDescription } from '../core/generate';
import { LLMClient } from '../core/llm';
import { loadConfig } from '../core/config';
import { StandupbotError } from '../core/errors';
import type { StandupbotConfig } from '../core/types';
import { applyToPr, getBranchDiff, getPrNumber, getRepoInfo } from './git';

const MARKER = '<!-- standupbot -->';

interface PrDescriptionOptions {
  base?: string;
  write?: boolean;
  tone?: string;
  repo?: string;
}

function renderMarkdown(result: { title: string; description: string; labels: string[] }): string {
  const labels = result.labels.length ? result.labels.join('`, `') : '';
  return [
    `# ${result.title}`,
    '',
    result.description,
    '',
    result.labels.length ? `**Labels:** \`${labels}\`` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

async function runPrDescription(opts: PrDescriptionOptions): Promise<void> {
  const cwd = process.cwd();
  const cfg: StandupbotConfig = await loadConfig(cwd);
  if (opts.tone) cfg.tone = opts.tone;

  const info = await getRepoInfo(cwd);
  const { diff, commits, base } = await getBranchDiff(info, opts.base);
  if (!diff.trim()) {
    throw new StandupbotError(
      `No changes found vs ${base}. Are you on a branch with commits ahead of it?`,
    );
  }

  const llm = LLMClient.fromConfig({ llm: cfg.llm });
  const context = {
    repo: opts.repo ?? info.repo,
    branch: info.branch,
    commits,
  };
  const result = await generatePRDescription(diff, context, llm, { config: cfg });

  process.stdout.write(renderMarkdown(result) + '\n');

  if (opts.write) {
    const prNumber = await getPrNumber(info.branch, cwd);
    if (!prNumber) {
      throw new StandupbotError(
        `No open PR found for branch "${info.branch}". Create one first (gh pr create) before using --write.`,
      );
    }
    const body = `${result.description}\n\n${MARKER}`;
    await applyToPr({ ...result, description: body }, cwd, info.branch);
    process.stderr.write(`\nstandupbot: updated PR #${prNumber}\n`);
  }
}

function main(): void {
  const program = new Command();
  program
    .name('standupbot')
    .description('Generate PR descriptions and changelog entries from git diffs via an LLM.')
    .version('1.0.0');

  program
    .command('pr-description')
    .description('Generate a PR title, description and labels from the current branch diff.')
    .option('--base <ref>', 'git ref to diff against (default: origin/<default-branch>)')
    .option('--repo <owner/repo>', 'override repo slug used in the prompt context')
    .option('--tone <tone>', 'override prompt tone (e.g. concise, detailed)')
    .option('-w, --write', 'fill the current branch PR via `gh pr edit`')
    .action(async (opts: PrDescriptionOptions) => {
      try {
        await runPrDescription(opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`standupbot: error: ${msg}\n`);
        process.exitCode = 1;
      }
    });

  program.parseAsync(process.argv).catch(() => {
    process.exitCode = 1;
  });
}

main();
