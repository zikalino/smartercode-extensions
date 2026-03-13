export type GraphCommit = {
  id: string;
  branch: string;
  parents: string[];
  message?: string;
};

export type GraphModel = {
  branches: string[];
  commits: GraphCommit[];
};
