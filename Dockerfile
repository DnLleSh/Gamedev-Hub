# Единая точка смены версии Godot — должна совпадать с версией проекта.
ARG GODOT_VERSION=4.7.1

# =========================================================
# Этап 1: Сборка фронтенда
# =========================================================
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# =========================================================
# Этап 2: Godot + экспортные шаблоны (кэшируется навсегда,
# пока не изменится GODOT_VERSION)
# =========================================================
FROM debian:bookworm-slim AS godot-builder
ARG GODOT_VERSION
RUN echo "force-unsafe-io" > /etc/dpkg/dpkg.cfg.d/force-unsafe-io \
 && apt-get update && apt-get install -y --no-install-recommends wget unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /godot-setup

# Сам движок (headless-совместимый официальный билд)
RUN wget -q https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip \
 && unzip -q Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip \
 && mkdir -p /export/bin \
 && mv Godot_v${GODOT_VERSION}-stable_linux.x86_64 /export/bin/godot \
 && chmod +x /export/bin/godot \
 && rm -f Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip

# Шаблоны экспорта (~1 ГБ — качается один раз)
RUN wget -q https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-stable/Godot_v${GODOT_VERSION}-stable_export_templates.tpz \
 && mkdir -p /export/templates/${GODOT_VERSION}.stable \
 && unzip -q Godot_v${GODOT_VERSION}-stable_export_templates.tpz \
 && mv templates/* /export/templates/${GODOT_VERSION}.stable/ \
 && rm -rf templates Godot_v${GODOT_VERSION}-stable_export_templates.tpz

# =========================================================
# Этап 3: Финальный runtime-образ
# =========================================================
FROM python:3.12-slim
ARG GODOT_VERSION

# git — для модуля репозитория и Smart HTTP;
# libfontconfig1 — убирает ошибки fontconfig у headless-Godot.
RUN echo "force-unsafe-io" > /etc/dpkg/dpkg.cfg.d/force-unsafe-io \
 && apt-get update \
 && apt-get install -y --no-install-recommends git bash libfontconfig1 \
 && rm -rf /var/lib/apt/lists/*

# Готовый Godot из этапа 2 — копируется мгновенно
COPY --from=godot-builder /export/bin/godot /usr/local/bin/godot
COPY --from=godot-builder /export/templates/${GODOT_VERSION}.stable /root/.local/share/godot/export_templates/${GODOT_VERSION}.stable

# Зависимости бэкенда
WORKDIR /srv/hub
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Код и собранный фронтенд
COPY backend/ backend/
COPY --from=frontend /app/dist frontend/dist

ENV DATA_DIR=/data \
    FRONTEND_DIST=/srv/hub/frontend/dist \
    PYTHONUNBUFFERED=1

EXPOSE 8000
WORKDIR /srv/hub/backend
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
