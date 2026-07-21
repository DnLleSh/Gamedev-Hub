"""GameDev Hub — self-hosted control room for a Godot game project.

Modules (each fully independent, wired together only here):
  * gitmod  — repository browser + Git Smart HTTP for the team
  * kanban  — task board (SQLite)
  * build   — HTML5 export runner with live logs
  * wiki    — Markdown docs stored inside the repo

The exported game is served under /play/ with COOP/COEP headers:
Godot 4 web builds need SharedArrayBuffer, which browsers only enable
in a cross-origin-isolated context.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import init_db
from .modules.build.router import router as build_router
from .modules.gitmod.router import router as git_router, smart_http as git_smart_http
from .modules.kanban.router import router as kanban_router
from .modules.wiki.router import router as wiki_router


class GameIsolationHeaders(BaseHTTPMiddleware):
    """COOP/COEP + no-store for everything under /play/."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/play"):
            response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
            response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
            response.headers["Cache-Control"] = "no-store"
        return response


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="GameDev Hub", version="1.0.0")

    app.add_middleware(GameIsolationHeaders)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # LAN-only service
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(git_router)
    app.include_router(git_smart_http)
    app.include_router(kanban_router)
    app.include_router(build_router)
    app.include_router(wiki_router)

    # -- exported game -------------------------------------------------------
    # /play/<repo>/<ветка>/ — HTML5-билд конкретной ветки ('/' в имени ветки -> '~')
    @app.get("/play/{repo}/{branch}/{path:path}")
    def play(repo: str, branch: str, path: str):
        from .modules.build.service import output_dir
        from .modules.gitmod.service import GitError

        try:
            root = output_dir(repo, branch.replace("~", "/")).resolve()
        except GitError:
            raise HTTPException(status_code=404, detail="Not found")
        target = (root / (path or "index.html")).resolve()
        if target.is_dir():
            target = target / "index.html"
        if not str(target).startswith(str(root)) or not target.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(target)

    # -- compiled frontend (production) ---------------------------------------
    dist = settings.frontend_dist
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            # Служебные URL не маскируем интерфейсом (честный 404),
            # но одноимённые страницы SPA (/git, /play) должны открываться по F5.
            first = full_path.split("/", 1)[0]
            if first in {"api", "assets"}:
                raise HTTPException(status_code=404, detail="Not found")
            if first == "play" and "/" in full_path:  # файлы игры: /play/<repo>/<ветка>/...
                raise HTTPException(status_code=404, detail="Not found")
            if first == "git" and ".git" in full_path:  # Smart HTTP: /git/<имя>.git/...
                raise HTTPException(status_code=404, detail="Not found")
            candidate = dist / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            index = dist / "index.html"
            if index.exists():
                return FileResponse(index)
            raise HTTPException(status_code=404)

    return app


app = create_app()
