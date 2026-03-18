import { execFile } from 'child_process';

export type RewriteCommitMessageResult = {
  mode: 'amend-head' | 'filter-branch';
};

export type SelectedCommitBounds = {
  newestSha: string;
  oldestSha: string;
  parentSha: string;
};

export type CumulativePatchResult = {
  content: string;
  newestSha: string;
  oldestSha: string;
};

export class GitCommandService {
  async createTag(repoPath: string, commitId: string, tagName: string): Promise<void> {
    const trimmedTag = String(tagName || '').trim();
    if (!trimmedTag) {
      throw new Error('Tag name cannot be empty.');
    }

    await this.runGitInRepo(repoPath, ['tag', trimmedTag, commitId]);
  }

  async createBranch(repoPath: string, commitId: string, branchName: string): Promise<void> {
    const trimmedBranch = String(branchName || '').trim();
    if (!trimmedBranch) {
      throw new Error('Branch name cannot be empty.');
    }

    await this.runGitInRepo(repoPath, ['branch', trimmedBranch, commitId]);
  }

  async checkoutCommit(repoPath: string, commitId: string): Promise<void> {
    await this.runGitInRepo(repoPath, ['checkout', commitId]);
  }

  async cherryPickCommit(repoPath: string, commitId: string): Promise<void> {
    await this.runGitInRepo(repoPath, ['cherry-pick', commitId]);
  }

  async extractPatch(repoPath: string, commitId: string): Promise<string> {
    return this.runGitInRepo(repoPath, ['format-patch', '-1', commitId, '--stdout']);
  }

  async revertCommit(repoPath: string, commitId: string): Promise<void> {
    await this.runGitInRepo(repoPath, ['revert', '--no-edit', commitId]);
  }

  async squashCommits(repoPath: string, selectedCommitIds: string[], message: string): Promise<void> {
    const trimmedMessage = String(message || '').trim();
    if (!trimmedMessage) {
      throw new Error('Commit message cannot be empty.');
    }

    const { parentSha } = await this.resolveSelectedCommitBounds(repoPath, selectedCommitIds);
    await this.runGitInRepo(repoPath, ['reset', '--soft', parentSha]);
    await this.runGitInRepo(repoPath, ['commit', '-m', trimmedMessage]);
  }

  async extractCumulativePatch(repoPath: string, selectedCommitIds: string[]): Promise<CumulativePatchResult> {
    const { newestSha, oldestSha, parentSha } = await this.resolveSelectedCommitBounds(repoPath, selectedCommitIds);
    const content = await this.runGitInRepo(repoPath, [
      'diff',
      '--binary',
      '--full-index',
      `${parentSha}..${newestSha}`
    ]);

    return { content, newestSha, oldestSha };
  }

  async rewriteCommitMessage(repoPath: string, commitId: string, newMessage: string): Promise<RewriteCommitMessageResult> {
    const trimmedMessage = String(newMessage || '').trim();
    if (!trimmedMessage) {
      throw new Error('Commit message cannot be empty.');
    }

    const fullSha = (await this.runGitInRepo(repoPath, ['rev-parse', '--verify', '--quiet', `${commitId}^{commit}`])).trim();
    if (!fullSha) {
      throw new Error(`Unable to resolve commit ${commitId}.`);
    }

    const headSha = (await this.runGitInRepo(repoPath, ['rev-parse', 'HEAD'])).trim();
    if (fullSha === headSha) {
      await this.runGitInRepo(repoPath, ['commit', '--amend', '-m', trimmedMessage]);
      return { mode: 'amend-head' };
    }

    const parentSha = (await this.runGitInRepo(repoPath, ['rev-parse', '--verify', '--quiet', `${fullSha}^`])).trim();
    if (!parentSha) {
      throw new Error('Rewriting the root commit message is not supported by this action.');
    }

    await this.runGitInRepo(repoPath, [
      'filter-branch',
      '-f',
      '--msg-filter',
      'if [ "$GIT_COMMIT" = "$TARGET_COMMIT" ]; then printf "%s\\n" "$NEW_MESSAGE"; else cat; fi',
      `${parentSha}..HEAD`
    ], {
      TARGET_COMMIT: fullSha,
      NEW_MESSAGE: trimmedMessage
    });

    return { mode: 'filter-branch' };
  }

  private async resolveSelectedCommitBounds(
    repoPath: string,
    selectedCommitIds: string[]
  ): Promise<SelectedCommitBounds> {
    const logOutput = await this.runGitInRepo(repoPath, [
      'log', '--no-walk=sorted', '--format=%H', ...selectedCommitIds
    ]);
    const orderedShas = logOutput.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (orderedShas.length === 0) {
      throw new Error('Could not resolve the selected commits.');
    }

    const newestSha = orderedShas[0];
    const oldestSha = orderedShas[orderedShas.length - 1];
    const parentSha = (await this.runGitInRepo(repoPath, ['rev-parse', `${oldestSha}^`])).trim();
    return { newestSha, oldestSha, parentSha };
  }

  private runGitInRepo(cwd: string, args: string[], extraEnv?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-C', cwd, ...args],
        {
          encoding: 'utf8',
          env: extraEnv ? { ...process.env, ...extraEnv } : process.env
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }
}
