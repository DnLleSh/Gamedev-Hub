"""REST API for the Git UI + Git Smart HTTP so teammates can clone/push.

Multi-repo: every repository lives under DATA_DIR/repos/<name> and is
reachable both in the UI and over Smart HTTP:

    git clone http://server:8000/git/<name>.git

Pushes land straight into the hub's working tree thanks to
`receive.denyCurrentBranch=updateInstead` (set on repo init).
"""
from __future__ import annotations

import subprocess
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ... import settings_store
from ..repos import repo_manager
from .service import GitError

router = APIRouter(prefix="/api", tags=["git"])
smart_http = APIRouter(prefix="/git", tags=["git-smart-http"])


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except GitError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _svc(repo: str):
    return _guard(repo_manager.service, repo)


# ---------------------------------------------------------------- repos -----

@router.get("/repos")
def repos_list():
    items = []
    for n in repo_manager.names():
        meta: dict = {"name": n, "branch": None, "last": None, "branches": 0}
        try:
            repo = repo_manager.service(n).open()
            meta["branches"] = len(repo.heads)
            if not repo.head.is_detached and repo.head.is_valid():
                meta["branch"] = repo.active_branch.name
                c = repo.head.commit
                meta["last"] = {
                    "summary": c.summary,
                    "author": c.author.name,
                    "date": c.committed_datetime.isoformat(),
                }
        except Exception:  # noqa: BLE001 — пустой/битый репозиторий не валит список
            pass
        items.append(meta)
    return {"repos": items}


class RepoIn(BaseModel):
    name: str


@router.post("/repos", status_code=201)
def repos_create(body: RepoIn):
    _guard(repo_manager.create, body.name.strip())
    return {"name": body.name.strip()}


@router.post("/repos/{name}/cleanup")
def repos_cleanup(name: str, days: int = 14):
    return {"removed": _guard(repo_manager.cleanup, name, days)}


@router.delete("/repos/{name}", status_code=204)
def repos_delete(name: str):
    _guard(repo_manager.delete, name)
    return Response(status_code=204)


# ---------------------------------------------------------------- REST API --

@router.get("/git/{repo}/tree")
def tree(repo: str, ref: Optional[str] = None, path: str = ""):
    return _guard(_svc(repo).tree, ref, path.strip("/"))


@router.get("/git/{repo}/file")
def file(repo: str, path: str, ref: Optional[str] = None):
    return _guard(_svc(repo).file, ref, path.strip("/"))


@router.get("/git/{repo}/raw")
def raw(repo: str, path: str, ref: Optional[str] = None):
    data, mime = _guard(_svc(repo).raw, ref, path.strip("/"))
    return Response(content=data, media_type=mime, headers={"Cache-Control": "no-store"})


@router.get("/git/{repo}/search")
def search(repo: str, q: str, ref: Optional[str] = None):
    if not q.strip():
        return {"files": [], "commits": []}
    return _guard(_svc(repo).search, ref, q.strip())


@router.get("/git/{repo}/log")
def log(repo: str, ref: Optional[str] = None, limit: int = Query(30, le=200), skip: int = 0):
    return _guard(_svc(repo).log, ref, limit, skip)


@router.get("/git/{repo}/commit/{sha}")
def commit_detail(repo: str, sha: str):
    return _guard(_svc(repo).commit_diff, sha)


def _wsvc(repo: str, branch: Optional[str]):
    """Сервис рабочего дерева выбранной ветки (основного — если ветка не задана)."""
    def make():
        b = branch or repo_manager.default_branch(repo)
        return repo_manager.worktree_service(repo, b)
    return _guard(make)


@router.get("/git/{repo}/status")
def status(repo: str, branch: Optional[str] = Query(None)):
    return _guard(_wsvc(repo, branch).status)


@router.get("/git/{repo}/diff")
def working_diff(repo: str, staged: bool = False, branch: Optional[str] = Query(None)):
    return _guard(_wsvc(repo, branch).working_diff, staged)


class CommitIn(BaseModel):
    message: str
    paths: Optional[list[str]] = None
    author_name: str = "GameDev Hub"
    author_email: str = "hub@local"
    branch: Optional[str] = None


@router.post("/git/{repo}/commit")
def commit(repo: str, body: CommitIn):
    return _guard(_wsvc(repo, body.branch).commit, body.message, body.paths, body.author_name, body.author_email)


@router.get("/git/{repo}/branches")
def branches(repo: str):
    return _guard(_svc(repo).branches)


class BranchCreateIn(BaseModel):
    name: str
    base: Optional[str] = None


@router.post("/git/{repo}/branches/create")
def branch_create(repo: str, body: BranchCreateIn):
    _guard(_svc(repo).create_branch, body.name, body.base)
    return {"ok": True}


class BranchDeleteIn(BaseModel):
    name: str
    force: bool = False


@router.post("/git/{repo}/branches/delete")
def branch_delete(repo: str, body: BranchDeleteIn):
    def run():
        repo_manager.remove_worktree(repo, body.name)
        repo_manager.service(repo).delete_branch(body.name, body.force)
    _guard(run)
    return {"ok": True}


