import { buildDiffPayload, estimateTokens, matchesAny, parseDiff } from './diff';
import { ParseError } from './errors';
import type { LLMClient } from './llm';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';
import type { GenerateContext, PRDescription, StandupbotConfig } from './types';
import { ALLOWED_LABELS, DEFAULT_MAX_DIFF_TOKENS } from './types';

/** Extra instruction appended when we force JSON mode on the final call. */
const JSON_MODE_HINT =
  '\n\nRemember: respond with ONLY the JSON object described in the system prompt.';

const SUMMARIZE_SYSTEM = `You are a senior engineer summarising a chunk of a larger code diff. Capture the concrete intent of the changes (files, functions, behaviour) in a few dense sentences. Do not editorialize.`;

/** Extract the first balanced JSON object from a string. */
function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) throw new ParseError('LLM response did not contain a JSON object');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
    } else if (c === '\\') {
      escaped = true;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch (e) {
            throw new ParseError(
              `Could not parse JSON from LLM response: ${(e as Error).message}. Snippet: ${candidate.slice(0, 160)}`,
            );
          }
        }
      }
    }
  }
  throw new ParseError('LLM response JSON was truncated (unbalanced braces)');
}

function clampLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const allowed = new Set<string>(ALLOWED_LABELS);
  const out: string[] = [];
  for (const l of labels) {
    if (typeof l === 'string') {
      const norm = l.trim().toLowerCase();
      if (allowed.has(norm) && !out.includes(norm)) out.push(norm);
    }
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim()) return 'Update pull request';
  let t = title.trim().split('\n')[0].trim();
  t = t.replace(/[.!\s]+$/, '');
  if (t.length > 72) t = t.slice(0, 72).replace(/[.!\s]+$/, '');
  return t;
}

function normalizeDescription(description: unknown): string {
  if (typeof description !== 'string' || !description.trim()) {
    return '## Summary\n\n_No summary generated._\n\n## Changes\n\n- (see diff)\n\n## Testing\n\n- Not provided';
  }
  return description.trim();
}

/** Parse + validate raw LLM text into a typed PRDescription. */
export function parseModelOutput(raw: string): PRDescription {
  const parsed = extractJson(raw);
  if (parsed === null || typeof parsed !== 'object') {
    throw new ParseError('LLM JSON was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  return {
    title: normalizeTitle(obj.title),
    description: normalizeDescription(obj.description),
    labels: clampLabels(obj.labels),
  };
}

/**
 * Hierarchically reduce a diff that exceeds the token budget.
 *
 * Strategy (map-reduce):
 * 1. Collapse excluded + oversized files to one-line stats (never truncates
 *    mid-body) via buildDiffPayload.
 * 2. If still over budget, ask the LLM to summarise per-file chunks, then
 *    combine into a compact summary fed to the final prompt.
 */
/**
 * Reduce a diff to a payload that fits the budget, combining structural
 * collapse (stat lines) with per-file LLM summarisation for large files.
 *
 * Returns the payload plus the number of LLM summary calls made.
 */
async function summarizeDiff(
  llm: LLMClient,
  diff: string,
  maxTokens: number,
  exclude: string[],
): Promise<{ payload: string; llmCalls: number }> {
  const excludedSet = new Set(
    parseDiff(diff)
      .filter((f) => exclude.length > 0 && matchesAny(f.path, exclude))
      .map((f) => f.path),
  );
  const files = parseDiff(diff).filter((f) => !excludedSet.has(f.path));

  // Keep full bodies for small files while we have budget; summarise big
  // ones; emit stat lines for whatever we can't afford.
  const payloadParts: string[] = [];
  const stats: string[] = [];
  let used = 0;
  let llmCalls = 0;
  const summaryBudget = Math.max(200, Math.floor(maxTokens / 2));

  // Small files first so they survive whole.
  for (const f of [...files].sort((a, b) => a.tokens - b.tokens)) {
    if (!f.isBinary && used + f.tokens <= maxTokens) {
      payloadParts.push(f.body);
      used += f.tokens;
    } else if (!f.isBinary && f.tokens <= summaryBudget * 4 && llmCalls < 8) {
      const summary = await llm.chat([
        { role: 'system', content: SUMMARIZE_SYSTEM },
        { role: 'user', content: `Summarise what changed in this file diff:\n\n${f.body}` },
      ]);
      llmCalls++;
      payloadParts.push(`FILE: ${f.path} — summary: ${summary.trim()}`);
      used += estimateTokens(summary);
    } else {
      stats.push(`FILE: ${f.path} — ${f.additions} additions, ${f.deletions} deletions`);
    }
  }

  let payload = payloadParts.join('\n\n');
  if (stats.length || excludedSet.size) {
    const excluded = [...excludedSet].map((p) => `FILE: ${p} — (excluded)`);
    payload += `\n\n# Files not shown in full:\n${[...excluded, ...stats].join('\n')}`;
  }
  return { payload: payload.trim(), llmCalls };
}

export interface GenerateOptions {
  config?: StandupbotConfig;
}

/**
 * Generate a PR description from a unified diff.
 */
export async function generatePRDescription(
  diff: string,
  context: GenerateContext,
  llm: LLMClient,
  options: GenerateOptions = {},
): Promise<PRDescription> {
  const config = options.config ?? {};
  const maxTokens = config.maxDiffTokens ?? DEFAULT_MAX_DIFF_TOKENS;
  const exclude = config.exclude ?? [];

  const overBudget = estimateTokens(diff) > maxTokens;
  let payload: string;
  let truncated: boolean;
  if (overBudget) {
    const summary = await summarizeDiff(llm, diff, maxTokens, exclude);
    payload = summary.payload;
    truncated = summary.llmCalls > 0;
  } else {
    payload = buildDiffPayload(diff, maxTokens, exclude);
    truncated = false;
  }

  const user = buildUserPrompt(payload, context, config, truncated) + JSON_MODE_HINT;
  const raw = await llm.chat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]);
  return parseModelOutput(raw);
}
