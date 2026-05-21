# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for services/data-pipeline (FastAPI + uv workspace).
#   target=dev   → bind-mount source, uvicorn --reload
#   target=prod  → frozen install, uvicorn (no reload), non-root user
#
# Build context MUST be the repository root so the uv workspace can resolve
# its members.

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
# Workspace root + every member manifest in data-pipeline's dependency
# closure. data-pipeline itself has no workspace package deps today
# (no platform-sdk / agent-tools imports yet) — but we still copy the
# workspace root pyproject.toml so uv recognizes the layout.
COPY pyproject.toml ./pyproject.toml
COPY services/data-pipeline/pyproject.toml ./services/data-pipeline/pyproject.toml
COPY uv.lock* ./
COPY services/data-pipeline ./services/data-pipeline
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -f uv.lock ]; then \
      uv sync --frozen --package data-pipeline; \
    else \
      uv sync --package data-pipeline; \
    fi

FROM deps AS dev
ENV PYTHONPATH=/repo/services/data-pipeline
WORKDIR /repo/services/data-pipeline
EXPOSE 8003
CMD ["uvicorn", "data_pipeline.main:app", \
     "--host", "0.0.0.0", "--port", "8003", \
     "--reload", \
     "--reload-dir", "/repo/services/data-pipeline"]

FROM deps AS prod
RUN groupadd --system app && useradd --system --gid app --home /home/app app \
 && mkdir -p /home/app && chown -R app:app /home/app /opt/venv /repo
USER app
WORKDIR /repo/services/data-pipeline
EXPOSE 8003
CMD ["uvicorn", "data_pipeline.main:app", \
     "--host", "0.0.0.0", "--port", "8003"]
