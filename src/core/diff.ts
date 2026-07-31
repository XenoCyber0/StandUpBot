/**
 * Unified-diff parsing and budgeting.
 *
 * Budgeting uses a chars->tokens heuristic (chars / 4) so we can decide when
 * a diff needs hierarchical summarisation. Excluded / oversized files are
 * represented as compact stat lines ("150 additions, 2 deletions") instead of
 * being blindly truncated mid-body.
 */

export interface DiffFile {
  /** Current (post-change) path. */
  path: string;
  /** Prior path for renames, when present. */
  oldPath?: string;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  isBinary: boolean;
  additions: number;
  deletions: number;
  /** Approximate token count of this file's diff body. */
  tokens: number;
  /** The raw diff text for this file (headers + hunks). */
  body: string;
}

export interface ParsedDiff {
  files: DiffFile[];
  /** Sum of per-file token estimates. */
  totalTokens: number;
  /** True when one or more large files were collapsed to stat lines. */
  truncated: boolean;
}

export const CHARS_PER_TOKEN = 4;
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+?)\s*$/;

/** Split a unified diff into per-file entries. */
export function parseDiff(diff: string): DiffFile[] {
  if (!diff || !diff.trim()) return [];

  const lines = diff.split('\n');
  const files: DiffFile[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.join('\n');
    files.push(buildFile(body));
    current = null;
  };

  for (const line of lines) {
    if (FILE_HEADER_RE.test(line)) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();
  return files;
}

function buildFile(body: string): DiffFile {
  const lines = body.split('\n');
  const header = lines[0].match(FILE_HEADER_RE);
  let path = header?.[2] ?? 'unknown';
  const oldPath = header?.[1];
  let isNew = false;
  let isDeleted = false;
  let isRename = false;
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let inHunks = false;

  for (const line of lines) {
    if (line.startsWith('rename from ')) {
      isRename = true;
    } else if (line.startsWith('rename to ')) {
      isRename = true;
      path = line.slice('rename to '.length).trim();
    } else if (line.startsWith('new file mode')) {
      isNew = true;
    } else if (line.startsWith('deleted file mode')) {
      isDeleted = true;
    } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      isBinary = true;
    } else if (line.startsWith('@@')) {
      inHunks = true;
    } else if (inHunks) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
  }

  return {
    path,
    oldPath: isRename ? oldPath : undefined,
    isNew,
    isDeleted,
    isRename,
    isBinary,
    additions,
    deletions,
    tokens: estimateTokens(body),
    body,
  };
}

/**
 * Convert a gitignore-style glob to RegExp. Supports `*`, `**`, `?`,
 * leading `/`, and trailing `/` (directory prefix).
 */
export function globToRegExp(pattern: string): RegExp {
  const raw = pattern.trim();
  if (!raw) return /$^/; // never matches
  // gitignore: a pattern is anchored only if it contains a slash (after
  // stripping a leading "/"). Trailing "/" means "everything under this dir".
  const anchored = raw.replace(/^\//, '').includes('/');
  let p = raw.replace(/^\//, '');
  if (p.endsWith('/')) p += '**';

  let out = '';
  if (!anchored) out += '(?:.*/)?'; // match at any depth
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        const followedBySlash = p[i + 2] === '/';
        out += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/** A one-line stat for a file we're not sending in full. */
function statLine(f: DiffFile): string {
  const flags = [
    f.isNew && 'new',
    f.isDeleted && 'deleted',
    f.isRename && `renamed from ${f.oldPath}`,
    f.isBinary && 'binary',
  ].filter(Boolean);
  const flagStr = flags.length ? ` (${flags.join(', ')})` : '';
  return `FILE: ${f.path}${flagStr} — ${f.additions} additions, ${f.deletions} deletions`;
}

/**
 * Build the diff payload sent to the LLM, honouring a token budget.
 *
 * Small files always keep their full diff. Once the budget is exceeded, the
 * largest remaining files are collapsed to stat lines so the model still sees
 * every change but at lower fidelity — never truncated mid-body.
 */
export function buildDiffPayload(diff: string, maxTokens: number, exclude: string[] = []): string {
  const files = parseDiff(diff);
  const included: DiffFile[] = [];
  const excludedStats: string[] = [];

  for (const f of files) {
    if (matchesAny(f.path, exclude)) {
      excludedStats.push(statLine(f));
    } else {
      included.push(f);
    }
  }

  // Order biggest-first so we collapse the largest offenders first.
  const bigFirst = [...included].sort((a, b) => b.tokens - a.tokens);
  const collapsed = new Set<string>();
  let budget = maxTokens;

  for (const f of bigFirst) {
    if (f.tokens <= budget) {
      budget -= f.tokens;
    } else {
      collapsed.add(f.path);
      // Stat lines still cost a few tokens; account for them.
      budget -= estimateTokens(statLine(f));
    }
  }

  const parts: string[] = [];
  for (const f of included) {
    parts.push(collapsed.has(f.path) ? statLine(f) : f.body);
  }

  let out = parts.join('\n\n');
  if (excludedStats.length) {
    out += `\n\n# Excluded from diff (lockfiles/generated):\n${excludedStats.join('\n')}`;
  }
  return out.trim();
}
