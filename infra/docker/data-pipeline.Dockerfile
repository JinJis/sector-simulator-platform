# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for services/data-pipeline (FastAPI + uv workspace).
#   target=dev   → bind-mount source, uvicorn --reload
#   target=prod  → frozen install, uvicorn (no reload), non-root user
#
# Build context MUST be the repository root so the uv workspace can resolve
# its members (agent-tools is a workspace dep after the crawler merger).

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
# closure. After the crawler merger (commit 6/6), data-pipeline depends
# on agent-tools (DeepResearchClient + extractor HTTP client are wired
# in deep_research.* fetchers).
COPY pyproject.toml ./pyproject.toml
COPY packages/agent-tools/pyproject.toml ./packages/agent-tools/pyproject.toml
COPY services/data-pipeline/pyproject.toml ./services/data-pipeline/pyproject.toml
COPY uv.lock* ./
COPY packages/agent-tools ./packages/agent-tools
COPY services/data-pipeline ./services/data-pipeline
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -f uv.lock ]; then \
      uv sync --frozen --package data-pipeline; \
    else \
      uv sync --package data-pipeline; \
    fi

FROM deps AS dev
ENV PYTHONPATH=/repo/services/data-pipeline:/repo/packages/agent-tools
WORKDIR /repo/services/data-pipeline
EXPOSE 8003
CMD ["uvicorn", "data_pipeline.main:app", \
     "--host", "0.0.0.0", "--port", "8003", \
     "--reload", \
     "--reload-dir", "/repo/services/data-pipeline", \
     "--reload-dir", "/repo/packages/agent-tools"]

FROM deps AS prod
RUN groupadd --system app && useradd --system --gid app --home /home/app app \
 && mkdir -p /home/app && chown -R app:app /home/app /opt/venv /repo
USER app
WORKDIR /repo/services/data-pipeline
EXPOSE 8003
CMD ["uvicorn", "data_pipeline.main:app", \
     "--host", "0.0.0.0", "--port", "8003"]
