import { buildGitGraphUri, GitGraphDataSource, GitGraphFilter, parseGitGraphUri } from './git-data-provider';

export type GitGraphHeaderState = {
  uri: string;
  source: GitGraphDataSource;
  localPath: string;
  remoteUrl: string;
  branches: string[];
  files: string[];
  commitRange: string;
};

export function createDefaultGitGraphHeaderState(): GitGraphHeaderState {
  return {
    uri: 'gitgraph://local/workspace?branches=main',
    source: 'local',
    localPath: 'workspace',
    remoteUrl: '',
    branches: ['main'],
    files: [],
    commitRange: ''
  };
}

export function parseHeaderStateFromUri(uri: string): GitGraphHeaderState {
  const parsed = parseGitGraphUri(uri);
  return {
    uri,
    source: parsed.source,
    localPath: parsed.localPath ?? '',
    remoteUrl: parsed.remoteUrl ?? '',
    branches: parsed.branches,
    files: parsed.files,
    commitRange: parsed.commitRange ?? ''
  };
}

export function toGitGraphFilter(state: GitGraphHeaderState): GitGraphFilter {
  const filter: GitGraphFilter = {
    uri: state.uri,
    source: state.source,
    localPath: state.localPath || undefined,
    remoteUrl: state.remoteUrl || undefined,
    branches: state.branches,
    files: state.files,
    commitRange: state.commitRange || undefined
  };

  return {
    ...filter,
    uri: buildGitGraphUri(filter)
  };
}
