import { FolderGit2 } from "lucide-react"
import { useRepo } from "@/lib/repo"

/** Раздел «Репозиторий» — заглушка Этапа 0.
 *  На Этапе 2 здесь появится файловый рабочий стол (дерево + CodeMirror). */
export function RepositoryView() {
  const { repo, branch } = useRepo()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border bg-muted text-muted-foreground">
        <FolderGit2 className="size-6" />
      </div>
      <div className="text-base font-medium">Рабочий стол кода</div>
      <p className="max-w-md text-sm text-muted-foreground">
        Репозиторий <span className="font-mono text-foreground">{repo}</span>
        {branch && <> · ветка <span className="font-mono text-foreground">{branch}</span></>}.
        Дерево файлов и редактор появятся здесь на следующем этапе.
      </p>
    </div>
  )
}
