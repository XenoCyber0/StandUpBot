import { execFile } from 'node:child_process';
import { StandupbotError } from '../core/errors';

/** Run a git (or other) command and resolve with trimmed stdout. */
function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(
          new StandupbotError(
            `\`${cmd} ${args.join(' ')}\` failed: ${stderr?.trim() || err.message}`,
          ),
        );
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

const git = (args: string[], cwd: string) => run('git', args, cwd);

export interface RepoInfo {
  cwd: string;
  /** "owner/repo" when derivable from origin, else the folder name. */
  repo: string;
  branch: string;
  defaultBranch: string;
}

async function tryGit(args: string[], cwd: string): Promise<string | undefined> {
  try {
    return await git(args, cwd);
  } catch {
    return undefined;
  }
}

/** Parse "owner/repo" out of a git remote URL (https or ssh). */
function repoFromRemote(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : fallback;
}

async function detectDefaultBranch(cwd: string): Promise<string> {
  const remoteHead = await tryGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  if (remoteHead) {
    const m = remoteHead.match(/refs\/remotes\/origin\/(.+)$/);
    if (m) return m[1];
  }
  for (const candidate of ['main', 'master']) {
    const exists = await tryGit(['rev-parse', '--verify', candidate], cwd);
    if (exists !== undefined) return candidate;
  }
  return 'main';
}

export async function getRepoInfo(cwd: string): Promise<RepoInfo> {
  const root = await git(['rev-parse', '--show-toplevel'], cwd);
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) || 'HEAD';
  const remote = await tryGit(['config', '--get', 'remote.origin.url'], cwd);
  const folderName = root.split(/[\\/]/).pop() ?? 'repo';
  const defaultBranch = await detectDefaultBranch(cwd);
  return {
    cwd: root,
    repo: repoFromRemote(remote, folderName),
    branch,
    defaultBranch,
  };
}

export interface DiffBundle {
  diff: string;
  commits: string[];
  /** The ref the diff was taken against, e.g. "origin/main...HEAD". */
  base: string;
}

/** Diff of the current branch against the default branch (merge-base). */
export async function getBranchDiff(info: RepoInfo, baseOverride?: string): Promise<DiffBundle> {
  const base = baseOverride ?? (await remoteRef(info, info.defaultBranch));
  const range = `${base}...HEAD`;
  const diff = await git(['diff', range], info.cwd);
  const commitsRaw = await tryGit(['log', '--format=%s', range], info.cwd);
  const commits = commitsRaw ? commitsRaw.split('\n').filter(Boolean) : [];
  return { diff, commits, base: range };
}

async function remoteRef(info: RepoInfo, branch: string): Promise<string> {
  const hasOrigin = await tryGit(['rev-parse', '--verify', `origin/${branch}`], info.cwd);
  return hasOrigin !== undefined ? `origin/${branch}` : branch;
}

/** Current labels on the repo's open PR for this branch (via gh), if any. */
export async function getPrNumber(branch: string, cwd: string): Promise<string | undefined> {
  try {
    const out = await run('gh', ['pr', 'view', branch, '--json', 'number', '-q', '.number'], cwd);
    return out || undefined;
  } catch {
    return undefined;
  }
}

/** Fill title/body/labels on the current branch's PR via the gh CLI. */
export async function applyToPr(
  pr: { title: string; description: string; labels: string[] },
  cwd: string,
  branch: string,
): Promise<void> {
  const args = ['pr', 'edit', branch, '--title', pr.title, '--body', pr.description];
  if (pr.labels.length) args.push('--add-label', pr.labels.join(','));
  await run('gh', args, cwd);
}
