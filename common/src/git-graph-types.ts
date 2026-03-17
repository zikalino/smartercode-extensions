export type GraphCommit = {
  id: string;
  branch: string;
  committedAt?: string;
  sliceBreakBefore?: boolean;
  sliceLabel?: string;
  branches?: string[];
  hiddenMergeBranches?: string[];
  hiddenMergeParentId?: string;
  secondParentId?: string;
  secondParentKind?: 'branch' | 'detached';
  secondParentBranches?: string[];
  parents: string[];
  message?: string;
  tags?: string[];
  hiddenParentCount?: number;
  hiddenChildCount?: number;
};

export type GraphModel = {
  branches: string[];
  commits: GraphCommit[];
  head?: string;
};
