import * as React from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  FileText, FilePlus, Save, Eye, Pencil, Columns2, GitCommitHorizontal,
  Loader2, Plus, Trash2, BookOpen,
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
import { useRepo } from "@/lib/repo"
import { wikiApi } from "@/modules/wiki/api"

type Mode = "read" | "edit" | "split"

/** Шаблоны новых страниц (README: GameDesign, Story, Mechanics, Ideas, Roadmap). */
const TEMPLATES: { id: string; label: string; body: (title: string) => string }[] = [
  { id: "blank", label: "Пусто", body: (t) => `# ${t}\n\n` },
  { id: "GameDesign", label: "Game Design", body: (t) => `# ${t}\n\n## Обзор\n\n## Основной цикл\n\n## Механики\n\n## Прогрессия\n\n## Референсы\n` },
  { id: "Story", label: "Сюжет", body: (t) => `# ${t}\n\n## Логлайн\n\n## Персонажи\n\n## Сеттинг\n\n## Арки\n` },
  { id: "Mechanics", label: "Механики", body: (t) => `# ${t}\n\n## Правила\n\n## Управление\n\n## Баланс\n\n## Крайние случаи\n` },
  { id: "Ideas", label: "Идеи", body: (t) => `# ${t}\n\n- [ ] \n- [ ] \n` },
  { id: "Roadmap", label: "Роадмап", body: (t) => `# ${t}\n\n## Сейчас\n\n## Следующее\n\n## Потом\n` },
]

const pretty = (name: string) => name.replace(/\.md$/i, "")

