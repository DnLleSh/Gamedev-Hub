import * as React from "react"
import {
  Hammer, Play, RotateCw, Maximize, Square, ChevronDown, ExternalLink, Loader2, X, Zap,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useRepo } from "@/lib/repo"
import { cn } from "@/lib/utils"
import { formatDuration, timeAgo } from "@/lib/format"

interface BuildStatus {
  status: "idle" | "building" | "success" | "failed"
  build_id: number
  log: string[]
  log_length: number
  exit_code: number | null
  output_ready: boolean
  started_at: number | null
  finished_at: number | null
  duration: number | null
}

interface BuildConfig {
  build_cmd: string
  output_dir: string
  auto_build: boolean
}

const POLL_BUILDING = 700
const POLL_IDLE = 5000

const STATUS_META: Record<BuildStatus["status"], { label: string; dot: string; text: string }> = {
  idle: { label: "не запускалась", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  building: { label: "идёт сборка", dot: "bg-amber-500 animate-pulse", text: "text-amber-500" },
  success: { label: "успешна", dot: "bg-emerald-500", text: "text-emerald-500" },
  failed: { label: "с ошибкой", dot: "bg-destructive", text: "text-destructive" },
}

export function PlaygroundView() {
  const { repo, branch } = useRepo()
  const benc = branch.replace(/\//g, "~")

  const [status, setStatus] = React.useState<BuildStatus | null>(null)
  const [config, setConfig] = React.useState<BuildConfig | null>(null)
  const [log, setLog] = React.useState<string[]>([])
  const [running, setRunning] = React.useState(false)
  const [gameKey, setGameKey] = React.useState(0)
  const [logOpen, setLogOpen] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)

  const offsetRef = React.useRef(0)
  const prevStatusRef = React.useRef<string>("idle")
  const logEndRef = React.useRef<HTMLDivElement>(null)
  const stageRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    offsetRef.current = 0
    prevStatusRef.current = "idle"
    setLog([])
    setStatus(null)
    setRunning(false)
    setLogOpen(false)
    setGameKey((k) => k + 1)
    api.get<BuildConfig>(`/api/build/${repo}/config?branch=${encodeURIComponent(branch)}`)
      .then(setConfig).catch(() => {})
  }, [repo, branch])

  const poll = React.useCallback(async () => {
    try {
      const s = await api.get<BuildStatus>(
        `/api/build/${repo}/status?offset=${offsetRef.current}&branch=${encodeURIComponent(branch)}`,
      )
      offsetRef.current = s.log_length
      if (s.log.length > 0) setLog((p) => [...p, ...s.log].slice(-2000))
      setStatus(s)
      if (prevStatusRef.current === "building" && s.status === "success") {
        setGameKey((k) => k + 1)
        setRunning(true)
      }
      prevStatusRef.current = s.status
    } catch { /* retry */ }
  }, [repo, branch])

  React.useEffect(() => {
    poll()
    let id: number
    const loop = () => {
      const delay = prevStatusRef.current === "building" ? POLL_BUILDING : POLL_IDLE
      id = window.setTimeout(async () => { await poll(); loop() }, delay)
    }
    loop()
    return () => window.clearTimeout(id)
  }, [poll])

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" })
  }, [log])

  React.useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setFullscreen((f) => (f ? false : f)) }
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  const building = status?.status === "building"
  const ready = status?.output_ready ?? false

  const startBuild = async () => {
    setLog([]); offsetRef.current = 0; setLogOpen(true)
    await api.post(`/api/build/${repo}/start?branch=${encodeURIComponent(branch)}`)
    prevStatusRef.current = "building"
    poll()
  }

  const toggleFullscreen = async () => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); setFullscreen(false); return }
    if (el.requestFullscreen) {
      try { await el.requestFullscreen(); setFullscreen(true); return } catch { /* css fallback */ }
    }
    setFullscreen((f) => !f)
  }

  const meta = STATUS_META[status?.status ?? "idle"]

  return (
    <div className="flex h-full w-full flex-col">
      {/* панель управления */}
      <div className="flex flex-col gap-2 border-b w-full px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs text-muted-foreground">
            ⎇ {branch}
          </span>
          <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs font-medium", meta.text)}>
            <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
            <span className="truncate">
              {meta.label}
              {status?.status === "failed" && status.exit_code != null && ` (${status.exit_code})`}
            </span>
          </span>
          {status?.duration != null && status.status !== "idle" && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {formatDuration(status.duration)}
              {status.finished_at && !building &&
                ` · ${timeAgo(new Date(status.finished_at * 1000).toISOString())}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:ml-auto">
          <Button size="sm" className="flex-1 sm:flex-none" disabled={building} onClick={startBuild}>
            {building ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
            <span>Собрать</span>
          </Button>
          <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={!ready || running} onClick={() => setRunning(true)}>
            <Play className="size-4" /><span>Запустить</span>
          </Button>
          <Button size="sm" variant="outline" disabled={!ready} aria-label="Перезапустить"
            onClick={() => { setGameKey((k) => k + 1); setRunning(true) }}>
            <RotateCw className="size-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={!ready || !running} aria-label="Во весь экран"
            onClick={toggleFullscreen}>
            <Maximize className="size-4" />
          </Button>
          {building && (
            <Button size="sm" variant="destructive" aria-label="Остановить"
              onClick={() => api.post(`/api/build/${repo}/stop?branch=${encodeURIComponent(branch)}`)}>
              <Square className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* сцена игры */}
      <div
        ref={stageRef}
        className={cn(
          "relative bg-black",
          fullscreen && !document.fullscreenElement ? "fixed inset-0 z-50" : "min-h-0 flex-1",
        )}
      >
        {fullscreen && (
          <button
            onClick={toggleFullscreen}
            className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-md bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20"
            aria-label="Выйти из полного экрана"
          >
            <X className="size-4" />
          </button>
        )}

        {running && ready ? (
          <iframe
            key={gameKey}
            src={`/play/${repo}/${benc}/index.html?v=${gameKey}-${status?.build_id ?? 0}`}
            title="Game"
            className="size-full border-0"
            allow="autoplay; fullscreen; gamepad; xr-spatial-tracking"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            {ready ? (
              <>
                <p className="text-sm font-medium text-white/90">Билд готов к запуску</p>
                <Button onClick={() => setRunning(true)}>
                  <Play className="size-4" /> Запустить игру
                </Button>
              </>
            ) : (
              <p className="max-w-sm text-xs leading-relaxed text-white/40">
                Нажмите «Собрать» — команда{" "}
                <code className="rounded bg-white/10 px-1 py-0.5 font-mono">{config?.build_cmd ?? "…"}</code>{" "}
                выполнится в ветке <span className="font-mono text-white/60">{branch}</span>, результат появится в{" "}
                <code className="rounded bg-white/10 px-1 py-0.5 font-mono">{config?.output_dir ?? "build/web"}</code>.
              </p>
            )}
          </div>
        )}
      </div>

      {/* консоль сборки */}
      <div className={cn("shrink-0 border-t transition-[height]", logOpen ? "h-48 md:h-60" : "h-10")}>
        <div className="flex h-10 items-center gap-3 px-4">
          <button
            onClick={() => setLogOpen((o) => !o)}
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !logOpen && "-rotate-90")} />
            Лог сборки
            {status?.status === "failed" && <span className="text-destructive">· есть ошибки</span>}
          </button>

          <button
            onClick={async () => {
              if (!config) return
              const next = !config.auto_build
              setConfig({ ...config, auto_build: next })
              try { await api.patch("/api/build/config", { auto_build: next }) }
              catch { setConfig({ ...config }) }
            }}
            title={config?.auto_build ? "Автосборка при push включена" : "Автосборка при push выключена"}
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              config?.auto_build
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Zap className={cn("size-3.5", config?.auto_build && "fill-current")} />
            <span className="hidden sm:inline">Сборка при push</span>
          </button>

          <a
            href={`/play/${repo}/${benc}/index.html`}
            target="_blank"
            rel="noreferrer"
            title="Открыть игру в новой вкладке"
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
              !ready && "pointer-events-none opacity-40",
            )}
          >
            <ExternalLink className="size-3.5" /><span className="hidden sm:inline">Открыть</span>
          </a>
        </div>

        {logOpen && (
          <div className="h-[calc(100%-2.5rem)] overflow-y-auto bg-muted/40 px-4 py-2 font-mono text-xs leading-5">
            {log.length === 0 ? (
              <span className="text-muted-foreground">Лог пуст — запустите сборку.</span>
            ) : (
              log.map((line, i) => {
                const isErr = /error|fail|exception|traceback/i.test(line)
                const isCmd = line.startsWith("$ ")
                return (
                  <div key={i} className={cn(
                    "whitespace-pre-wrap break-all",
                    isErr && "text-destructive",
                    isCmd && "text-primary",
                    !isErr && !isCmd && "text-foreground/80",
                  )}>
                    {line}
                  </div>
                )
              })
            )}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
