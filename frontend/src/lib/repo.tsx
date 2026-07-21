/** Верхнеуровневый выбор репозитория: доступен всем страницам. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";

export interface RepoList {
  repos: { name: string }[];
}

interface RepoCtxValue {
  repo: string;
  repos: string[];
  select: (name: string) => void;
  reload: () => Promise<void>;
  /** Локально выбранная ветка ("" = ветка по умолчанию на сервере). */
  branch: string;
  selectBranch: (name: string) => void;
}

const RepoContext = createContext<RepoCtxValue>({
  repo: "repo",
  repos: [],
  select: () => {},
  reload: async () => {},
  branch: "",
  selectBranch: () => {},
});

export const useRepo = () => useContext(RepoContext);

const branchKey = (repo: string) => `hub-branch:${repo}`;

export function RepoProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState(() => localStorage.getItem("hub-repo") ?? "repo");
  const [branch, setBranch] = useState(() => localStorage.getItem(branchKey(localStorage.getItem("hub-repo") ?? "repo")) ?? "");

  const reload = useCallback(async () => {
    try {
      const list = await api.get<RepoList>("/api/repos");
      const names = list.repos.map((r) => r.name);
      setRepos(names);
      // выбранный репозиторий мог быть удалён — откатываемся на первый
      setRepo((cur) => (names.includes(cur) ? cur : (names[0] ?? "repo")));
    } catch {
      /* сервер перезапускается — оставляем как есть */
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = (name: string) => {
    localStorage.setItem("hub-repo", name);
    setRepo(name);
    // у каждого репозитория своя запомненная ветка
    setBranch(localStorage.getItem(branchKey(name)) ?? "");
  };

  const selectBranch = (name: string) => {
    localStorage.setItem(branchKey(repo), name);
    setBranch(name);
  };

  return (
    <RepoContext.Provider value={{ repo, repos, select, reload, branch, selectBranch }}>
      {children}
    </RepoContext.Provider>
  );
}

export const reposApi = {
  create: (name: string) => api.post("/api/repos", { name }),
  remove: (name: string) => api.delete(`/api/repos/${name}`),
};
