/**
 * `monitoring.*` procedures — data-pipeline freshness + admin panel.
 *
 * Reads from two sources:
 *   1. data-pipeline `/health` (proxied) for the daily / weekly cron
 *      job state — last refresh / next refresh / failure tallies.
 *   2. Local Postgres for table-level freshness (max trade_date,
 *      max financials period_end, audit_log activity).
 *
 * The procedure is deliberately read-only; M18's admin /monitoring
 * page just displays. Alerting / paging is M19+ if anyone wants it.
 */

import { z } from "zod";

import { env } from "../lib/env.js";
import { publicProcedure, router } from "./init.js";

const FeedHealth = z.object({
  name: z.string(),
  status: z.enum(["ok", "stale", "down", "not_configured"]),
  detail: z.string(),
  last_success_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  age_hours: z.number().nullable(),
});

const HealthResponse = z.object({
  generated_at: z.date(),
  feeds: z.array(FeedHealth),
  table_counts: z.object({
    sectors: z.number(),
    equities: z.number(),
    equity_quotes: z.number(),
    equity_financials: z.number(),
    graph_nodes: z.number(),
    graph_edges: z.number(),
    scenarios: z.number(),
    audit_logs: z.number(),
  }),
});

interface DataPipelineHealth {
  status?: string;
  last_refresh?: string | null;
  next_refresh_at?: string | null;
  last_financials_refresh?: string | null;
  next_runs?: Record<string, string>;
}

