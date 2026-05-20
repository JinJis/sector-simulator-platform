# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for services/simulation-service (FastAPI + uv workspace).
#   target=dev   → bind-mount source, uvicorn --reload
#   target=prod  → frozen install, uvicorn (no reload), non-root user
#
# Build context MUST be the repository root so the uv workspace can resolve
# `platform-sdk` (workspace member at packages/sdk-python).

ARG PYTHON_VERSION=3.12-slim-bookworm

# ---------- base: python + uv ----------
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
# Pinned uv release — bump deliberately.
COPY --from=ghcr.io/astral-sh/uv:0.5.4 /uv /usr/local/bin/uv
WORKDIR /repo

# ---------- deps: resolve the workspace ----------
FROM base AS deps
# Workspace root + both member manifests so uv builds the same env locally and in CI.
COPY pyproject.toml ./pyproject.toml
COPY packages/sdk-python/pyproject.toml ./packages/sdk-python/pyproject.toml
COPY services/simulation-service/pyproject.toml ./services/simulation-service/pyproject.toml
COPY uv.lock* ./
# Source must be present for editable workspace installs to succeed.
COPY packages/sdk-python ./packages/sdk-python
COPY services/simulation-service ./services/simulation-service
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -f uv.lock ]; then \
      uv sync --frozen --package simulation-service; \
    else \
      uv sync --package simulation-service; \
    fi

# ---------- dev: hot-reload target (local mode) ----------
FROM deps AS dev
ENV PYTHONPATH=/repo/services/simulation-service:/repo/packages/sdk-python
WORKDIR /repo/services/simulation-service
EXPOSE 8000
CMD ["uvicorn", "simulation_service.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--reload", \
     "--reload-dir", "/repo/services/simulation-service", \
     "--reload-dir", "/repo/packages/sdk-python"]

# ---------- prod: minimal runtime, no reload, non-root ----------
FROM deps AS prod
RUN groupadd --system app && useradd --system --gid app --home /home/app app \
 && mkdir -p /home/app && chown -R app:app /home/app /opt/venv /repo
USER app
WORKDIR /repo/services/simulation-service
EXPOSE 8000
CMD ["uvicorn", "simulation_service.main:app", \
     "--host", "0.0.0.0", "--port", "8000"]
