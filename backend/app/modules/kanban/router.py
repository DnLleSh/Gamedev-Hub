"""Kanban board API. Four fixed columns, ordered tasks, SQLite storage."""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from ...db import connect

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

COLUMNS = ["backlog", "in_progress", "testing", "done"]


class ChecklistItem(BaseModel):
    text: str
    done: bool = False


class TaskIn(BaseModel):
    branch: str | None = None
    title: str = Field(min_length=1, max_length=300)
    description: str = ""
    column: str = "backlog"
    checklist: list[ChecklistItem] = []
    tags: list[str] = []


class TaskPatch(BaseModel):
    branch: str | None = None
    title: Optional[str] = None
    description: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = None
    tags: Optional[list[str]] = None


class MoveIn(BaseModel):
    column: str
    index: int = Field(ge=0)


def _row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "column": row["column"],
        "position": row["position"],
        "checklist": json.loads(row["checklist"]),
        "tags": json.loads(row["tags"]),
        "branch": row["branch"] if "branch" in row.keys() else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _check_column(column: str) -> None:
    if column not in COLUMNS:
        raise HTTPException(status_code=400, detail=f"Unknown column: {column}")


@router.get("/tasks")
def list_tasks() -> list[dict[str, Any]]:
    with connect() as conn:
        rows = conn.execute('SELECT * FROM tasks ORDER BY "column", position').fetchall()
    return [_row_to_task(r) for r in rows]


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn) -> dict[str, Any]:
    _check_column(body.column)
    with connect() as conn:
        pos = conn.execute(
            'SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE "column" = ?', (body.column,)
        ).fetchone()[0]
        cur = conn.execute(
            'INSERT INTO tasks (title, description, "column", position, checklist, tags, branch) VALUES (?,?,?,?,?,?,?)',
            (
                body.title,
                body.description,
                body.column,
                pos,
                json.dumps([c.model_dump() for c in body.checklist]),
                json.dumps(body.tags),
                body.branch,
            ),
        )
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_task(row)


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskPatch) -> dict[str, Any]:
    fields: list[str] = []
    values: list[Any] = []
    if body.title is not None:
        fields.append("title = ?")
        values.append(body.title)
    if body.description is not None:
        fields.append("description = ?")
        values.append(body.description)
    if body.checklist is not None:
        fields.append("checklist = ?")
        values.append(json.dumps([c.model_dump() for c in body.checklist]))
    if body.tags is not None:
        fields.append("tags = ?")
        values.append(json.dumps(body.tags))
    if body.branch is not None:
        fields.append("branch = ?")
        values.append(body.branch or None)
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")
    fields.append("updated_at = datetime('now')")
    with connect() as conn:
        cur = conn.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id = ?", (*values, task_id))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row)


@router.post("/tasks/{task_id}/move")
def move_task(task_id: int, body: MoveIn) -> dict[str, Any]:
    """Move a task to (column, index) and re-number both affected columns."""
    _check_column(body.column)
    with connect() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        source = row["column"]

        ids = [
            r["id"]
            for r in conn.execute(
                'SELECT id FROM tasks WHERE "column" = ? AND id != ? ORDER BY position',
                (body.column, task_id),
            )
        ]
        index = min(body.index, len(ids))
        ids.insert(index, task_id)
        for pos, tid in enumerate(ids):
            conn.execute(
                'UPDATE tasks SET position = ?, "column" = ?, updated_at = datetime(\'now\') WHERE id = ?',
                (pos, body.column, tid),
            )
        if source != body.column:
            rest = conn.execute(
                'SELECT id FROM tasks WHERE "column" = ? ORDER BY position', (source,)
            ).fetchall()
            for pos, r in enumerate(rest):
                conn.execute("UPDATE tasks SET position = ? WHERE id = ?", (pos, r["id"]))
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return _row_to_task(row)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int) -> Response:
    with connect() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
    return Response(status_code=204)
