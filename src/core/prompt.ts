import type { GenerateContext, StandupbotConfig } from './types';
import { ALLOWED_LABELS } from './types';

export interface ChatMessageInput {
  role: 'system' | 'user';
  content: string;
}

export const SYSTEM_PROMPT = `You are StandupBot, an assistant that writes excellent pull-request descriptions for senior engineers.

Given a code diff and the commit messages, produce a PR description that is accurate, specific, and skim-friendly. Ground every claim in the actual diff — do not invent behaviour. Prefer concrete file/function names over vague statements.

Respond with ONLY a single JSON object (no markdown fence, no prose) with exactly these keys:
{
  "title": string,                 // <= 72 chars, imperative mood ("Add X", "Fix Y"), no trailing period
  "description": string,           // GitHub-flavoured markdown with EXACTLY these sections, in this order:
                                   //   ## Summary            (1-3 sentences: what & why)
                                   //   ## Changes            (bulleted list of concrete changes, grouped by area)
                                   //   ## Testing            (how this was / should be tested)
  "labels": string[]               // 1-3 items, each chosen ONLY from: ${ALLOWED_LABELS.join(', ')}
}`;

/** Render the commit list block (or an empty string when there are none). */
export function formatCommits(commits: string[]): string {
  if (!commits || commits.length === 0) return '';
  const items = commits.map((c) => `- ${c}`).join('\n');
  return `COMMITS:\n${items}`;
}

/** One-line context header describing where this change lives. */
export function formatContext(context: GenerateContext): string {
  return `REPO: ${context.repo}\nBRANCH: ${context.branch}`;
}

/**
 * Build the user prompt. Pure & exported for testing.
 *
 * @param diffPayload  The (possibly summarised) diff body.
 * @param context      Repo/branch/commits grounding.
 * @param config       Tone + label steering.
 * @param truncated    True when the payload was reduced; tells the model to
 *                     rely on stat lines for collapsed files.
 */
export function buildUserPrompt(
  diffPayload: string,
  context: GenerateContext,
  config: StandupbotConfig = {},
  truncated = false,
): string {
  const tone = config.tone?.trim() ? config.tone.trim() : 'concise';

  const parts: string[] = [
    'Write the pull-request description for the following change.',
    '',
    formatContext(context),
  ];

  const commitsBlock = formatCommits(context.commits);
  if (commitsBlock) parts.push('', commitsBlock);

  if (truncated) {
    parts.push(
      '',
      'NOTE: Some large files are shown as one-line stats ("FILE: path — N additions, M deletions") instead of full diffs. Use those stats to understand scope, but base specifics on the full diffs that are present.',
    );
  }

  parts.push(
    '',
    `TONE: ${tone}`,
    `LABELS: choose 1-3, only from this list: ${ALLOWED_LABELS.join(', ')}`,
    '',
    'DIFF:',
    diffPayload.trim() || '(no diff provided)',
  );

  return parts.join('\n');
}

/** Assemble the full message list for the chat completion. */
export function buildMessages(
  diffPayload: string,
  context: GenerateContext,
  config: StandupbotConfig = {},
  truncated = false,
): ChatMessageInput[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(diffPayload, context, config, truncated) },
  ];
}
