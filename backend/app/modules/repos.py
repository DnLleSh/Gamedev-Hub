"""Multiple repositories: one directory per repo under DATA_DIR/repos.

Handles name validation, creation, deletion, per-repo GitService instances
and a one-time migration of the legacy single-repo layout (DATA_DIR/repo).
"""
from __future__ import annotations

import re
import shutil

from ..config import settings
from .gitmod.service import GitError, GitService

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$")


def sanitize_branch(branch: str) -> str:
    """Имя ветки -> сегмент пути/URL: '/' недопустим в каталоге, '~' — в ветке."""
    return branch.replace("/", "~")


def _migrate_legacy() -> None:
    """Move DATA_DIR/repo -> DATA_DIR/repos/repo (pre-multi-repo layout)."""
    legacy = settings.legacy_repo_path
    target = settings.repos_dir / "repo"
    if (legacy / ".git").exists() and not target.exists():
        shutil.move(str(legacy), str(target))


class RepoManager:
    def __init__(self) -> None:
        self._services: dict[str, GitService] = {}
        _migrate_legacy()
        if not self.names():
            # out-of-the-box experience: one repo exists immediately
            self.create("repo")

    # -- naming ------------------------------------------------------------

    @staticmethod
    def validate(name: str) -> str:
        if not _NAME_RE.fullmatch(name or ""):
            raise GitError(
                "Недопустимое имя: латиница, цифры, точки, дефисы и подчёркивания, "
                "начинается с буквы или цифры, до 64 символов"
            )
        return name

    # -- queries -----------------------------------------------------------

    def names(self) -> list[str]:
        return sorted(
            p.name for p in settings.repos_dir.iterdir() if (p / ".git").exists()
        )

    def exists(self, name: str) -> bool:
        return (settings.repos_dir / self.validate(name) / ".git").exists()

    def service(self, name: str) -> GitService:
        name = self.validate(name)
        if not self.exists(name):
            raise GitError(f"Репозиторий «{name}» не найден")
        if name not in self._services:
            self._services[name] = GitService(settings.repos_dir / name)
        return self._services[name]

    # -- mutations -----------------------------------------------------------

    def create(self, name: str) -> None:
        name = self.validate(name)
        if self.exists(name):
            raise GitError(f"Репозиторий «{name}» уже существует")
        GitService(settings.repos_dir / name).open()  # init + updateInstead

    def delete(self, name: str) -> None:
        name = self.validate(name)
        if self.names() == [name]:
            raise GitError("Нельзя удалить единственный репозиторий")
        if not self.exists(name):
            raise GitError(f"Репозиторий «{name}» не найден")
        self._services.pop(name, None)
        shutil.rmtree(settings.repos_dir / name)
        shutil.rmtree(self.worktrees_root(name), ignore_errors=True)


    # -- worktrees: независимое рабочее дерево на каждую ветку ---------------

    @staticmethod
    def validate_branch(branch: str) -> str:
        if not _BRANCH_RE.fullmatch(branch or "") or ".." in branch or branch.endswith(".lock"):
            raise GitError(f"Недопустимое имя ветки: «{branch}»")
        return branch

    def default_branch(self, name: str) -> str:
        """Ветка основного рабочего дерева (для запросов без явной ветки)."""
        repo = self.service(name).open()
        try:
            return repo.active_branch.name
        except Exception:  # noqa: BLE001 — detached/unborn
            return "main"

    def _main_branch(self, name: str) -> str | None:
        try:
            return self.service(name).open().active_branch.name
        except Exception:  # noqa: BLE001
            return None

    def worktrees_root(self, name: str):
        return settings.repos_dir.parent / "worktrees" / name

    def working_dir(self, name: str, branch: str):
        """Каталог с файлами ветки: основное дерево или linked worktree (лениво)."""
        name = self.validate(name)
        branch = self.validate_branch(branch)
        if not self.exists(name):
            raise GitError(f"Репозиторий «{name}» не найден")
        if branch == self._main_branch(name):
            return settings.repos_dir / name
        repo = self.service(name).open()
        if branch not in [h.name for h in repo.heads]:
            raise GitError(f"Ветка «{branch}» не найдена")
        path = self.worktrees_root(name) / sanitize_branch(branch)
        if not (path / ".git").exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                repo.git.worktree("add", str(path), branch)
            except Exception as e:  # noqa: BLE001
                # каталог мог остаться от снесённого worktree — чистим и повторяем
                shutil.rmtree(path, ignore_errors=True)
                repo.git.worktree("prune")
                try:
                    repo.git.worktree("add", str(path), branch)
                except Exception:
                    raise GitError(f"Не удалось подготовить рабочее дерево ветки «{branch}»: {e}")
        return path

    def worktree_service(self, name: str, branch: str) -> GitService:
        return GitService(self.working_dir(name, branch))

    def sync_worktree(self, name: str, branch: str) -> None:
        """Перед сборкой: чистое дерево подтягиваем к вершине ветки.
        Грязное (незакоммиченные правки из вкладки «Изменения») не трогаем."""
        path = self.working_dir(name, branch)
        repo = GitService(path).open()
        try:
            if not repo.is_dirty(untracked_files=False):
                repo.git.reset("--hard", f"refs/heads/{branch}" if branch in [h.name for h in repo.heads] else "HEAD")
        except Exception:  # noqa: BLE001
            pass

    def remove_worktree(self, name: str, branch: str) -> None:
        """Убрать worktree ветки (перед её удалением); основное дерево не трогаем."""
        if branch == self._main_branch(name):
            return
        path = self.worktrees_root(name) / sanitize_branch(branch)
        if path.exists():
            repo = self.service(name).open()
            try:
                repo.git.worktree("remove", "--force", str(path))
            except Exception:  # noqa: BLE001
                shutil.rmtree(path, ignore_errors=True)
                try:
                    repo.git.worktree("prune")
                except Exception:
                    pass


    def cleanup(self, name: str, days: int = 14) -> list[str]:
        """Удаляет worktree (и билды в них) веток без коммитов за N дней."""
        import time
        name = self.validate(name)
        svc = self.service(name)
        repo = svc.open()
        cutoff = time.time() - days * 86400
        removed: list[str] = []
        current = repo.active_branch.name if not repo.head.is_detached else None
        for h in list(repo.heads):
            if h.name == current:
                continue
            if h.commit.committed_date < cutoff:
                try:
                    svc.remove_worktree(h.name)
                    removed.append(h.name)
                except Exception:  # noqa: BLE001
                    pass
        return removed


repo_manager = RepoManager()
