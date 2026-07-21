"""Build API: независимые сборки на каждую пару (репозиторий, ветка)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ... import settings_store
from ...config import settings
from ..gitmod.service import GitError
from ..repos import repo_manager
from .service import get_build_manager

router = APIRouter(prefix="/api/build", tags=["build"])


def _manager(repo: str, branch: str | None):
    try:
        if not repo_manager.exists(repo):
            raise GitError(f"Репозиторий «{repo}» не найден")
        return get_build_manager(repo, branch or repo_manager.default_branch(repo))
    except GitError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{repo}/start")
def start(repo: str, branch: str | None = Query(None)):
    return {"started": _manager(repo, branch).start()}


@router.post("/{repo}/stop")
def stop(repo: str, branch: str | None = Query(None)):
    _manager(repo, branch).stop()
    return {"ok": True}


@router.get("/{repo}/status")
def status(repo: str, offset: int = 0, branch: str | None = Query(None)):
    return _manager(repo, branch).status(offset)


@router.get("/{repo}/config")
def config(repo: str, branch: str | None = Query(None)):
    _manager(repo, branch)  # валидация
    return {
        "build_cmd": settings.build_cmd,
        "output_dir": settings.build_output_rel,
        "auto_build": bool(settings_store.get("auto_build")),
    }


class ConfigIn(BaseModel):
    auto_build: bool


@router.patch("/config")
def update_config(body: ConfigIn):
    settings_store.set_("auto_build", body.auto_build)
    return {"auto_build": body.auto_build}
