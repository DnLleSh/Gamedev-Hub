export interface TreeEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number | null;
  last_message: string | null;
  last_date: number | null; // unix seconds
}

export interface TreeResponse {
  entries: TreeEntry[];
  latest: { sha: string; short: string; summary: string; author: string; date: string };
  commits: number;
}

export interface FileContent {
  path: string;
  size: number;
  binary: boolean;
  mime: string;
  content: string | null;
}

export interface Commit {
  sha: string;
  short: string;
  message: string;
  summary: string;
  author: string;
  email: string;
  date: string;
  parents: string[];
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface RepoStatus {
  branch: string;
  untracked: string[];
  modified: string[];
  deleted: string[];
  staged: { path: string; change: string }[];
  clean: boolean;
}

export interface Branch {
  name: string;
  current: boolean;
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface Branches {
  current: string | null;
  branches: Branch[];
}

