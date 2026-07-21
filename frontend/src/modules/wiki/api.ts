import { api } from "../../lib/api";

export interface PageList {
  pages: string[]; // имена файлов вида "GameDesign.md"
}

export interface PageContent {
  name: string;
  content: string;
}

export interface SaveResult {
  name: string;
  created: boolean;
  committed: boolean;
}

const bq = (branch: string) => (branch ? `?branch=${encodeURIComponent(branch)}` : "");
const bq2 = (branch: string, extra: string) =>
  branch ? `?branch=${encodeURIComponent(branch)}&${extra}` : `?${extra}`;

/** Все wiki-запросы идут в конкретный репозиторий и ветку. */
export const wikiApi = (repo: string, branch: string) => ({
  list: () => api.get<PageList>(`/api/wiki/${repo}/pages${bq(branch)}`),
  get: (name: string) => api.get<PageContent>(`/api/wiki/${repo}/pages/${encodeURIComponent(name)}${bq(branch)}`),
  save: (name: string, content: string, commit: boolean, message = "") =>
    api.put<SaveResult>(`/api/wiki/${repo}/pages/${encodeURIComponent(name)}${bq(branch)}`, {
      content, commit, message,
    }),
  remove: (name: string) =>
    api.delete<void>(`/api/wiki/${repo}/pages/${encodeURIComponent(name)}${bq(branch)}`),
  assetUrl: (name: string) => `/api/wiki/${repo}/assets/${encodeURIComponent(name)}${bq2(branch, "")}`,
});
