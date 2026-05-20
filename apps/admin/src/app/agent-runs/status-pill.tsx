interface Props {
  status: string;
}

const STYLES: Record<string, string> = {
  pending: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
  running: "border-cyan-700/60 bg-cyan-950/40 text-cyan-300",
  succeeded: "border-emerald-700/60 bg-emerald-950/40 text-emerald-300",
  failed: "border-rose-700/60 bg-rose-950/40 text-rose-300",
  cancelled: "border-amber-700/60 bg-amber-950/40 text-amber-300",
};

export function StatusPill({ status }: Props) {
  const cls = STYLES[status] ?? "border-neutral-700 bg-neutral-900 text-neutral-300";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {status === "running" && (
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
      )}
      {status}
    </span>
  );
}
