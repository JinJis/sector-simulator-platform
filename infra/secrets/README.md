# `infra/secrets/`

Service account JSON keys land here. Mounted read-only into
`agent-orchestration` and `sector-service` containers at `/secrets/`
by `docker-compose.yml`.

**Gitignored.** Everything in this directory except `.gitkeep` and
this README is ignored by git (see `.gitignore`). Never commit a JSON
key.

## Vertex AI service account

Used by `LLMClient` (Python, `packages/agent-tools/agent_tools/llm_client.py`)
and `prediction.analyzeRationale` (TS, `services/sector-service/src/trpc/prediction.ts`).

**M35 update**: the same SA authenticates BOTH providers — Claude
(opus tier, via `anthropic[vertex]` → `AnthropicVertex`) and Gemini
(sonnet/haiku tiers, via `google-genai` → `genai.Client(vertexai=True,
credentials=...)`).

1. In Google Cloud Console, create or select a project that has the
   **Vertex AI API** enabled (APIs & Services → Library → "Vertex AI
   API" → Enable).
2. Enable Claude opus 4.7 in **Vertex AI Model Garden** for the same
   project (Model Garden → Anthropic → claude-opus-4.7 → Enable). The
   opus tier won't resolve without this.
3. IAM & Admin → Service Accounts → either reuse an existing SA or
   create one named e.g. `sector-simulator-vertex`.
4. Grant the role **Vertex AI User** (`roles/aiplatform.user`) on the
   project.
5. Keys tab → Add Key → JSON. Download the file.
6. Save it to this directory as `vertex-ai-sa.json` (literal filename —
   compose mounts that path). If you want a different filename, also
   update `GOOGLE_APPLICATION_CREDENTIALS` in `.env` / your shell.

## Environment

Set in `.env` at the repo root (copy from `.env.example`):

```
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=          # optional; auto-extracted from the SA JSON when blank
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=/secrets/vertex-ai-sa.json
```

`location="global"` is the multi-region endpoint that hosts both
Gemini 3.5-flash family and Claude opus 4.7 today. Pin a specific
region only if you need data-residency guarantees.

The `/secrets/` path is the in-container mount point. On the host,
the file lives at `infra/secrets/vertex-ai-sa.json` relative to the
repo root.

## Running outside Docker

If you run the Python services directly (`uv run uvicorn ...`) or
the TS services (`pnpm dev`) from the host, set
`GOOGLE_APPLICATION_CREDENTIALS` to the **absolute host path**:

```
export GOOGLE_APPLICATION_CREDENTIALS=$(pwd)/infra/secrets/vertex-ai-sa.json
```
