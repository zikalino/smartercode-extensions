export type GraphCommit = {
  id: string;
  branch: string;
  branches?: string[];
  hiddenMergeBranches?: string[];
  hiddenMergeParentId?: string;
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
