export interface RepoInfo {
    cwd: string;
    /** "owner/repo" when derivable from origin, else the folder name. */
    repo: string;
    branch: string;
    defaultBranch: string;
}
export declare function getRepoInfo(cwd: string): Promise<RepoInfo>;
export interface DiffBundle {
    diff: string;
    commits: string[];
    /** The ref the diff was taken against, e.g. "origin/main...HEAD". */
    base: string;
}
/** Diff of the current branch against the default branch (merge-base). */
export declare function getBranchDiff(info: RepoInfo, baseOverride?: string): Promise<DiffBundle>;
/** Current labels on the repo's open PR for this branch (via gh), if any. */
export declare function getPrNumber(branch: string, cwd: string): Promise<string | undefined>;
/** Fill title/body/labels on the current branch's PR via the gh CLI. */
export declare function applyToPr(pr: {
    title: string;
    description: string;
    labels: string[];
}, cwd: string, branch: string): Promise<void>;
