"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { runSim, type OutputSchema, type SimMetadata } from "@/lib/sim-client";

interface Props {
  meta: SimMetadata;
}

export function SimWorkspace({ meta }: Props) {
  const initial = useMemo(
    () => Object.fromEntries(meta.drivers.map((d) => [d.name, d.default])),
    [meta.drivers],
  );

  const [values, setValues] = useState<Record<string, number>>(initial);
  const [outputs, setOutputs] = useState<OutputSchema[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void runSim(meta.slug, values)
        .then((res) => {
          if (cancelled) return;
          setOutputs(res.outputs);
          setError(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "unknown error");
        });
    });
    return () => {
      cancelled = true;
    };
  }, [meta.slug, values]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
      <aside className="space-y-5">
        {meta.drivers.map((d) => {
          const current = values[d.name] ?? d.default;
          return (
            <div key={d.name}>
              <label className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{d.name}</span>
                <span className="text-neutral-400">
                  {current.toFixed(2)}
                  {d.unit && ` ${d.unit}`}
                </span>
              </label>
              <input
                type="range"
                min={d.min}
                max={d.max}
                step={(d.max - d.min) / 200}
                value={current}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [d.name]: Number(e.target.value),
                  }))
                }
                className="mt-2 w-full accent-cyan-400"
              />
              {d.description && (
                <p className="mt-1 text-xs text-neutral-500">{d.description}</p>
              )}
            </div>
          );
        })}
        {error && <p className="text-xs text-red-400">Error: {error}</p>}
        {isPending && (
          <p className="text-xs text-neutral-500">simulating…</p>
        )}
      </aside>
      <section className="space-y-4">
        {outputs.map((out) => (
          <OutputChart key={out.name} output={out} />
        ))}
        {outputs.length === 0 && !error && (
          <p className="text-sm text-neutral-500">시뮬레이션 실행 중…</p>
        )}
      </section>
    </div>
  );
}

function OutputChart({ output }: { output: OutputSchema }) {
  if (!output.series) {
    return (
      <div className="rounded border border-neutral-800 p-4 text-sm">
        {output.name}: {output.scalar} {output.unit}
      </div>
    );
  }
  const data = output.series.map((value, year) => ({ year, value }));
  return (
    <div className="rounded border border-neutral-800 p-4">
      <h2 className="mb-3 text-sm font-medium">
        {output.name}
        {output.unit && (
          <span className="ml-2 text-neutral-500">({output.unit})</span>
        )}
      </h2>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
            <XAxis dataKey="year" stroke="#737373" />
            <YAxis stroke="#737373" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0a0a0a",
                border: "1px solid #262626",
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
