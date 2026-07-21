/** Kanban-типы — точное зеркало схем бэкенда (modules/kanban/router.py). */

/** Фиксированный набор колонок; порядок = порядок отображения на доске. */
export const COLUMNS = ["backlog", "in_progress", "testing", "done"] as const;
export type ColumnId = (typeof COLUMNS)[number];

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  column: ColumnId;
  position: number;
  checklist: ChecklistItem[];
  tags: string[];
  branch: string | null;
  created_at: string;
  updated_at: string;
}

/** Тело POST /tasks. */
export interface TaskCreate {
  title: string;
  description?: string;
  column?: ColumnId;
  checklist?: ChecklistItem[];
  tags?: string[];
  branch?: string | null;
}

/** Тело PATCH /tasks/{id} — все поля опциональны. */
export interface TaskPatch {
  title?: string;
  description?: string;
  checklist?: ChecklistItem[];
  tags?: string[];
  branch?: string | null;
}

export const COLUMN_META: Record<ColumnId, { title: string; accent: string }> = {
  backlog: { title: "Бэклог", accent: "bg-muted-foreground/40" },
  in_progress: { title: "В работе", accent: "bg-chart-2" },
  testing: { title: "Тестирование", accent: "bg-amber-500" },
  done: { title: "Готово", accent: "bg-emerald-500" },
};