export function DocumentationView() {
  const { repo, branch } = useRepo()
  const wiki = React.useMemo(() => wikiApi(repo, branch), [repo, branch])

  const [pages, setPages] = React.useState<string[]>([])
  const [active, setActive] = React.useState<string | null>(null)
  const [content, setContent] = React.useState("")
  const [saved, setSaved] = React.useState("")
  const [mode, setMode] = React.useState<Mode>("split")
  const [autoCommit, setAutoCommit] = React.useState(false)
  const [loadingList, setLoadingList] = React.useState(true)
  const [loadingPage, setLoadingPage] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [toDelete, setToDelete] = React.useState<string | null>(null)

  const dirty = content !== saved

  const loadList = React.useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await wiki.list()
      setPages(res.pages)
      setActive((cur) => (cur && res.pages.includes(cur) ? cur : res.pages[0] ?? null))
      setError("")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить список страниц")
    } finally {
      setLoadingList(false)
    }
  }, [wiki])

  // смена репозитория/ветки — полный сброс
  React.useEffect(() => { setActive(null); setContent(""); setSaved(""); loadList() }, [loadList])

  // загрузка активной страницы
  React.useEffect(() => {
    if (!active) { setContent(""); setSaved(""); return }
    let cancelled = false
    setLoadingPage(true)
    wiki.get(active)
      .then((p) => { if (!cancelled) { setContent(p.content); setSaved(p.content) } })
      .catch((e) => { if (!cancelled) setError(e instanceof ApiError ? e.message : "Не удалось открыть страницу") })
      .finally(() => { if (!cancelled) setLoadingPage(false) })
    return () => { cancelled = true }
  }, [active, wiki])

  const save = React.useCallback(async () => {
    if (!active || saving) return
    setSaving(true); setError("")
    try {
      await wiki.save(active, content, autoCommit)
      setSaved(content)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }, [active, content, autoCommit, saving, wiki])

  // Ctrl/Cmd+S
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (dirty) save()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dirty, save])

  const createPage = async (name: string, templateId: string) => {
    const file = name.endsWith(".md") ? name : `${name}.md`
    const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]
    try {
      await wiki.save(file, tpl.body(pretty(file)), false)
      setCreating(false)
      await loadList()
      setActive(file)
      setMode("split")
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось создать страницу")
    }
  }

  const removePage = async (name: string) => {
    try {
      await wiki.remove(name)
      setToDelete(null)
      if (active === name) setActive(null)
      await loadList()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить")
    }
  }

  return (
    <div className="flex h-full w-full">
      {/* список страниц */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <BookOpen className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Wiki</span>
          <button
            onClick={() => setCreating(true)}
            className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Новая страница"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingList ? (
            <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
          ) : pages.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">Страниц пока нет</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {pages.map((p) => (
                <li key={p} className="group/item flex items-center">
                  <button
                    onClick={() => setActive(p)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      active === p ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-accent/60",
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{pretty(p)}</span>
                    {active === p && dirty && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />}
                  </button>
                  <button
                    onClick={() => setToDelete(p)}
                    className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition hover:text-destructive group-hover/item:opacity-100"
                    aria-label={`Удалить ${pretty(p)}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* редактор / предпросмотр */}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            {/* панель */}
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-sm font-medium">{pretty(active)}</span>
              {dirty && <span className="shrink-0 text-xs text-muted-foreground">· не сохранено</span>}

              <div className="ml-auto flex items-center gap-1.5">
                {/* режимы */}
                <div className="flex items-center rounded-lg border p-0.5">
                  {([
                    ["read", Eye, "Чтение"],
                    ["split", Columns2, "Сплит"],
                    ["edit", Pencil, "Редактор"],
                  ] as const).map(([m, Icon, label]) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      title={label}
                      className={cn(
                        "grid size-7 place-items-center rounded-md transition-colors",
                        mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  ))}
                </div>

                {/* авто-коммит */}
                <button
                  onClick={() => setAutoCommit((v) => !v)}
                  title={autoCommit ? "Коммитить при сохранении" : "Только запись на диск"}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                    autoCommit
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <GitCommitHorizontal className="size-3.5" />
                  <span className="hidden sm:inline">Коммит</span>
                </button>

                <Button size="sm" disabled={!dirty || saving} onClick={save}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  <span>Сохранить</span>
                </Button>
              </div>
            </div>

            {error && <div className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</div>}

            {/* тело */}
            {loadingPage ? (
              <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
            ) : (
              <div className="flex min-h-0 flex-1">
                {mode !== "read" && (
                  <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    spellCheck={false}
                    placeholder="# Заголовок…"
                    className={cn(
                      "min-h-0 flex-1 resize-none bg-background px-4 py-3 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground",
                      mode === "split" && "border-r",
                    )}
                  />
                )}
                {mode !== "edit" && (
                  <div className="wiki-prose min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {content.trim() ? (
                      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
                    ) : (
                      <p className="text-sm text-muted-foreground">Пустая страница.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-14 place-items-center rounded-2xl border bg-muted text-muted-foreground">
              <BookOpen className="size-6" />
            </div>
            <div className="text-base font-medium">Wiki репозитория <span className="font-mono">{repo}</span></div>
            <p className="max-w-sm text-sm text-muted-foreground">
              Markdown-страницы из каталога <span className="font-mono text-foreground">docs/</span>. Создайте первую страницу, чтобы начать.
            </p>
            <Button onClick={() => setCreating(true)}><FilePlus className="size-4" /> Новая страница</Button>
          </div>
        )}
      </div>

      <NewPageDialog
        open={creating}
        existing={pages}
        onClose={() => setCreating(false)}
        onCreate={createPage}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить страницу?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл <span className="font-mono text-foreground">{toDelete && pretty(toDelete)}</span> будет удалён из <span className="font-mono">docs/</span>. Историю git это не затрагивает.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => toDelete && removePage(toDelete)}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ── Диалог создания страницы ────────────────────────────────────────── */

function NewPageDialog({
  open, existing, onClose, onCreate,
}: {
  open: boolean
  existing: string[]
  onClose: () => void
  onCreate: (name: string, templateId: string) => void
}) {
  const [name, setName] = React.useState("")
  const [tpl, setTpl] = React.useState("blank")
  const [err, setErr] = React.useState("")

  React.useEffect(() => { if (open) { setName(""); setTpl("blank"); setErr("") } }, [open])

  const submit = () => {
    const n = name.trim()
    if (!n) { setErr("Введите имя"); return }
    if (!/^[\w .-]+$/u.test(n)) { setErr("Только буквы, цифры, пробел, точка, дефис"); return }
    const file = n.endsWith(".md") ? n : `${n}.md`
    if (existing.some((p) => p.toLowerCase() === file.toLowerCase())) { setErr("Такая страница уже есть"); return }
    onCreate(n, tpl)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая страница</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit() }}
            placeholder="GameDesign"
            className="h-9"
          />
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Шаблон</div>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTpl(t.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    tpl === t.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Сохранится как <span className="font-mono text-foreground">docs/{(name.trim() || "имя").replace(/\.md$/i, "")}.md</span></p>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={!name.trim()}>Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
