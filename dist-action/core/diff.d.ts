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
export declare const CHARS_PER_TOKEN = 4;
export declare function estimateTokens(text: string): number;
/** Split a unified diff into per-file entries. */
export declare function parseDiff(diff: string): DiffFile[];
/**
 * Convert a gitignore-style glob to RegExp. Supports `*`, `**`, `?`,
 * leading `/`, and trailing `/` (directory prefix).
 */
export declare function globToRegExp(pattern: string): RegExp;
export declare function matchesAny(path: string, patterns: string[]): boolean;
/**
 * Build the diff payload sent to the LLM, honouring a token budget.
 *
 * Small files always keep their full diff. Once the budget is exceeded, the
 * largest remaining files are collapsed to stat lines so the model still sees
 * every change but at lower fidelity — never truncated mid-body.
 */
export declare function buildDiffPayload(diff: string, maxTokens: number, exclude?: string[]): string;
