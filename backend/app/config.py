"""Application settings, driven entirely by environment variables."""
from __future__ import annotations

import os
from pathlib import Path


class Settings:
    """Central configuration. Every path is created on startup if missing."""

    def __init__(self) -> None:
        root = Path(os.environ.get("DATA_DIR", "./data")).resolve()

        # All repositories live here, one directory per repo.
        self.repos_dir: Path = Path(os.environ.get("REPOS_DIR", str(root / "repos"))).resolve()

        # Legacy single-repo path (pre-multi-repo layouts are migrated from it).
        self.legacy_repo_path: Path = Path(os.environ.get("REPO_PATH", str(root / "repo"))).resolve()

        # SQLite database for the kanban board.
        self.db_path: Path = Path(os.environ.get("DB_PATH", str(root / "hub.db"))).resolve()

        # Command executed by the "Build" button, run inside the repo.
        # For Godot this is typically:
        #   godot --headless --export-release "Web" build/web/index.html
        self.build_cmd: str = os.environ.get("BUILD_CMD", "bash build.sh")

        # Directory (relative to the game repo) with the exported HTML5 game.
        self.build_output_rel: str = os.environ.get("BUILD_OUTPUT", "build/web")

        # Directory (relative to the game repo) with wiki pages.
        self.docs_dir_rel: str = os.environ.get("DOCS_DIR", "docs")

        # Compiled frontend (served in production if present).
        self.frontend_dist: Path = Path(
            os.environ.get("FRONTEND_DIST", str(Path(__file__).parents[2] / "frontend" / "dist"))
        ).resolve()

        root.mkdir(parents=True, exist_ok=True)
        self.repos_dir.mkdir(parents=True, exist_ok=True)


settings = Settings()
