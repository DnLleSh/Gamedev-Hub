"""Everything Git. A thin, explicit wrapper around GitPython.

The repository is a normal (non-bare) working tree so the build module can
compile straight from it. `receive.denyCurrentBranch=updateInstead` lets
developers push into it over Smart HTTP and keeps the working tree in sync.
"""
from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from git import Actor, GitCommandError, Repo


MAX_TEXT_BYTES = 1_000_000  # refuse to inline files bigger than 1 MB


class GitError(Exception):
    """User-facing git failure (bad ref, merge conflict, no remote...)."""


@dataclass
class GitService:
    repo_path: Path

    # -- lifecycle ---------------------------------------------------------

    def open(self) -> Repo:
        try:
            repo = Repo(self.repo_path)
        except Exception:
            repo = Repo.init(self.repo_path, initial_branch="main")
            with repo.config_writer() as cw:
                # Allow `git push` into this checked-out repo over HTTP.
                cw.set_value("receive", "denyCurrentBranch", "updateInstead")
        self._ensure_identity(repo)
        return repo

    @staticmethod
    def _ensure_identity(repo: Repo) -> None:
        """Server-side merges/commits need a committer identity.

        The container runs as root with no global gitconfig, so `git merge`
        fails with «Committer identity unknown». Set a local (per-repo)
        identity once; existing repos get it on first open after upgrade.
        """
        try:
            reader = repo.config_reader()  # merged view: system/global/local
            has_name = reader.has_option("user", "name")
            has_email = reader.has_option("user", "email")
            if has_name and has_email:
                return
            with repo.config_writer() as cw:
                if not has_name:
                    cw.set_value("user", "name", "GameDev Hub")
                if not has_email:
                    cw.set_value("user", "email", "hub@local")
        except Exception:  # noqa: BLE001 — не мешаем работе, если конфиг read-only
            pass

    def _default_ref(self, repo: Repo) -> str:
        if repo.head.is_valid():
            return repo.head.commit.hexsha
        raise GitError("Repository has no commits yet")

    # -- browse ------------------------------------------------------------

    def tree(self, ref: Optional[str], path: str) -> dict[str, Any]:
        repo = self.open()
        commit = repo.commit(ref) if ref else repo.commit(self._default_ref(repo))
        tree = commit.tree
        if path:
            try:
                tree = tree / path
            except KeyError:
                raise GitError(f"Path not found: {path}")
        entries = []
        for item in tree:
            entries.append(
                {
                    "name": item.name,
                    "path": item.path,
                    "type": "dir" if item.type == "tree" else "file",
                    "size": item.size if item.type == "blob" else None,
                    "last_message": None,
                    "last_date": None,
                }
            )
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))

        # Последний коммит по каждой записи — одним вызовом git log --name-only
        # (как колонка сообщений в GitHub). Ограничиваем глубину истории,
        # чтобы каталог открывался мгновенно даже в старом репозитории.
        file_commit: dict[str, tuple[int, str]] = {}
        try:
            raw = repo.git.log(
                commit.hexsha, "-n", "300", "--name-only", "--format=%x01%ct%x09%s",
                "--", path or ".",
            )
            cur: Optional[tuple[int, str]] = None
            for line in raw.split("\n"):
                if line.startswith("\x01"):
                    ts, _, msg = line[1:].partition("\t")
                    cur = (int(ts), msg)
                elif line and cur is not None and line not in file_commit:
                    file_commit[line] = cur
        except (GitCommandError, ValueError):
            pass

        prefix_len = len(path) + 1 if path else 0
        for e in entries:
            if e["type"] == "file":
                info = file_commit.get(e["path"])
            else:
                sub = e["path"] + "/"
                info = None
                for f, c in file_commit.items():  # порядок = от свежих к старым
                    if f.startswith(sub):
                        info = c
                        break
            if info:
                e["last_date"] = info[0]
                e["last_message"] = info[1]

        latest = {
            "sha": commit.hexsha,
            "short": commit.hexsha[:7],
            "summary": commit.summary,
            "author": commit.author.name,
            "date": commit.committed_datetime.isoformat(),
        }
        try:
            total = int(repo.git.rev_list("--count", commit.hexsha))
        except (GitCommandError, ValueError):
            total = 0
        _ = prefix_len  # (имена в file_commit уже полные пути)
        return {"entries": entries, "latest": latest, "commits": total}

    def raw(self, ref: Optional[str], path: str) -> tuple[bytes, str]:
        repo = self.open()
        commit = repo.commit(ref) if ref else repo.commit(self._default_ref(repo))
        try:
            blob = commit.tree / path
        except KeyError:
            raise GitError(f"File not found: {path}")
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        return blob.data_stream.read(), mime

    def search(self, ref: Optional[str], q: str) -> dict[str, Any]:
        repo = self.open()
        commit = repo.commit(ref) if ref else repo.commit(self._default_ref(repo))
        ql = q.lower()
        files = [p for p in repo.git.ls_tree("-r", "--name-only", commit.hexsha).split("\n")
                 if ql in p.lower()][:50]
        commits = []
        try:
            out = repo.git.log(commit.hexsha, "-i", f"--grep={q}", "-n", "30",
                               "--format=%H%x09%s%x09%an%x09%cI")
            for line in out.split("\n"):
                if not line:
                    continue
                sha, msg, an, dt = (line.split("\t") + ["", "", ""])[:4]
                commits.append({"sha": sha, "short": sha[:7], "summary": msg, "author": an, "date": dt})
        except GitCommandError:
            pass
        return {"files": files, "commits": commits}

    def file(self, ref: Optional[str], path: str) -> dict[str, Any]:
        repo = self.open()
        commit = repo.commit(ref) if ref else repo.commit(self._default_ref(repo))
        try:
            blob = commit.tree / path
        except KeyError:
            raise GitError(f"File not found: {path}")
        if blob.type != "blob":
            raise GitError(f"Not a file: {path}")
        raw = blob.data_stream.read()
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        is_binary = b"\0" in raw[:8192]
        if is_binary or blob.size > MAX_TEXT_BYTES:
            return {"path": path, "size": blob.size, "binary": True, "mime": mime, "content": None}
        return {
            "path": path,
            "size": blob.size,
            "binary": False,
            "mime": mime,
            "content": raw.decode("utf-8", errors="replace"),
        }

    # -- history & diffs ----------------------------------------------------

    def log(self, ref: Optional[str], limit: int, skip: int) -> list[dict[str, Any]]:
        repo = self.open()
        if not repo.head.is_valid():
            return []
        rev = ref or repo.active_branch.name
        try:
            commits = list(repo.iter_commits(rev, max_count=limit, skip=skip))
        except GitCommandError:
            raise GitError(f"Unknown ref: {rev}")
        return [self._commit_dict(c) for c in commits]

    @staticmethod
    def _commit_dict(c: Any) -> dict[str, Any]:
        return {
            "sha": c.hexsha,
            "short": c.hexsha[:7],
            "message": c.message.strip(),
            "summary": c.summary,
            "author": c.author.name,
            "email": c.author.email,
            "date": c.committed_datetime.isoformat(),
            "parents": [p.hexsha for p in c.parents],
        }

    def commit_diff(self, sha: str) -> dict[str, Any]:
        repo = self.open()
        try:
            commit = repo.commit(sha)
        except Exception:
            raise GitError(f"Unknown commit: {sha}")
        parent = commit.parents[0] if commit.parents else None
        if parent:
            raw = repo.git.diff(parent.hexsha, commit.hexsha, unified=3)
        else:
            raw = repo.git.show(commit.hexsha, format="", unified=3)
        return {"commit": self._commit_dict(commit), "files": _split_patch(raw)}

    def working_diff(self, staged: bool = False) -> list[dict[str, Any]]:
        repo = self.open()
        if not repo.head.is_valid():
            return []
        raw = repo.git.diff("--cached" if staged else None, unified=3)
        return _split_patch(raw)

    # -- status & commit -----------------------------------------------------

    def status(self) -> dict[str, Any]:
        repo = self.open()
        branch = repo.active_branch.name if not repo.head.is_detached else "(detached)"
        untracked = repo.untracked_files
        modified: list[str] = []
        deleted: list[str] = []
        staged: list[dict[str, str]] = []
        if repo.head.is_valid():
            for d in repo.index.diff(None):
                (deleted if d.change_type == "D" else modified).append(d.a_path)
            for d in repo.index.diff("HEAD"):
                staged.append({"path": d.a_path, "change": d.change_type})
        return {
            "branch": branch,
            "untracked": untracked,
            "modified": modified,
            "deleted": deleted,
            "staged": staged,
            "clean": not (untracked or modified or deleted or staged),
        }

    def commit(self, message: str, paths: Optional[list[str]], author_name: str, author_email: str) -> dict[str, Any]:
        if not message.strip():
            raise GitError("Commit message is empty")
        repo = self.open()
        if paths:
            repo.git.add("--", *paths)
        else:
            repo.git.add("-A")
        if repo.head.is_valid() and not repo.index.diff("HEAD"):
            raise GitError("Nothing to commit")
        actor = Actor(author_name or "GameDev Hub", author_email or "hub@local")
        c = repo.index.commit(message, author=actor, committer=actor)
        return self._commit_dict(c)

    # -- branches --------------------------------------------------------------

    def branches(self) -> dict[str, Any]:
        repo = self.open()
        current = repo.active_branch.name if not repo.head.is_detached else None
        items = []
        for b in repo.branches:
            c = b.commit
            items.append(
                {
                    "name": b.name,
                    "current": b.name == current,
                    "sha": c.hexsha[:7],
                    "message": c.summary,
                    "author": c.author.name,
                    "date": c.committed_datetime.isoformat(),
                }
            )
        # свежие сверху, текущая — первой
        items.sort(key=lambda i: (not i["current"], i["date"]), reverse=False)
        items.sort(key=lambda i: i["date"], reverse=True)
        items.sort(key=lambda i: not i["current"])
        return {"current": current, "branches": items}

    def create_branch(self, name: str, base: Optional[str] = None) -> None:
        """Создать ветку от base (или HEAD), не переключая рабочее дерево."""
        repo = self.open()
        try:
            if base:
                repo.git.branch(name, base)
            else:
                repo.git.branch(name)
        except GitCommandError as e:
            raise GitError(e.stderr.strip() or str(e))

    def checkout(self, name: str, create: bool, base: Optional[str] = None) -> None:
        repo = self.open()
        try:
            if create:
                if base:
                    repo.git.checkout("-b", name, base)
                else:
                    repo.git.checkout("-b", name)
            else:
                repo.git.checkout(name)
        except GitCommandError as e:
            raise GitError(e.stderr.strip() or str(e))

    def delete_branch(self, name: str, force: bool = False) -> None:
        repo = self.open()
        current = repo.active_branch.name if not repo.head.is_detached else None
        if name == current:
            raise GitError("Нельзя удалить текущую ветку — сначала переключитесь на другую")
        try:
            repo.git.branch("-D" if force else "-d", name)
        except GitCommandError as e:
            err = e.stderr.strip() or str(e)
            if "not fully merged" in err:
                raise GitError(
                    f"В ветке «{name}» есть коммиты, которых нет в текущей. "
                    "Слейте её или удалите принудительно."
                )
            raise GitError(err)

    def merge(self, name: str) -> str:
        """Merge branch `name` into the current branch. Aborts on conflict."""
        repo = self.open()
        current = repo.active_branch.name if not repo.head.is_detached else None
        if name == current:
            raise GitError("Ветка уже текущая — сливать её саму в себя не нужно")
        # Незакоммиченные правки отслеживаемых файлов заблокируют merge честно;
        # untracked-артефакты сборки (build/web и т.п.) слиянию не мешают.
        if repo.is_dirty(untracked_files=False):
            raise GitError("Есть незакоммиченные изменения — закоммитьте их перед слиянием")
        try:
            out = repo.git.merge(name, "--no-edit")
            return out or f"Ветка «{name}» слита в «{current}»"
        except GitCommandError as e:
            err = ((e.stdout or "") + "\n" + (e.stderr or "")).strip()
            try:
                repo.git.merge("--abort")
            except GitCommandError:
                pass
            if "CONFLICT" in err or "conflict" in err.lower():
                raise GitError(
                    "Конфликт слияния — изменения затрагивают одни и те же файлы. "
                    "Слияние отменено, репозиторий не тронут.\n" + err
                )
            # не конфликт (identity, права и т.п.) — показываем реальную причину
            raise GitError("Слияние не удалось:\n" + (err or str(e)))


def _split_patch(raw: str) -> list[dict[str, Any]]:
    """Split one big unified diff into per-file chunks the UI can render."""
    files: list[dict[str, Any]] = []
    current: Optional[dict[str, Any]] = None
    for line in raw.splitlines():
        if line.startswith("diff --git"):
            if current:
                files.append(current)
            # `diff --git a/x b/x` -> take the b/ side as the display path
            parts = line.split(" b/", 1)
            path = parts[1] if len(parts) == 2 else line
            current = {"path": path, "additions": 0, "deletions": 0, "patch": []}
        if current is None:
            continue
        current["patch"].append(line)
        if line.startswith("+") and not line.startswith("+++"):
            current["additions"] += 1
        elif line.startswith("-") and not line.startswith("---"):
            current["deletions"] += 1
    if current:
        files.append(current)
    for f in files:
        f["patch"] = "\n".join(f["patch"])
    return files

