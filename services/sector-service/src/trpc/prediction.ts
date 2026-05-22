/**
 * `prediction.*` procedures — community predictions + leaderboard.
 *
 * Resolution (computing actual_close + score once target_date passes)
 * is a follow-up cron in validation-service. M32 v1 ships the
 * write/read paths; resolved counts stay at 0 until the cron is up.
 */

import { readFileSync } from "node:fs";

import { GoogleGenAI } from "@google/genai";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "../lib/env.js";
import { publicProcedure, router } from "./init.js";

/**
 * Pull `project_id` out of the SA JSON at the configured path. Cached
 * per-process so we don't hit the disk on every analyzeRationale call.
 *
 * Falls back to the explicit GOOGLE_CLOUD_PROJECT env var if the SA
 * file isn't readable — keeps the dev story tolerant of partially
 * configured environments.
 */
let _cachedSaProjectId: string | null | undefined;
function readSaProjectId(saPath: string | undefined): string | null {
  if (_cachedSaProjectId !== undefined) return _cachedSaProjectId;
  if (!saPath) {
    _cachedSaProjectId = null;
    return null;
  }
  try {
    const raw = readFileSync(saPath, "utf8");
    const parsed = JSON.parse(raw) as { project_id?: unknown };
    _cachedSaProjectId =
      typeof parsed.project_id === "string" && parsed.project_id.length > 0
        ? parsed.project_id
        : null;
  } catch {
    _cachedSaProjectId = null;
  }
  return _cachedSaProjectId;
}

const HORIZONS = ["1d", "1w", "1m"] as const;

const RationaleAnalysisSchema = z.object({
  thesis_summary: z.string(),
  supporting_factors: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
    }),
  ),
  risk_factors: z.array(
    z.object({
      title: z.string(),
      detail: z.string(),
    }),
  ),
  confidence: z.enum(["low", "med", "high"]),
  // True once the user has manually edited the LLM output. Persisted
  // so the analysis card can show "✏️ 편집됨" when applicable.
  edited_by_user: z.boolean().default(false),
});

export type RationaleAnalysis = z.infer<typeof RationaleAnalysisSchema>;

const PredictionOut = z.object({
  id: z.string(),
  user_id: z.string(),
  equity_id: z.string(),
  horizon: z.enum(HORIZONS),
  predicted_pct: z.number(),
  anchor_close: z.number(),
  predicted_close: z.number(),
  anchor_at: z.date(),
  target_date: z.date(),
  scenario_id: z.string().nullable(),
  rationale: z.string().nullable(),
  resolved: z.boolean(),
  created_at: z.date(),
});

const PredictionWithMetaOut = PredictionOut.extend({
  user_label: z.string(),
  rationale_analysis: RationaleAnalysisSchema.nullable(),
  scenario: z
    .object({
      id: z.string(),
      name: z.string(),
      override_count: z.number().int(),
    })
    .nullable(),
  equity: z.object({
    id: z.string(),
    ticker: z.string(),
    company_name: z.string(),
    company_name_local: z.string().nullable(),
    sector_slug: z.string(),
    iso_country: z.string(),
    currency: z.string().nullable(),
  }),
  result: z
    .object({
      actual_close: z.number(),
      actual_pct: z.number(),
      abs_error: z.number(),
      score: z.number(),
      resolved_at: z.date(),
    })
    .nullable(),
});

const LeaderboardRowOut = z.object({
  user_id: z.string(),
  user_label: z.string(),
  total_points: z.number(),
  predictions_made: z.number().int(),
  predictions_resolved: z.number().int(),
  hit_rate_pct: z.number(),
  current_streak: z.number().int(),
  best_streak: z.number().int(),
});

function horizonToDays(h: (typeof HORIZONS)[number]): number {
  return h === "1d" ? 1 : h === "1w" ? 7 : 30;
}

function requireUser(ctx: import("./context.js").Context) {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "예측 등록은 로그인이 필요합니다.",
    });
  }
  return ctx.user;
}

/**
 * `Prediction.scenario_id` is a free-form FK-less string column (M33),
 * so Prisma can't `include` it. Batch-fetch the matching Scenario rows
 * in one query and build a lookup so each prediction row can carry a
 * compact `{id, name, override_count}` summary.
 */
async function loadScenarios(
  ctx: import("./context.js").Context,
  ids: (string | null)[],
): Promise<Map<string, { id: string; name: string; override_count: number }>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map();
  const rows = await ctx.prisma.scenario.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, driver_overrides: true },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        override_count: Object.keys(
          (r.driver_overrides ?? {}) as Record<string, unknown>,
        ).length,
      },
    ]),
  );
}

