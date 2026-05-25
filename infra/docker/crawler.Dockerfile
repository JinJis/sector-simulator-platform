# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for services/crawler (FastAPI + uv workspace).
#   target=dev   → bind-mount source, uvicorn --reload
#   target=prod  → frozen install, uvicorn (no reload), non-root user
#
# Build context MUST be the repository root so the uv workspace can resolve
# its members (agent-tools is a workspace dep).

ARG PYTHON_VERSION=3.12-slim-bookworm

FROM python:${PYTHON_VERSION} AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.5.4 /uv /usr/local/bin/uv
WORKDIR /repo

FROM base AS deps
# Workspace root + every member manifest in crawler's dependency closure.
# `agent-tools` is a workspace member so we copy its source + manifest.
COPY pyproject.toml ./pyproject.toml
COPY packages/agent-tools/pyproject.toml ./packages/agent-tools/pyproject.toml
COPY services/crawler/pyproject.toml ./services/crawler/pyproject.toml
COPY uv.lock* ./
COPY packages/agent-tools ./packages/agent-tools
COPY services/crawler ./services/crawler
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -f uv.lock ]; then \
      uv sync --frozen --package crawler; \
    else \
      uv sync --package crawler; \
    fi

FROM deps AS dev
ENV PYTHONPATH=/repo/services/crawler:/repo/packages/agent-tools
WORKDIR /repo/services/crawler
EXPOSE 8004
CMD ["uvicorn", "crawler.main:app", \
     "--host", "0.0.0.0", "--port", "8004", \
     "--reload", \
     "--reload-dir", "/repo/services/crawler", \
     "--reload-dir", "/repo/packages/agent-tools"]

FROM deps AS prod
RUN groupadd --system app && useradd --system --gid app --home /home/app app \
 && mkdir -p /home/app && chown -R app:app /home/app /opt/venv /repo
USER app
WORKDIR /repo/services/crawler
EXPOSE 8004
CMD ["uvicorn", "crawler.main:app", \
     "--host", "0.0.0.0", "--port", "8004"]
