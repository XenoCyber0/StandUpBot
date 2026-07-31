import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDiffPayload,
  estimateTokens,
  globToRegExp,
  matchesAny,
  parseDiff,
} from '../src/core/diff';

const fixture = (name: string) => readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseDiff', () => {
  const files = parseDiff(fixture('sample.diff'));

  it('splits a multi-file diff into one entry per file', () => {
    expect(files).toHaveLength(4);
    expect(files.map((f) => f.path)).toEqual([
      'src/index.ts',
      'src/greet.ts',
      'src/util/new.ts',
      'deleted.ts',
    ]);
  });

  it('counts additions/deletions per file (ignoring +++/--- headers)', () => {
    const index = files[0];
    expect(index.additions).toBe(2);
    expect(index.deletions).toBe(0);

    const deleted = files[3];
    expect(deleted.additions).toBe(0);
    expect(deleted.deletions).toBe(2);
  });

  it('detects new, deleted and renamed files', () => {
    expect(files[1].isNew).toBe(true);
    expect(files[3].isDeleted).toBe(true);
    expect(files[2].isRename).toBe(true);
    expect(files[2].oldPath).toBe('src/util/old.ts');
  });

  it('estimates token counts as chars/4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('glob matching', () => {
  it('matches exact, star, and doublestar patterns', () => {
    expect(matchesAny('pnpm-lock.yaml', ['pnpm-lock.yaml'])).toBe(true);
    expect(matchesAny('src/app.min.js', ['**/*.min.js'])).toBe(true);
    expect(matchesAny('a/b/c.lock', ['**/*.lock'])).toBe(true);
    expect(matchesAny('dist/app.js', ['dist/**'])).toBe(true);
    // A slash makes a pattern gitignore-anchored; use **/dist/** for any depth.
    expect(matchesAny('src/dist/app.js', ['dist/**'])).toBe(false);
    expect(matchesAny('src/dist/app.js', ['**/dist/**'])).toBe(true);
    expect(matchesAny('src/index.ts', ['**/*.min.js'])).toBe(false);
  });

  it('matches basename patterns at any depth', () => {
    expect(matchesAny('deep/nested/package-lock.json', ['package-lock.json'])).toBe(true);
  });

  it('globToRegExp never matches on an empty pattern', () => {
    expect(globToRegExp('').test('anything')).toBe(false);
  });
});

describe('buildDiffPayload', () => {
  it('returns full diff when under budget', () => {
    const diff = fixture('sample.diff');
    const payload = buildDiffPayload(diff, 10000, []);
    expect(payload).toContain('export function greet()');
    expect(payload).not.toContain('Excluded from diff');
  });

  it('excludes lockfiles/generated files into a stats footer', () => {
    const diff = fixture('sample.diff');
    const payload = buildDiffPayload(diff, 10000, ['src/greet.ts']);
    expect(payload).not.toContain("console.log('hello')");
    expect(payload).toContain('# Excluded from diff');
    expect(payload).toContain('src/greet.ts');
  });

  it('collapses the largest files to stat lines when over budget (never mid-body)', () => {
    const diff = fixture('sample.diff');
    // Tiny budget forces collapsing of the biggest files.
    const payload = buildDiffPayload(diff, 40, []);
    // The smallest file (deleted.ts) may survive intact.
    expect(payload).toContain('deleted.ts');
    // Collapsed entries appear as "FILE:" stat lines.
    expect(payload).toMatch(/FILE: .+ — \d+ additions, \d+ deletions/);
    // A collapsed file's code body must NOT be partially present.
    expect(payload).not.toContain('export function util()');
  });

  it('handles an empty diff', () => {
    expect(buildDiffPayload('', 100, [])).toBe('');
    expect(parseDiff('')).toEqual([]);
  });
});
