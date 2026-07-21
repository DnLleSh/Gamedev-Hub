import * as React from "react"
import {
  Plus, X, Trash2, GripVertical, Tag as TagIcon, ListChecks, Loader2, SquareCheckBig,
} from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { kanbanApi } from "@/modules/kanban/api"
import { COLUMNS, COLUMN_META, type ChecklistItem, type ColumnId, type Task } from "@/modules/kanban/types"

/** Локальный перенос задачи между колонками с перенумерацией позиций (оптимистично). */
function reorder(tasks: Task[], dragId: number, toCol: ColumnId, toIndex: number): Task[] {
  const moving = tasks.find((t) => t.id === dragId)
  if (!moving) return tasks
  const others = tasks.filter((t) => t.id !== dragId)
  const target = others
    .filter((t) => t.column === toCol)
    .sort((a, b) => a.position - b.position)
  const clamped = Math.max(0, Math.min(toIndex, target.length))
  target.splice(clamped, 0, { ...moving, column: toCol })
  const renumbered = target.map((t, i) => ({ ...t, column: toCol, position: i }))
  const untouched = others.filter((t) => t.column !== toCol)
  return [...untouched, ...renumbered]
}

export function KanbanView() {
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [dragId, setDragId] = React.useState<number | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{ col: ColumnId; index: number } | null>(null)
  const [editor, setEditor] = React.useState<{ task: Task | null; column: ColumnId } | null>(null)

  const load = React.useCallback(async () => {
    try {
      setTasks(await kanbanApi.list())
      setError("")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить доску")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const byColumn = React.useMemo(() => {
    const map: Record<ColumnId, Task[]> = { backlog: [], in_progress: [], testing: [], done: [] }
    for (const t of tasks) map[t.column]?.push(t)
    for (const c of COLUMNS) map[c].sort((a, b) => a.position - b.position)
    return map
  }, [tasks])

  const drop = async (col: ColumnId, index: number) => {
    if (dragId == null) return
    const id = dragId
    setTasks((prev) => reorder(prev, id, col, index))
    setDragId(null)
    setDropTarget(null)
    try {
      await kanbanApi.move(id, col, index)
    } catch { /* восстановим правду ниже */ }
    load()
  }

  const removeTask = async (id: number) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    try { await kanbanApi.remove(id) } catch { load() }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* шапка */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold">Доска задач</h1>
        <span className="text-xs text-muted-foreground">{tasks.length} задач</span>
        <Button size="sm" className="ml-auto" onClick={() => setEditor({ task: null, column: "backlog" })}>
          <Plus className="size-4" /> <span>Новая задача</span>
        </Button>
      </div>

      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>
      )}

      {/* доска */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3 sm:gap-4 sm:p-4">
          {COLUMNS.map((col) => (
            <Column
              key={col}
              col={col}
              tasks={byColumn[col]}
              dragId={dragId}
              dropIndex={dropTarget?.col === col ? dropTarget.index : null}
              onHover={(index) => setDropTarget({ col, index })}
              onLeave={() => setDropTarget((d) => (d?.col === col ? null : d))}
              onDrop={(index) => drop(col, index)}
              onDragStart={setDragId}
              onDragEnd={() => { setDragId(null); setDropTarget(null) }}
              onAdd={() => setEditor({ task: null, column: col })}
              onOpen={(task) => setEditor({ task, column: task.column })}
            />
          ))}
        </div>
      )}

      {editor && (
        <TaskEditor
          task={editor.task}
          column={editor.column}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load() }}
          onDelete={editor.task ? () => { removeTask(editor.task!.id); setEditor(null) } : undefined}
        />
      )}
    </div>
  )
}

/* ── Колонка ─────────────────────────────────────────────────────────── */

interface ColumnProps {
  col: ColumnId
  tasks: Task[]
  dragId: number | null
  dropIndex: number | null
  onHover: (index: number) => void
  onLeave: () => void
  onDrop: (index: number) => void
  onDragStart: (id: number) => void
  onDragEnd: () => void
  onAdd: () => void
  onOpen: (task: Task) => void
}

function Column({
  col, tasks, dragId, dropIndex, onHover, onLeave, onDrop, onDragStart, onDragEnd, onAdd, onOpen,
}: ColumnProps) {
  const meta = COLUMN_META[col]
  const listRef = React.useRef<HTMLDivElement>(null)

  /** Индекс вставки среди карточек, исключая перетаскиваемую. */
  const indexAt = (clientY: number): number => {
    const cards = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [],
    ).filter((el) => Number(el.dataset.cardId) !== dragId)
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return cards.length
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (dragId == null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    onHover(indexAt(e.clientY))
  }

  // индикатор вставки рисуем перед карточкой №dropIndex (или в конце)
  const indicator = <div className="mx-0.5 h-0.5 rounded-full bg-primary" />

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", meta.accent)} />
        <span className="text-sm font-medium">{meta.title}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
        <button
          onClick={onAdd}
          className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Добавить задачу"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div
        ref={listRef}
        onDragOver={handleDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) onLeave()
        }}
        onDrop={(e) => { e.preventDefault(); onDrop(dropIndex ?? indexAt(e.clientY)) }}
        className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
      >
        {tasks.length === 0 && dropIndex == null && (
          <div className="grid flex-1 place-items-center py-6 text-xs text-muted-foreground">
            Перетащите сюда
          </div>
        )}
        {tasks.map((task, i) => (
          <React.Fragment key={task.id}>
            {dropIndex === i && dragId !== task.id && indicator}
            <Card
              task={task}
              dragging={dragId === task.id}
              onDragStart={() => onDragStart(task.id)}
              onDragEnd={onDragEnd}
              onOpen={() => onOpen(task)}
            />
          </React.Fragment>
        ))}
        {dropIndex != null && dropIndex >= tasks.length && indicator}
      </div>
    </div>
  )
}

