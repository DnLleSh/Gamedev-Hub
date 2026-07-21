"""Wiki: Markdown files stored inside the repo's docs/ directory.

Files live in Git, so documentation history rides along with the code.
Saving a page optionally auto-commits it.
"""
from __future__ import annotations
import re
import time

from pathlib import Path

from fastapi.responses import FileResponse
from fastapi import UploadFile, File, APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from ...config import settings
from ..gitmod.service import GitError
from ..repos import repo_manager


def _work_dir(repo: str, branch: str | None) -> Path:
    try:
        b = branch or repo_manager.default_branch(repo)
        return Path(repo_manager.working_dir(repo, b))
    except GitError as e:
        raise HTTPException(status_code=404, detail=str(e))


def _docs_dir(repo: str, branch: str | None) -> Path:
    return _work_dir(repo, branch) / settings.docs_dir_rel

router = APIRouter(prefix="/api/wiki/{repo}", tags=["wiki"])



def _safe_path(repo: str, branch: str | None, name: str) -> Path:
    """Resolve a page name inside docs/, rejecting path escapes."""
    if not name.endswith(".md"):
        name += ".md"
    p = (_docs_dir(repo, branch) / name).resolve()
    if not str(p).startswith(str(_docs_dir(repo, branch))):
        raise HTTPException(status_code=400, detail="Invalid page name")
    return p


@router.get("/pages")
def list_pages(repo: str, branch: str | None = Query(None)):
    _docs_dir(repo, branch).mkdir(parents=True, exist_ok=True)
    pages = sorted(p.name for p in _docs_dir(repo, branch).glob("*.md"))
    return {"pages": pages}


@router.get("/pages/{name}")
def get_page(repo: str, name: str, branch: str | None = Query(None)):
    p = _safe_path(repo, branch, name)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Page not found")
    return {"name": p.name, "content": p.read_text(encoding="utf-8")}


class PageIn(BaseModel):
    content: str
    commit: bool = False
    message: str = Field(default="", max_length=300)


@router.put("/pages/{name}")
def save_page(repo: str, name: str, body: PageIn, branch: str | None = Query(None)):
    p = _safe_path(repo, branch, name)
    p.parent.mkdir(parents=True, exist_ok=True)
    created = not p.exists()
    p.write_text(body.content, encoding="utf-8")
    committed = False
    if body.commit:
        rel = str(p.relative_to(_work_dir(repo, branch)))
        msg = body.message or f"docs: {'add' if created else 'update'} {p.name}"
        try:
            repo_manager.worktree_service(repo, branch or repo_manager.default_branch(repo)).commit(msg, [rel], "GameDev Hub Wiki", "wiki@local")
            committed = True
        except GitError:
            committed = False  # e.g. no changes; saving still succeeded
    return {"name": p.name, "created": created, "committed": committed}


@router.post("/assets")
async def upload_asset(repo: str, branch: str, file: UploadFile = File(...)):
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "image")
    name = f"{int(time.time())}_{safe}"
    adir = _docs_dir(repo, branch) / "assets"
    adir.mkdir(parents=True, exist_ok=True)
    (adir / name).write_bytes(await file.read())
    return {"name": name, "url": f"/api/wiki/{repo}/assets/{name}?branch={branch}"}


@router.get("/assets/{name}")
def get_asset(repo: str, branch: str, name: str):
    p = (_docs_dir(repo, branch) / "assets" / name).resolve()
    if not str(p).startswith(str((_docs_dir(repo, branch) / "assets").resolve())) or not p.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(p)


@router.delete("/pages/{name}")
def delete_page(repo: str, name: str, branch: str | None = Query(None)) -> Response:
    p = _safe_path(repo, branch, name)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Page not found")
    p.unlink()
    return Response(status_code=204)