class MergeIn(BaseModel):
    name: str
    into: Optional[str] = None


@router.post("/git/{repo}/merge")
def merge(repo: str, body: MergeIn):
    return {"output": _guard(_wsvc(repo, body.into).merge, body.name)}


# ------------------------------------------------------- Git Smart HTTP -----

_SERVICES = {"git-upload-pack", "git-receive-pack"}


def _pkt_line(data: str) -> bytes:
    payload = data.encode()
    return f"{len(payload) + 4:04x}".encode() + payload


def _repo_path(name: str):
    svc = repo_manager.service(name) if repo_manager.exists(name) else None
    if svc is None:
        raise HTTPException(status_code=404, detail=f"Repository '{name}' not found")
    return svc.repo_path


@smart_http.get("/{name}.git/info/refs")
def info_refs(name: str, service: str = Query(...)):
    if service not in _SERVICES:
        raise HTTPException(status_code=400, detail="Unsupported service")
    path = _repo_path(name)
    proc = subprocess.run(
        ["git", service.removeprefix("git-"), "--stateless-rpc", "--advertise-refs", str(path)],
        capture_output=True,
    )
    body = _pkt_line(f"# service={service}\n") + b"0000" + proc.stdout
    return Response(
        content=body,
        media_type=f"application/x-{service}-advertisement",
        headers={"Cache-Control": "no-cache"},
    )


def _sync_worktree_after_push(name: str) -> None:
    """Align the worktree with the first pushed branch on a fresh repo.

    A new server repo has an unborn HEAD (e.g. `main` with no commits), while
    the client may push `master` — receive.denyCurrentBranch=updateInstead
    then never touches the worktree. If HEAD is unborn and branches exist,
    switch HEAD to the pushed branch and reset the worktree to it.
    """
    try:
        repo = repo_manager.service(name).open()
        try:
            _ = repo.head.commit  # raises on an unborn branch
            return  # HEAD is fine — updateInstead already handled the worktree
        except Exception:  # noqa: BLE001
            pass
        branches = [h.name for h in repo.heads]
        if not branches:
            return
        target = next((b for b in ("main", "master") if b in branches), branches[0])
        repo.git.symbolic_ref("HEAD", f"refs/heads/{target}")
        repo.git.reset("--hard")
    except Exception:  # noqa: BLE001 — a push must never fail because of this
        pass


def _pushed_branches(body: bytes) -> list[tuple[str, bool]]:
    """Разбор команд receive-pack: [(ветка, удаляется?), ...].

    Первые pkt-line до flush-pkt содержат «old new refname[\0caps]».
    Удаление ветки — это push с new == 40 нулей.
    """
    out: list[tuple[str, bool]] = []
    i = 0
    while i + 4 <= len(body):
        try:
            n = int(body[i : i + 4], 16)
        except ValueError:
            break
        if n == 0:  # flush-pkt: дальше идёт PACK
            break
        line = body[i + 4 : i + n].split(b"\0", 1)[0].strip()
        i += n
        parts = line.split(b" ")
        if len(parts) == 3 and parts[2].startswith(b"refs/heads/"):
            branch = parts[2][len(b"refs/heads/"):].decode("utf-8", errors="replace")
            deleting = parts[1] == b"0" * 40
            out.append((branch, deleting))
    return out


def _after_push(name: str, body: bytes) -> None:
    """После push: убрать worktree удалённых веток, пересобрать запушенные."""
    try:
        from ..build.service import get_build_manager

        for branch, deleting in _pushed_branches(body):
            if deleting:
                repo_manager.remove_worktree(name, branch)
            elif settings_store.get("auto_build"):
                try:
                    get_build_manager(name, branch).start(note=f"⚡ автосборка после git push в «{branch}»")
                except GitError:
                    pass
    except Exception:  # noqa: BLE001 — a push must never fail because of this
        pass


async def _rpc(request: Request, name: str, service: str) -> StreamingResponse:
    path = _repo_path(name)
    body = await request.body()
    proc = subprocess.Popen(
        ["git", service.removeprefix("git-"), "--stateless-rpc", str(path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(body)
    proc.stdin.close()

    def stream():
        assert proc.stdout is not None
        while chunk := proc.stdout.read(65536):
            yield chunk
        code = proc.wait()
        if service == "git-receive-pack" and code == 0:
            _sync_worktree_after_push(name)
            _after_push(name, body)

    return StreamingResponse(
        stream(),
        media_type=f"application/x-{service}-result",
        headers={"Cache-Control": "no-cache"},
    )


@smart_http.post("/{name}.git/git-upload-pack")
async def upload_pack(name: str, request: Request):
    return await _rpc(request, name, "git-upload-pack")


@smart_http.post("/{name}.git/git-receive-pack")
async def receive_pack(name: str, request: Request):
    return await _rpc(request, name, "git-receive-pack")
