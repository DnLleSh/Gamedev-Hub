import { File } from "lucide-react"
import { useRepo } from "@/lib/repo"

/** Раздел «Документация» — заглушка Этапа 0 (wiki переносится на Этапе 1). */
export function DocumentationView() {
  const { repo } = useRepo()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border bg-muted text-muted-foreground">
        <File className="size-6" />
      </div>
      <div className="text-base font-medium">Документация</div>
      <p className="max-w-md text-sm text-muted-foreground">
        Wiki-страницы репозитория <span className="font-mono text-foreground">{repo}</span> появятся здесь.
      </p>
    </div>
  )
}
