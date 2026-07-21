"""Build manager: runs BUILD_CMD inside the repo, captures the log live.

One build at a time. The frontend polls /api/build/status with a log offset
and only receives new lines, so polling stays cheap even for long logs.
"""
from __future__ import annotations

import shlex
import subprocess
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

from ...config import settings
from ..gitmod.service import GitError
from ..repos import repo_manager


def working_dir(repo: str, branch: str):
    """Working tree of a branch (build cwd) — main worktree or a linked one."""
    return repo_manager.working_dir(repo, branch)


def output_dir(repo: str, branch: str):
    """Exported HTML5 build of a branch."""
    return working_dir(repo, branch) / settings.build_output_rel


@dataclass
class BuildState:
    status: str = "idle"  # idle | building | success | failed
    log: list[str] = field(default_factory=list)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    build_id: int = 0


class BuildManager:
    def __init__(self, repo: str, branch: str) -> None:
        self.repo = repo
        self.branch = branch
        self._state = BuildState()
        self._lock = threading.Lock()
        self._proc: Optional[subprocess.Popen[str]] = None

    # -- public API ----------------------------------------------------------

    def start(self, note: str | None = None) -> bool:
        with self._lock:
            if self._state.status == "building":
                return False
            log = [note] if note else []
            log.append(f"$ {settings.build_cmd}")
            self._state = BuildState(
                status="building",
                started_at=time.time(),
                build_id=self._state.build_id + 1,
                log=log,
            )
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def stop(self) -> bool:
        with self._lock:
            proc = self._proc
        if proc and proc.poll() is None:
            proc.terminate()
            return True
        return False

    def _output_ready(self) -> bool:
        try:
            return output_dir(self.repo, self.branch).joinpath("index.html").exists()
        except GitError:
            return False  # ветка ещё не существует или уже удалена

    def status(self, offset: int = 0) -> dict:
        with self._lock:
            s = self._state
            log = s.log[offset:] if offset < len(s.log) else []
            return {
                "status": s.status,
                "build_id": s.build_id,
                "log": log,
                "log_length": len(s.log),
                "started_at": s.started_at,
                "finished_at": s.finished_at,
                "duration": (
                    round((s.finished_at or time.time()) - s.started_at, 1)
                    if s.started_at
                    else None
                ),
                "exit_code": s.exit_code,
                "output_ready": self._output_ready(),
            }

    # -- internals -------------------------------------------------------------

    def _append(self, line: str) -> None:
        with self._lock:
            self._state.log.append(line.rstrip("\n"))

    def _run(self) -> None:
        repo_manager.sync_worktree(self.repo, self.branch)
        output_dir(self.repo, self.branch).mkdir(parents=True, exist_ok=True)
        try:
            proc = subprocess.Popen(
                shlex.split(settings.build_cmd),
                cwd=working_dir(self.repo, self.branch),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as e:
            self._finish(127, f"Build command not found: {e}")
            return
        except Exception as e:  # noqa: BLE001
            self._finish(1, f"Failed to start build: {e}")
            return

        with self._lock:
            self._proc = proc
        assert proc.stdout is not None
        for line in proc.stdout:
            self._append(line)
        code = proc.wait()
        self._finish(code)

    def _finish(self, code: int, extra: Optional[str] = None) -> None:
        with self._lock:
            if extra:
                self._state.log.append(extra)
            self._state.exit_code = code
            self._state.finished_at = time.time()
            self._state.status = "success" if code == 0 else "failed"
            self._state.log.append(
                f"— build finished with exit code {code} —"
            )
            self._proc = None


_managers: dict[str, BuildManager] = {}
_managers_lock = threading.Lock()


def get_build_manager(repo: str, branch: str) -> BuildManager:
    """One independent build manager per (repository, branch)."""
    repo = repo_manager.validate(repo)
    branch = repo_manager.validate_branch(branch)
    key = f"{repo}\x00{branch}"
    with _managers_lock:
        if key not in _managers:
            _managers[key] = BuildManager(repo, branch)
        return _managers[key]
