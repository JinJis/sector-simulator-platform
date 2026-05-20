# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for services/agent-orchestration (FastAPI + uv workspace).
#   target=dev   → bind-mount source, uvicorn --reload
#   target=prod  → frozen install, uvicorn (no reload), non-root user
#
# Build context MUST be the repository root so the uv workspace can resolve
# `platform-sdk` and `agent-tools` (workspace members).

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
# Workspace root + every member manifest in the agent-orchestration dependency
# closure: platform-sdk, agent-tools, and agent-orchestration itself.
COPY pyproject.toml ./pyproject.toml
COPY packages/sdk-python/pyproject.toml ./packages/sdk-python/pyproject.toml
COPY packages/agent-tools/pyproject.toml ./packages/agent-tools/pyproject.toml
COPY services/agent-orchestration/pyproject.toml ./services/agent-orchestration/pyproject.toml
COPY uv.lock* ./
# Source for editable workspace installs.
COPY packages/sdk-python ./packages/sdk-python
COPY packages/agent-tools ./packages/agent-tools
COPY services/agent-orchestration ./services/agent-orchestration
# Prompts must be readable inside the container — see prompts.py loader.
COPY prompts ./prompts
RUN --mount=type=cache,target=/root/.cache/uv \
    if [ -f uv.lock ]; then \
      uv sync --frozen --package agent-orchestration; \
    else \
      uv sync --package agent-orchestration; \
    fi

FROM deps AS dev
ENV PYTHONPATH=/repo/services/agent-orchestration:/repo/packages/agent-tools:/repo/packages/sdk-python \
    PROMPTS_DIR=/repo/prompts
WORKDIR /repo/services/agent-orchestration
EXPOSE 8002
CMD ["uvicorn", "agent_orchestration.main:app", \
     "--host", "0.0.0.0", "--port", "8002", \
     "--reload", \
     "--reload-dir", "/repo/services/agent-orchestration", \
     "--reload-dir", "/repo/packages/agent-tools", \
     "--reload-dir", "/repo/prompts"]

FROM deps AS prod
ENV PROMPTS_DIR=/repo/prompts
RUN groupadd --system app && useradd --system --gid app --home /home/app app \
 && mkdir -p /home/app && chown -R app:app /home/app /opt/venv /repo
USER app
WORKDIR /repo/services/agent-orchestration
EXPOSE 8002
CMD ["uvicorn", "agent_orchestration.main:app", \
     "--host", "0.0.0.0", "--port", "8002"]