/**
 * Coerce the JSONB stored in `predictions.rationale_analysis` back
 * into the validated TypeScript shape. Returns null on shape
 * mismatch (legacy / corrupted rows) rather than throwing — the UI
 * just hides the card in that case.
 */
function parseStoredAnalysis(raw: unknown): z.infer<typeof RationaleAnalysisSchema> | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = RationaleAnalysisSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const predictionRouter = router({
  create: publicProcedure
    .input(
      z.object({
        equity_id: z.string().min(1),
        horizon: z.enum(HORIZONS),
        predicted_pct: z.number().finite().min(-90).max(900),
        rationale: z.string().max(4000).optional(),
        scenario_id: z.string().min(1).optional(),
        // M33: optional LLM-generated analysis (or user-edited variant
        // of it). Persisted as JSONB; the analyze procedure builds the
        // initial value but the client can edit before submitting.
        rationale_analysis: RationaleAnalysisSchema.optional(),
      }),
    )
    .output(PredictionOut)
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      const equity = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.equity_id },
        select: { id: true, last_close_local: true },
      });
      if (!equity) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `equity ${input.equity_id}`,
        });
      }
      const anchor = equity.last_close_local;
      if (anchor === null || anchor === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "이 종목의 현재 가격이 적재되지 않아 예측을 등록할 수 없습니다.",
        });
      }
      const predictedClose = anchor * (1 + input.predicted_pct / 100);
      const targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() + horizonToDays(input.horizon));

      const prediction = await ctx.prisma.prediction.create({
        data: {
          user_id: user.id,
          equity_id: equity.id,
          horizon: input.horizon,
          predicted_pct: input.predicted_pct,
          anchor_close: anchor,
          predicted_close: predictedClose,
          target_date: targetDate,
          scenario_id: input.scenario_id ?? null,
          rationale: input.rationale ?? null,
          rationale_analysis: input.rationale_analysis
            ? (input.rationale_analysis as object)
            : undefined,
        },
      });

      // Bump the user_scores counter.
      await ctx.prisma.userScore.upsert({
        where: { user_id: user.id },
        create: { user_id: user.id, predictions_made: 1 },
        update: { predictions_made: { increment: 1 } },
      });

      await ctx.prisma.auditLog.create({
        data: {
          action: "prediction.create",
          sector_slug: null,
          payload: {
            equity_id: equity.id,
            horizon: input.horizon,
            predicted_pct: input.predicted_pct,
          },
          author_label: user.label,
        },
      });

      return prediction as z.infer<typeof PredictionOut>;
    }),

  listMine: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(50) }).default({}))
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      if (!ctx.user) return [];
      const rows = await ctx.prisma.prediction.findMany({
        where: { user_id: ctx.user.id },
        include: {
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      const scenarioMap = await loadScenarios(
        ctx,
        rows.map((r) => r.scenario_id),
      );
      return rows.map((r) => ({
        ...r,
        user_label: ctx.user!.label,
        rationale_analysis: parseStoredAnalysis(r.rationale_analysis),
        scenario: r.scenario_id ? scenarioMap.get(r.scenario_id) ?? null : null,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  listForEquity: publicProcedure
    .input(
      z.object({
        equity_id: z.string().min(1),
        limit: z.number().int().positive().max(50).default(20),
      }),
    )
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.prediction.findMany({
        where: { equity_id: input.equity_id },
        include: {
          user: { select: { name: true, email: true } },
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      const scenarioMap = await loadScenarios(
        ctx,
        rows.map((r) => r.scenario_id),
      );
      return rows.map((r) => ({
        ...r,
        user_label: r.user.name ?? r.user.email,
        rationale_analysis: parseStoredAnalysis(r.rationale_analysis),
        scenario: r.scenario_id ? scenarioMap.get(r.scenario_id) ?? null : null,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  recent: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).default({}))
    .output(z.array(PredictionWithMetaOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.prediction.findMany({
        include: {
          user: { select: { name: true, email: true } },
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
        orderBy: { created_at: "desc" },
        take: input.limit,
      });
      const scenarioMap = await loadScenarios(
        ctx,
        rows.map((r) => r.scenario_id),
      );
      return rows.map((r) => ({
        ...r,
        user_label: r.user.name ?? r.user.email,
        rationale_analysis: parseStoredAnalysis(r.rationale_analysis),
        scenario: r.scenario_id ? scenarioMap.get(r.scenario_id) ?? null : null,
      })) as z.infer<typeof PredictionWithMetaOut>[];
    }),

  /**
   * M33b: per-prediction permalink. Public read — anyone with the link
   * can see anyone else's prediction. Returns 404 when the ID doesn't
   * resolve, so the permalink page can render a clean not-found state
   * instead of falling through to a 500.
   */
  getOne: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(PredictionWithMetaOut)
    .query(async ({ ctx, input }) => {
      const row = await ctx.prisma.prediction.findUnique({
        where: { id: input.id },
        include: {
          user: { select: { name: true, email: true } },
          equity: {
            select: {
              id: true,
              ticker: true,
              company_name: true,
              company_name_local: true,
              sector_slug: true,
              iso_country: true,
              currency: true,
            },
          },
          result: true,
        },
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `prediction ${input.id} not found`,
        });
      }
      const scenarioMap = await loadScenarios(ctx, [row.scenario_id]);
      return {
        ...row,
        user_label: row.user.name ?? row.user.email,
        rationale_analysis: parseStoredAnalysis(row.rationale_analysis),
        scenario: row.scenario_id ? scenarioMap.get(row.scenario_id) ?? null : null,
      } as z.infer<typeof PredictionWithMetaOut>;
    }),

  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).default({}))
    .output(z.array(LeaderboardRowOut))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.userScore.findMany({
        orderBy: { total_points: "desc" },
        take: input.limit,
        include: { user: { select: { name: true, email: true } } },
      });
      return rows.map((r) => ({
        user_id: r.user_id,
        user_label: r.user.name ?? r.user.email,
        total_points: r.total_points,
        predictions_made: r.predictions_made,
        predictions_resolved: r.predictions_resolved,
        hit_rate_pct: r.hit_rate_pct,
        current_streak: r.current_streak,
        best_streak: r.best_streak,
      }));
    }),

  myScore: publicProcedure
    .output(LeaderboardRowOut.nullable())
    .query(async ({ ctx }) => {
      if (!ctx.user) return null;
      const score = await ctx.prisma.userScore.findUnique({
        where: { user_id: ctx.user.id },
        include: { user: { select: { name: true, email: true } } },
      });
      if (!score) return null;
      return {
        user_id: score.user_id,
        user_label: score.user.name ?? score.user.email,
        total_points: score.total_points,
        predictions_made: score.predictions_made,
        predictions_resolved: score.predictions_resolved,
        hit_rate_pct: score.hit_rate_pct,
        current_streak: score.current_streak,
        best_streak: score.best_streak,
      };
    }),

  /**
   * M33: one-shot Claude Sonnet call. Reads the user's rationale +
   * optionally a linked scenario's driver overrides, asks Claude to
   * extract a structured analysis (thesis, supporting factors, risk
   * factors, confidence). Returns the analysis; persistence happens
   * later inside `prediction.create`.
   *
   * Auth-required so anonymous users can't burn tokens. Free-tier
   * users currently get a cap of 5 analyses per day (enforced via
   * audit_log scan to keep this slice simple); premium gets unlimited.
   */
  analyzeRationale: publicProcedure
    .input(
      z.object({
        equity_id: z.string().min(1),
        horizon: z.enum(HORIZONS),
        predicted_pct: z.number().finite(),
        rationale: z.string().max(4000),
        scenario_id: z.string().min(1).optional(),
      }),
    )
    .output(RationaleAnalysisSchema)
    .mutation(async ({ ctx, input }) => {
      const user = requireUser(ctx);
      const cfg = env();
      const vertexConfigured =
        cfg.GOOGLE_GENAI_USE_VERTEXAI && !!cfg.GOOGLE_CLOUD_PROJECT;
      if (!vertexConfigured && !cfg.GEMINI_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "AI 분석이 아직 구성되지 않았습니다. (Vertex AI 또는 GEMINI_API_KEY 미설정 — 관리자에게 문의해 주세요.)",
        });
      }

      // Soft per-user rate limit on this single endpoint.
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recent = await ctx.prisma.auditLog.count({
        where: {
          action: "prediction.analyzeRationale",
          author_label: user.label,
          created_at: { gte: dayAgo },
        },
      });
      const dailyCap = user.id ? 30 : 0;
      if (recent >= dailyCap) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "오늘 AI 분석 한도에 도달했습니다 (24시간당 30회). 내일 다시 시도해 주세요.",
        });
      }

      const equity = await ctx.prisma.sectorEquity.findUnique({
        where: { id: input.equity_id },
        select: {
          id: true,
          ticker: true,
          company_name: true,
          company_name_local: true,
          sector_slug: true,
          last_close_local: true,
          currency: true,
        },
      });
      if (!equity) {
        throw new TRPCError({ code: "NOT_FOUND", message: `equity ${input.equity_id}` });
      }

      let scenarioContext = "";
      if (input.scenario_id) {
        const scenario = await ctx.prisma.scenario.findUnique({
          where: { id: input.scenario_id },
          select: { name: true, sector_slug: true, driver_overrides: true, notes: true },
        });
        if (scenario && scenario.sector_slug === equity.sector_slug) {
          const overrides = scenario.driver_overrides as Record<string, unknown>;
          const formatted = Object.entries(overrides)
            .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
            .slice(0, 30)
            .map(([k, v]) => `- ${k} = ${v}`)
            .join("\n");
          scenarioContext = `## 연결된 시나리오: "${scenario.name}"\n드라이버 가정:\n${formatted || "(없음)"}\n${scenario.notes ? `노트: ${scenario.notes}\n` : ""}`;
        }
      }

      const horizonKo =
        input.horizon === "1d" ? "1일" : input.horizon === "1w" ? "1주" : "1달";
      const userPrompt = `투자자의 예측 근거를 분석해 주세요.

## 종목
${equity.ticker} (${equity.company_name_local ?? equity.company_name}) · 섹터 ${equity.sector_slug}
현재가 ${equity.last_close_local ?? "?"} ${equity.currency ?? ""}

## 예측
${horizonKo} 뒤 ${input.predicted_pct >= 0 ? "+" : ""}${input.predicted_pct.toFixed(1)}%

${scenarioContext}

## 사용자가 작성한 근거
${input.rationale || "(비어 있음)"}

위 정보를 토대로 다음 JSON 형식으로 응답해 주세요. 한국어로 작성하고, 각 필드는 1-2 문장으로 간결하게.

{
  "thesis_summary": "이 예측의 핵심 가설을 1-2문장으로 요약",
  "supporting_factors": [
    { "title": "짧은 제목", "detail": "왜 이 요인이 예측에 유리한지 1-2문장" },
    ...최대 4개
  ],
  "risk_factors": [
    { "title": "짧은 제목", "detail": "이 예측을 깰 수 있는 요인 1-2문장" },
    ...최대 3개
  ],
  "confidence": "low" | "med" | "high",
  "edited_by_user": false
}

JSON 만 출력해 주세요 (다른 텍스트 금지).`;

      // Gemini 3.5 Flash on Vertex AI. JSON-only mode + maxOutputTokens
      // cap keeps the call cheap (≈ $0.005 per analyze) and shaped for
      // the RationaleAnalysisSchema downstream zod validation.
      //
      // Auth mode: Vertex AI when configured. We prefer the explicit
      // project_id from the SA JSON itself (matches the Python wrapper
      // path) and fall back to GOOGLE_CLOUD_PROJECT. Credentials are
      // picked up via google-auth-library through the
      // GOOGLE_APPLICATION_CREDENTIALS env var. Falls back to API key
      // for dev contributors without GCP access.
      const saProjectId = vertexConfigured
        ? readSaProjectId(cfg.GOOGLE_APPLICATION_CREDENTIALS)
        : null;
      const projectId =
        saProjectId ?? (cfg.GOOGLE_CLOUD_PROJECT as string | undefined) ?? "";
      const ai = vertexConfigured
        ? new GoogleGenAI({
            vertexai: true,
            project: projectId,
            location: cfg.GOOGLE_CLOUD_LOCATION,
          })
        : new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY! });
      let text: string;
      try {
        const resp = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction:
              "You are an investment analyst. Respond ONLY with valid JSON. No markdown, no commentary, just the JSON object the user asks for.",
            responseMimeType: "application/json",
            maxOutputTokens: 1024,
          },
        });
        const out = resp.text;
        if (typeof out !== "string" || out.length === 0) {
          throw new Error("empty response from Gemini");
        }
        text = out.trim();
      } catch (e) {
        ctx.log.error({ err: e }, "analyzeRationale: Gemini call failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI 분석 중 오류가 발생했습니다. 다시 시도해 주세요.",
        });
      }

      // Strip ```json fences if the model added them.
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        ctx.log.warn({ text: cleaned.slice(0, 200) }, "analyzeRationale: bad JSON");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.",
        });
      }
      const validated = RationaleAnalysisSchema.safeParse(parsed);
      if (!validated.success) {
        ctx.log.warn(
          { issues: validated.error.issues, text: cleaned.slice(0, 200) },
          "analyzeRationale: schema mismatch",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "AI 응답 형식이 잘못되었습니다. 다시 시도해 주세요.",
        });
      }

      await ctx.prisma.auditLog.create({
        data: {
          action: "prediction.analyzeRationale",
          sector_slug: equity.sector_slug,
          payload: {
            equity_id: equity.id,
            scenario_id: input.scenario_id ?? null,
            confidence: validated.data.confidence,
          },
          author_label: user.label,
        },
      });

      return { ...validated.data, edited_by_user: false };
    }),
});
