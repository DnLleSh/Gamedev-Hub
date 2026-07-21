import { api } from "../../lib/api";
import type { ColumnId, Task, TaskCreate, TaskPatch } from "./types";

/** Kanban глобален для хаба (не привязан к репозиторию), как и на бэкенде. */
export const kanbanApi = {
  list: () => api.get<Task[]>("/api/kanban/tasks"),
  create: (body: TaskCreate) => api.post<Task>("/api/kanban/tasks", body),
  update: (id: number, body: TaskPatch) => api.patch<Task>(`/api/kanban/tasks/${id}`, body),
  move: (id: number, column: ColumnId, index: number) =>
    api.post<Task>(`/api/kanban/tasks/${id}/move`, { column, index }),
  remove: (id: number) => api.delete<void>(`/api/kanban/tasks/${id}`),
};