/* ── Карточка ────────────────────────────────────────────────────────── */

function Card({
  task, dragging, onDragStart, onDragEnd, onOpen,
}: {
  task: Task
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const done = task.checklist.filter((c) => c.done).length
  return (
    <div
      data-card-id={task.id}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart() }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        "group cursor-pointer rounded-lg border bg-background p-2.5 shadow-sm transition-colors hover:border-ring/60",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
        <p className="min-w-0 flex-1 text-sm leading-snug break-words">{task.title}</p>
      </div>

      {(task.tags.length > 0 || task.checklist.length > 0 || task.branch) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5">
          {task.tags.map((t) => (
            <span key={t} className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground">
              {t}
            </span>
          ))}
          {task.branch && (
            <span className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              ⎇ {task.branch}
            </span>
          )}
          {task.checklist.length > 0 && (
            <span className={cn(
              "inline-flex items-center gap-1 text-[11px] tabular-nums",
              done === task.checklist.length ? "text-emerald-500" : "text-muted-foreground",
            )}>
              <SquareCheckBig className="size-3" /> {done}/{task.checklist.length}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Редактор задачи (создание + правка) ─────────────────────────────── */

const textareaCls =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function TaskEditor({
  task, column, onClose, onSaved, onDelete,
}: {
  task: Task | null
  column: ColumnId
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const [title, setTitle] = React.useState(task?.title ?? "")
  const [description, setDescription] = React.useState(task?.description ?? "")
  const [col, setCol] = React.useState<ColumnId>(task?.column ?? column)
  const [checklist, setChecklist] = React.useState<ChecklistItem[]>(task?.checklist ?? [])
  const [tags, setTags] = React.useState<string[]>(task?.tags ?? [])
  const [branch, setBranch] = React.useState(task?.branch ?? "")
  const [tagDraft, setTagDraft] = React.useState("")
  const [itemDraft, setItemDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState("")
  const [confirmDel, setConfirmDel] = React.useState(false)

  const addTag = () => {
    const t = tagDraft.trim().replace(/,$/, "")
    if (t && !tags.includes(t)) setTags((p) => [...p, t])
    setTagDraft("")
  }
  const addItem = () => {
    const t = itemDraft.trim()
    if (t) setChecklist((p) => [...p, { text: t, done: false }])
    setItemDraft("")
  }

  const save = async () => {
    if (!title.trim()) { setErr("Введите название"); return }
    setBusy(true); setErr("")
    try {
      const branchVal = branch.trim() || null
      if (task) {
        await kanbanApi.update(task.id, {
          title: title.trim(), description, checklist, tags, branch: branchVal,
        })
        if (col !== task.column) await kanbanApi.move(task.id, col, 9999)
      } else {
        await kanbanApi.create({
          title: title.trim(), description, column: col, checklist, tags, branch: branchVal,
        })
      }
      onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Не удалось сохранить")
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Задача" : "Новая задача"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название задачи"
            className="h-9 text-sm"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание (необязательно)"
            className={textareaCls}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Колонка
              <select
                value={col}
                onChange={(e) => setCol(e.target.value as ColumnId)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring"
              >
                {COLUMNS.map((c) => (
                  <option key={c} value={c}>{COLUMN_META[c].title}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              ⎇ ветка
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="—"
                className="h-8 w-32 rounded-lg border border-input bg-transparent px-2 font-mono text-sm outline-none focus-visible:border-ring"
              />
            </label>
          </div>

          {/* теги */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <TagIcon className="size-3.5" /> Теги
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                  {t}
                  <button onClick={() => setTags((p) => p.filter((x) => x !== t))} aria-label={`Убрать ${t}`}>
                    <X className="size-3 hover:text-destructive" />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag() }
                  else if (e.key === "Backspace" && !tagDraft && tags.length) {
                    setTags((p) => p.slice(0, -1))
                  }
                }}
                onBlur={addTag}
                placeholder="добавить…"
                className="h-6 w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {/* чек-лист */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ListChecks className="size-3.5" /> Чек-лист
              {checklist.length > 0 && (
                <span className="tabular-nums">
                  {checklist.filter((c) => c.done).length}/{checklist.length}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={(e) =>
                      setChecklist((p) => p.map((c, j) => (j === i ? { ...c, done: e.target.checked } : c)))
                    }
                    className="size-4 shrink-0 accent-primary"
                  />
                  <input
                    value={item.text}
                    onChange={(e) =>
                      setChecklist((p) => p.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)))
                    }
                    className={cn(
                      "h-7 flex-1 bg-transparent text-sm outline-none",
                      item.done && "text-muted-foreground line-through",
                    )}
                  />
                  <button
                    onClick={() => setChecklist((p) => p.filter((_, j) => j !== i))}
                    className="text-muted-foreground/60 hover:text-destructive"
                    aria-label="Удалить пункт"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              <input
                value={itemDraft}
                onChange={(e) => setItemDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem() } }}
                onBlur={addItem}
                placeholder="+ пункт списка"
                className="h-7 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          {onDelete ? (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDel(true)}>
              <Trash2 className="size-4" /> Удалить
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Отмена</Button>
            <Button disabled={busy || !title.trim()} onClick={save}>
              {busy && <Loader2 className="size-4 animate-spin" />} Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {onDelete && (
        <AlertDialog open={confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(false) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить задачу?</AlertDialogTitle>
              <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={onDelete}>
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Dialog>
  )
}