async function fetchDataPipelineHealth(): Promise<DataPipelineHealth | null> {
  const base = env().DATA_PIPELINE_URL;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/health`, {
      // 2s ceiling — health proxies shouldn't tarry.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DataPipelineHealth;
  } catch {
    return null;
  }
}

function ageHours(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function statusFromAge(
  iso: string | null | undefined,
  staleHours: number,
): "ok" | "stale" | "down" {
  if (!iso) return "down";
  const h = ageHours(iso);
  if (h === null) return "down";
  return h <= staleHours ? "ok" : "stale";
}

export const monitoringRouter = router({
  health: publicProcedure
    .output(HealthResponse)
    .query(async ({ ctx }) => {
      const [pipelineHealth, counts] = await Promise.all([
        fetchDataPipelineHealth(),
        Promise.all([
          ctx.prisma.sector.count(),
          ctx.prisma.sectorEquity.count(),
          ctx.prisma.equityQuote.count(),
          ctx.prisma.equityFinancial.count(),
          ctx.prisma.graphNode.count(),
          ctx.prisma.graphEdge.count(),
          ctx.prisma.scenario.count(),
          ctx.prisma.auditLog.count(),
        ]),
      ]);
      const [
        sectors,
        equities,
        equity_quotes,
        equity_financials,
        graph_nodes,
        graph_edges,
        scenarios,
        audit_logs,
      ] = counts;

      const feeds: z.infer<typeof FeedHealth>[] = [];

      // Daily quote-snapshot feed
      if (pipelineHealth === null) {
        feeds.push({
          name: "data-pipeline / quote snapshot",
          status: env().DATA_PIPELINE_URL ? "down" : "not_configured",
          detail: env().DATA_PIPELINE_URL
            ? "data-pipeline /health 응답 없음"
            : "DATA_PIPELINE_URL 환경변수 미설정",
          last_success_at: null,
          next_run_at: null,
          age_hours: null,
        });
      } else {
        const last = pipelineHealth.last_refresh ?? null;
        const next =
          pipelineHealth.next_runs?.refresh_quotes ??
          pipelineHealth.next_refresh_at ??
          null;
        const ageH = ageHours(last);
        const status = statusFromAge(last, 30); // ~24h cron + 6h grace
        feeds.push({
          name: "data-pipeline / quote snapshot",
          status,
          detail:
            status === "ok"
              ? "최신 데이터"
              : status === "stale"
                ? `${ageH ? ageH.toFixed(1) : "?"}시간 전 마지막 성공`
                : "한 번도 성공한 적이 없음",
          last_success_at: last,
          next_run_at: next,
          age_hours: ageH,
        });

        // Weekly financials feed
        const last_fin = pipelineHealth.last_financials_refresh ?? null;
        const next_fin = pipelineHealth.next_runs?.refresh_financials ?? null;
        const ageHf = ageHours(last_fin);
        const statusFin = statusFromAge(last_fin, 24 * 8); // weekly cron + 24h grace
        feeds.push({
          name: "data-pipeline / financials",
          status: statusFin,
          detail:
            statusFin === "ok"
              ? "최신 데이터"
              : statusFin === "stale"
                ? `${ageHf ? (ageHf / 24).toFixed(1) : "?"}일 전 마지막 성공`
                : "한 번도 성공한 적이 없음",
          last_success_at: last_fin,
          next_run_at: next_fin,
          age_hours: ageHf,
        });
      }

      // DB-side freshness: latest equity_quotes trade_date
      const latestQuote = await ctx.prisma.equityQuote.findFirst({
        orderBy: { trade_date: "desc" },
        select: { trade_date: true },
      });
      const latestQuoteIso = latestQuote?.trade_date.toISOString() ?? null;
      const quoteAge = ageHours(latestQuoteIso);
      feeds.push({
        name: "postgres / equity_quotes (latest bar)",
        status: statusFromAge(latestQuoteIso, 30 * 24), // 30d threshold for weekend / holiday tolerance
        detail: latestQuoteIso
          ? `latest bar ${latestQuoteIso.slice(0, 10)}`
          : "no bars",
        last_success_at: latestQuoteIso,
        next_run_at: null,
        age_hours: quoteAge,
      });

      // Latest financials period_end
      const latestFin = await ctx.prisma.equityFinancial.findFirst({
        orderBy: { period_end: "desc" },
        select: { period_end: true, source: true },
      });
      const latestFinIso = latestFin?.period_end.toISOString() ?? null;
      const finAge = ageHours(latestFinIso);
      feeds.push({
        name: "postgres / equity_financials (latest quarter)",
        status: statusFromAge(latestFinIso, 24 * 120), // 120d (a quarter + grace)
        detail: latestFinIso
          ? `latest period ${latestFinIso.slice(0, 10)} · source ${latestFin?.source ?? "?"}`
          : "no rows",
        last_success_at: latestFinIso,
        next_run_at: null,
        age_hours: finAge,
      });

      // Most recent audit_log entry
      const latestAudit = await ctx.prisma.auditLog.findFirst({
        orderBy: { created_at: "desc" },
        select: { created_at: true, action: true },
      });
      const latestAuditIso = latestAudit?.created_at.toISOString() ?? null;
      feeds.push({
        name: "audit_logs (last mutation)",
        status: latestAuditIso ? "ok" : "stale",
        detail: latestAudit
          ? `last action: ${latestAudit.action}`
          : "no mutations recorded",
        last_success_at: latestAuditIso,
        next_run_at: null,
        age_hours: ageHours(latestAuditIso),
      });

      // M39f — Signal ingest feed. Pulls /jobs/signal-ingest/last from
      // data-pipeline. 404 = never run; non-200 = pipeline degraded.
      const dataPipelineBase = env().DATA_PIPELINE_URL;
      let signalLastIso: string | null = null;
      let signalDetail = "";
      let signalStatus: "ok" | "stale" | "down" | "not_configured" =
        "not_configured";
      if (!dataPipelineBase) {
        signalDetail = "DATA_PIPELINE_URL 환경변수 미설정";
      } else {
        try {
          const res = await fetch(`${dataPipelineBase}/jobs/signal-ingest/last`, {
            signal: AbortSignal.timeout(2000),
          });
          if (res.status === 404) {
            signalStatus = "stale";
            signalDetail = "signal-ingest 한 번도 실행되지 않음";
          } else if (!res.ok) {
            signalStatus = "down";
            signalDetail = `data-pipeline /jobs/signal-ingest/last → ${res.status}`;
          } else {
            const body = (await res.json()) as {
              finished_at?: string | null;
              signals_written?: number;
              extractor_failures?: number;
              extractor_total_cost_usd?: number;
            };
            signalLastIso = body.finished_at ?? null;
            signalStatus = statusFromAge(signalLastIso, 30); // ~24h cron + grace
            signalDetail =
              `signals_written=${body.signals_written ?? 0}` +
              (body.extractor_failures
                ? ` · extractor_failures=${body.extractor_failures}`
                : "") +
              ` · cost=$${(body.extractor_total_cost_usd ?? 0).toFixed(4)}`;
          }
        } catch {
          signalStatus = "down";
          signalDetail = "data-pipeline /jobs/signal-ingest/last 응답 없음";
        }
      }
      feeds.push({
        name: "data-pipeline / signal ingest",
        status: signalStatus,
        detail: signalDetail,
        last_success_at: signalLastIso,
        next_run_at: null,
        age_hours: ageHours(signalLastIso),
      });

      return {
        generated_at: new Date(),
        feeds,
        table_counts: {
          sectors,
          equities,
          equity_quotes,
          equity_financials,
          graph_nodes,
          graph_edges,
          scenarios,
          audit_logs,
        },
      };
    }),
});
