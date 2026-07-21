import { useIsMobile } from '@/hooks/use-mobile'

import { RepoProvider, useRepo, reposApi } from "./lib/repo";
import { ApiError } from "./lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Button, buttonVariants } from "./components/ui/button";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "./components/ui/context-menu";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "./components/ui/alert-dialog";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DocumentationView } from './components/views/documentation-view';
import { PlaygroundView } from './components/views/playground-view';
import { RepositoryView } from './components/views/repository-view';
import { KanbanView } from './components/views/kanban-view';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { File, Play, FolderGit2, Plus, Check, Trash2, GalleryVerticalEnd, KanbanSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import * as React from "react"
import { api } from './lib/api';

const workspaces = [
  { 
    title: "Игра", 
    url: "/play", 
    icon: Play, 
    component: PlaygroundView,
    matchPath: '/play'
  },
  { 
    title: "Доска", 
    url: "/board", 
    icon: KanbanSquare, 
    component: KanbanView,
    matchPath: '/board'
  },
  { 
    title: "Репозиторий", 
    url: "/git", 
    icon: FolderGit2, 
    component: RepositoryView,
    matchPath: '/git'
  },
  { 
    title: "Документация", 
    url: "/docs", 
    icon: File, 
    component: DocumentationView,
    matchPath: '/docs'
  },
];

export default function App() {
  return (
    <RepoProvider>
      <AppShell />
    </RepoProvider>
  );
}

function AppShell() {
  const isMobile = useIsMobile()

  const Shell = isMobile ? MobileShell : DesktopShell

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to={workspaces[0].url} replace />} />
        
        {workspaces.map((space) => {
          const ViewComponent = space.component;
          return (
            <Route 
              key={space.url} 
              path={`${space.url}/*`} 
              element={<ViewComponent />} 
            />
          );
        })}
      </Route>
    </Routes>
  )
}

function DesktopShell() {
  const location = useLocation();
  return (
    <SidebarProvider open={false}>
      <TooltipProvider>
        <div className="flex h-screen w-screen">
          <AppSidebar />
          <main key={location.pathname} className="flex-1 min-w-0 min-h-0 overflow-hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  )
}

export function MobileShell() {
  const { pathname } = useLocation()

  const activeWorkspace = workspaces.find(space => pathname.startsWith(space.matchPath))
  const title = activeWorkspace ? activeWorkspace.title : 'Заголовок'

  return (
    <SidebarProvider>
      <TooltipProvider>
        <div className="flex h-dvh w-full flex-col">
          <header className="flex h-14 items-center gap-3 border-b px-4">
            <SidebarTrigger />
            <h1 className="text-sm font-semibold">{title}</h1>
          </header>

          <AppSidebar />

          <main key={pathname} className="flex-1 min-h-0 overflow-hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <Outlet />
          </main>
        </div>
      </TooltipProvider>
    </SidebarProvider>
  )
}

function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [repos, setRepos] = React.useState<RepoMeta[]>([])
  const location = useLocation();
  const { setOpenMobile } = useSidebar();

  const loadRepos = React.useCallback(() => {
    api.get<{ repos: RepoMeta[] }>("/api/repos").then((r) => setRepos(r.repos)).catch(() => {})
  }, [])

  React.useEffect(() => { loadRepos() }, [loadRepos])

  return (
    <Sidebar collapsible="icon" className="h-screen border-r bg-muted" {...props}>
      <SidebarHeader className="px-2 pt-4 pb-2">
        <RepoSwitcher repos={repos} onChanged={loadRepos} />
      </SidebarHeader>
      <SidebarContent>
          <SidebarGroup className="pt-2">

          <SidebarGroupLabel className="mb-2 px-2 text-xs font-semibold text-muted-foreground group-data-[state=collapsed]:hidden">
            Проект
          </SidebarGroupLabel>
          
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {workspaces.map((item) => {
                const isActive = location.pathname.startsWith(item.url);

                return (
                  <SidebarMenuItem key={item.title}>
                    <Link to={item.url} onClick={() => setOpenMobile(false)}>
                      <SidebarMenuButton  
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        
                      </SidebarMenuButton>
                    </Link>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

interface RepoMeta {
  name: string
  branch: string | null
  branches: number
}

interface RepoSwitcherProps {
  repos: RepoMeta[]
  onChanged: () => void
}

export function RepoSwitcher({ repos, onChanged }: RepoSwitcherProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const { repo: activeRepo, select, reload } = useRepo()
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [toDelete, setToDelete] = React.useState<string | null>(null)

  const currentRepo = repos.find((r) => r.name === activeRepo) ?? repos[0]

  const handleSelect = (n: string) => {
    select(n)
    navigate("/play")
    setOpenMobile(false)
  }

  const create = async () => {
    setBusy(true); setError("")
    try {
      const n = name.trim()
      await reposApi.create(n)
      setName(""); setCreating(false)
      await reload(); onChanged()
      handleSelect(n)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось создать репозиторий")
    } finally { setBusy(false) }
  }

  const remove = async (n: string) => {
    try {
      await reposApi.remove(n)
      await reload(); onChanged()
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "Не удалось удалить")
    } finally {
      setToDelete(null)
    }
  }

  if (!currentRepo) return null

  return (
    <>
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <SidebarMenuButton
              size="lg"
              className="w-full min-w-0 justify-center group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <GalleryVerticalEnd className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{currentRepo.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {currentRepo.branch ? `ветка: ${currentRepo.branch}` : "пустой репозиторий"}
                </span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-64 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
              Репозитории
            </div>

            {repos.map((repo) => (
              <ContextMenu key={repo.name}>
                <ContextMenuTrigger
                  render={(props) => (
                    <div
                      {...props}
                      role="menuitem"
                      tabIndex={-1}
                      onClick={() => handleSelect(repo.name)}
                      className="relative flex cursor-default items-center gap-2 rounded-md p-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground"
                    >
                      <div className="flex flex-1 flex-col overflow-hidden">
                        <span className="truncate font-mono text-sm">{repo.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{repo.branch ?? "пустой"}</span>
                      </div>
                      {repo.name === currentRepo.name && <Check className="size-4 text-primary" />}
                    </div>
                  )}
                />
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleSelect(repo.name)}>
                    <FolderGit2 className="size-4" /> Открыть
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    disabled={repos.length <= 1}
                    onClick={() => setToDelete(repo.name)}
                  >
                    <Trash2 className="size-4" /> Удалить
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => setCreating(true)} className="gap-2 p-2 text-muted-foreground">
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="font-medium">Новый репозиторий</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>

    <Dialog open={creating} onOpenChange={(o) => { if (!o) setCreating(false) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый репозиторий</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create() }}
          className="flex flex-col gap-3"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="prototypes"
            className="h-9 rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Латиница, цифры, точки, дефисы. Клонирование: /git/&lt;имя&gt;.git
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
            <Button type="submit" disabled={busy || !name.trim()}>Создать</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить репозиторий?</AlertDialogTitle>
          <AlertDialogDescription>
            Репозиторий <span className="font-mono text-foreground">{toDelete}</span> и вся его
            история будут удалены безвозвратно. Это действие нельзя отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => toDelete && remove(toDelete)}
          >
            Удалить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}