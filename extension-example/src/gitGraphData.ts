import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GitCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string[];
  subject: string;
  lane: number;
};

export async function readGitHistory(repositoryRoot: string, maxCommits: number): Promise<GitCommit[]> {
  const separator = '\u001f';
  const recordSeparator = '\u001e';
  const pretty = `%H${separator}%P${separator}%an${separator}%ad${separator}%D${separator}%s${recordSeparator}`;

  const args = [
    '-C',
    repositoryRoot,
    'log',
    '--all',
    '--date=short',
    '--topo-order',
    `--max-count=${maxCommits}`,
    `--pretty=format:${pretty}`,
  ];

  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 20 * 1024 * 1024,
  });

  const commits: Omit<GitCommit, 'lane'>[] = [];
  for (const row of stdout.split(recordSeparator)) {
    const normalizedRow = row.trim();
    if (!normalizedRow) {
      continue;
    }

    const [hash, parentsRaw, author, date, refsRaw, subject] = normalizedRow.split(separator);
    if (!hash || !author || !date || typeof subject !== 'string') {
      continue;
    }

    commits.push({
      hash,
      shortHash: hash.slice(0, 8),
      parents: parentsRaw ? parentsRaw.split(' ').filter(Boolean) : [],
      author,
      date,
      refs: refsRaw ? refsRaw.split(',').map((part) => part.trim()).filter(Boolean) : [],
      subject,
    });
  }

  return assignLanes(commits);
}

function assignLanes(commits: Omit<GitCommit, 'lane'>[]): GitCommit[] {
  const activeLanes: string[] = [];
  const positioned: GitCommit[] = [];

  for (const commit of commits) {
    let laneIndex = activeLanes.indexOf(commit.hash);
    if (laneIndex < 0) {
      laneIndex = activeLanes.length;
      activeLanes.push(commit.hash);
    }

    positioned.push({
      ...commit,
      lane: laneIndex,
    });

    const uniqueParents = commit.parents.filter((parent, index, list) => list.indexOf(parent) === index);

    activeLanes.splice(laneIndex, 1, ...uniqueParents);

    for (let index = activeLanes.length - 1; index >= 0; index -= 1) {
      if (activeLanes.indexOf(activeLanes[index]) !== index) {
        activeLanes.splice(index, 1);
      }
    }
  }

  return positioned;
}