import { api } from "../../lib/api";
import type { Branches, Commit, DiffFile, FileContent, RepoStatus, TreeResponse } from "./types";

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : "";
};

/** Все git-запросы идут в конкретный репозиторий. */
export const gitApi = (repo: string) => ({
  tree: (path: string, ref?: string) => api.get<TreeResponse>(`/api/git/${repo}/tree${q({ path, ref })}`),
  file: (path: string, ref?: string) => api.get<FileContent>(`/api/git/${repo}/file${q({ path, ref })}`),
  log: (skip = 0, ref?: string) =>
    api.get<Commit[]>(`/api/git/${repo}/log${q({ skip: String(skip), limit: "30", ref })}`),
  commitDetail: (sha: string) =>
    api.get<{ commit: Commit; files: DiffFile[] }>(`/api/git/${repo}/commit/${sha}`),
  status: (branch?: string) => api.get<RepoStatus>(`/api/git/${repo}/status${q({ branch })}`),
  workingDiff: (branch?: string) => api.get<DiffFile[]>(`/api/git/${repo}/diff${q({ branch })}`),
  commit: (message: string, author_name: string, branch?: string) =>
    api.post<Commit>(`/api/git/${repo}/commit`, { message, author_name, branch }),
  branches: () => api.get<Branches>(`/api/git/${repo}/branches`),
  createBranch: (name: string, base?: string) =>
    api.post(`/api/git/${repo}/branches/create`, { name, base }),
  deleteBranch: (name: string, force = false) =>
    api.post(`/api/git/${repo}/branches/delete`, { name, force }),
  search: (qq: string, ref?: string) =>
    api.get<{ files: string[]; commits: { sha: string; short: string; summary: string; author: string; date: string }[] }>(
      `/api/git/${repo}/search${q({ q: qq, ref })}`),
  rawUrl: (path: string, ref?: string) => `/api/git/${repo}/raw${q({ path, ref })}`,
  merge: (name: string, into?: string) =>
    api.post<{ output: string }>(`/api/git/${repo}/merge`, { name, into }),
});

