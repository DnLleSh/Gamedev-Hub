#!/usr/bin/env bash
# Пример build.sh — положите этот файл в корень репозитория игры.
# Кнопка «Собрать» в GameDev Hub выполняет его в корне репозитория.
set -euo pipefail

echo "==> Exporting Godot project to HTML5..."
mkdir -p build/web
# Keep Godot from importing previous builds back into the game.
touch build/.gdignore

# Требуется установленный Godot (headless) и настроенный export preset "Web"
# в project.godot (Project -> Export -> Add -> Web).
godot --headless --export-release "Web" build/web/index.html

echo "==> Done. Output: build/web/"
