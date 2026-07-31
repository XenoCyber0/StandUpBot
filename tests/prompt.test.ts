import { describe, expect, it } from 'vitest';
import { buildMessages, buildUserPrompt, formatCommits, SYSTEM_PROMPT } from '../src/core/prompt';

const context = {
  repo: 'acme/widgets',
  branch: 'feat/login',
  commits: ['add login form', 'wire up auth'],
};

describe('buildUserPrompt', () => {
  it('includes repo, branch, commits, tone, labels list and the diff', () => {
    const p = buildUserPrompt('DIFF HERE', context, { tone: 'detailed' });
    expect(p).toContain('REPO: acme/widgets');
    expect(p).toContain('BRANCH: feat/login');
    expect(p).toContain('- add login form');
    expect(p).toContain('TONE: detailed');
    expect(p).toContain('bug, feature, chore, docs, refactor');
    expect(p).toContain('DIFF:\nDIFF HERE');
  });

  it('omits the commits section when there are none', () => {
    const p = buildUserPrompt('X', { ...context, commits: [] });
    expect(p).not.toContain('COMMITS:');
  });

  it('adds a truncation note only when truncated', () => {
    expect(buildUserPrompt('X', context, {}, true)).toContain('one-line stats');
    expect(buildUserPrompt('X', context, {}, false)).not.toContain('one-line stats');
  });

  it('falls back to "concise" tone when none is set', () => {
    expect(buildUserPrompt('X', context, {})).toContain('TONE: concise');
  });
});

describe('formatCommits', () => {
  it('renders a bullet list', () => {
    expect(formatCommits(['a', 'b'])).toBe('COMMITS:\n- a\n- b');
  });
  it('returns empty string for no commits', () => {
    expect(formatCommits([])).toBe('');
  });
});

describe('buildMessages / SYSTEM_PROMPT', () => {
  it('builds [system, user] messages', () => {
    const msgs = buildMessages('X', context, { tone: 'concise' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    expect(msgs[1].role).toBe('user');
  });

  it('system prompt enforces JSON output with required keys', () => {
    expect(SYSTEM_PROMPT).toContain('"title"');
    expect(SYSTEM_PROMPT).toContain('"description"');
    expect(SYSTEM_PROMPT).toContain('"labels"');
    expect(SYSTEM_PROMPT).toContain('## Summary');
    expect(SYSTEM_PROMPT).toContain('## Changes');
    expect(SYSTEM_PROMPT).toContain('## Testing');
  });
});
