"use client";

import type { ProposalTargetKind } from "@/lib/community-proposal-client";

export function StepPayload({
  targetKind,
  payload,
  onChange,
}: {
  targetKind: ProposalTargetKind;
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-neutral-100">
          상세 정보를 채워주세요
        </h2>
        <p className="mt-1 text-[12px] text-neutral-500">
          이 값들은 admin 승인 시 그대로 DB에 반영됩니다. 잘 모르는 항목은
          비워두면 admin이 채워 넣습니다.
        </p>
      </header>
      <Form targetKind={targetKind} payload={payload} onChange={onChange} />
    </div>
  );
}

function Form({
  targetKind,
  payload,
  onChange,
}: {
  targetKind: ProposalTargetKind;
  payload: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  function patch(key: string, value: unknown) {
    onChange({ ...payload, [key]: value });
  }

  switch (targetKind) {
    case "add_driver":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="이름 (snake_case)"
            value={(payload.name as string) ?? ""}
            placeholder="rad_hard_chip_yield_pct"
            mono
            onChange={(v) => patch("name", v)}
          />
          <TextField
            label="그룹"
            value={(payload.group as string) ?? ""}
            placeholder="Compute / Demand / Costs"
            onChange={(v) => patch("group", v)}
          />
          <TextField
            label="단위"
            value={(payload.unit as string) ?? ""}
            placeholder="% / $/kg / units"
            onChange={(v) => patch("unit", v)}
          />
          <NumberField
            label="기본값"
            value={(payload.default as number) ?? 0}
            onChange={(v) => patch("default", v)}
          />
          <NumberField
            label="최솟값"
            value={(payload.min as number) ?? 0}
            onChange={(v) => patch("min", v)}
          />
          <NumberField
            label="최댓값"
            value={(payload.max as number) ?? 0}
            onChange={(v) => patch("max", v)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="설명"
              value={(payload.description as string) ?? ""}
              placeholder="이 드라이버가 무엇을 조정하는지 한두 문장으로"
              onChange={(v) => patch("description", v)}
            />
          </div>
        </div>
      );
    case "add_equity":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Ticker"
            value={(payload.ticker as string) ?? ""}
            placeholder="2330"
            mono
            onChange={(v) => patch("ticker", v)}
          />
          <TextField
            label="Exchange"
            value={(payload.exchange as string) ?? ""}
            placeholder="TWSE / NASDAQ / KOSPI"
            onChange={(v) => patch("exchange", v)}
          />
          <TextField
            label="회사명"
            value={(payload.company_name as string) ?? ""}
            placeholder="Taiwan Semiconductor"
            onChange={(v) => patch("company_name", v)}
          />
          <TextField
            label="ISO 국가 (2자 대문자)"
            value={(payload.iso_country as string) ?? ""}
            placeholder="TW"
            mono
            onChange={(v) => patch("iso_country", v.toUpperCase().slice(0, 2))}
          />
          <NumberField
            label="섹터 노출 %"
            value={(payload.sector_exposure_pct as number) ?? 50}
            min={0}
            max={100}
            onChange={(v) => patch("sector_exposure_pct", v)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="포함 근거"
              value={(payload.rationale as string) ?? ""}
              placeholder="왜 이 종목이 이 섹터의 핵심 swing 종목인지 한 문단"
              onChange={(v) => patch("rationale", v)}
            />
          </div>
        </div>
      );
    case "add_capability":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Key (snake_case)"
            value={(payload.key as string) ?? ""}
            placeholder="quantum_error_correction"
            mono
            onChange={(v) => patch("key", v)}
          />
          <TextField
            label="이름"
            value={(payload.name as string) ?? ""}
            placeholder="Quantum error correction"
            onChange={(v) => patch("name", v)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="설명"
              value={(payload.description as string) ?? ""}
              placeholder="이 capability가 기술적으로 무엇인지"
              onChange={(v) => patch("description", v)}
            />
          </div>
          <div className="sm:col-span-2">
            <TextAreaField
              label="비전에 왜 필요한가"
              value={(payload.rationale as string) ?? ""}
              placeholder="이 capability가 익숙하지 않을 때 비전 전체에 미치는 영향"
              onChange={(v) => patch("rationale", v)}
            />
          </div>
          <NumberField
            label="가중치 (0.02-0.50)"
            value={(payload.weight as number) ?? 0.1}
            min={0.02}
            max={0.5}
            step={0.01}
            onChange={(v) => patch("weight", v)}
          />
          <div />
          <NumberField
            label="초기 Technical (0-100)"
            value={(payload.initial_technical as number) ?? 50}
            min={0}
            max={100}
            onChange={(v) => patch("initial_technical", v)}
          />
          <NumberField
            label="초기 Economic"
            value={(payload.initial_economic as number) ?? 50}
            min={0}
            max={100}
            onChange={(v) => patch("initial_economic", v)}
          />
          <NumberField
            label="초기 Regulatory"
            value={(payload.initial_regulatory as number) ?? 50}
            min={0}
            max={100}
            onChange={(v) => patch("initial_regulatory", v)}
          />
          <NumberField
            label="초기 Supply"
            value={(payload.initial_supply as number) ?? 50}
            min={0}
            max={100}
            onChange={(v) => patch("initial_supply", v)}
          />
        </div>
      );
    case "add_risk":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Key"
            value={(payload.key as string) ?? ""}
            placeholder="itar_export_controls"
            mono
            onChange={(v) => patch("key", v)}
          />
          <TextField
            label="이름"
            value={(payload.name as string) ?? ""}
            placeholder="ITAR export controls"
            onChange={(v) => patch("name", v)}
          />
          <SelectField
            label="Category"
            value={(payload.category as string) ?? "political"}
            options={[
              "political",
              "legal",
              "supply",
              "safety",
              "environmental",
              "financial",
              "social",
            ]}
            onChange={(v) => patch("category", v)}
          />
          <SelectField
            label="Severity"
            value={(payload.severity as string) ?? "medium"}
            options={["low", "medium", "high", "critical"]}
            onChange={(v) => patch("severity", v)}
          />
          <SelectField
            label="Likelihood"
            value={(payload.likelihood as string) ?? "medium"}
            options={["low", "medium", "high"]}
            onChange={(v) => patch("likelihood", v)}
          />
          <SelectField
            label="Time horizon"
            value={(payload.time_horizon as string) ?? "3y"}
            options={["immediate", "1y", "3y", "5y", "10y"]}
            onChange={(v) => patch("time_horizon", v)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="설명"
              value={(payload.description as string) ?? ""}
              placeholder="이 위험이 비전에 어떻게 영향을 미치는지"
              onChange={(v) => patch("description", v)}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="영향 capability keys (콤마 구분)"
              value={
                Array.isArray(payload.affected_capability_keys)
                  ? (payload.affected_capability_keys as string[]).join(", ")
                  : ""
              }
              placeholder="rad_hard_compute, downlink_capacity"
              mono
              onChange={(v) =>
                patch(
                  "affected_capability_keys",
                  v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </div>
        </div>
      );
    case "add_actor":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Key (snake_case)"
            value={(payload.key as string) ?? ""}
            placeholder="tsmc"
            mono
            onChange={(v) => patch("key", v)}
          />
          <TextField
            label="이름"
            value={(payload.name as string) ?? ""}
            placeholder="Taiwan Semiconductor"
            onChange={(v) => patch("name", v)}
          />
          <TextField
            label="ISO 국가 (2자)"
            value={(payload.iso_country as string) ?? ""}
            placeholder="TW"
            mono
            onChange={(v) => patch("iso_country", v.toUpperCase().slice(0, 2))}
          />
          <SelectField
            label="Category"
            value={(payload.category as string) ?? "public_corp"}
            options={[
              "public_corp",
              "private_startup",
              "government_lab",
              "national_lab",
              "academic_lab",
              "standards_body",
              "ngo",
            ]}
            onChange={(v) => patch("category", v)}
          />
          <SelectField
            label="Stage"
            value={(payload.stage as string) ?? "commercial"}
            options={["research", "pilot", "commercial", "scaling"]}
            onChange={(v) => patch("stage", v)}
          />
          <NumberField
            label="Relevance (0-100)"
            value={(payload.relevance as number) ?? 70}
            min={0}
            max={100}
            onChange={(v) => patch("relevance", v)}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="Blurb (1줄 설명)"
              value={(payload.blurb as string) ?? ""}
              placeholder="Foundry leader; 3nm 양산."
              onChange={(v) => patch("blurb", v)}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="Signal keywords (콤마 구분)"
              value={
                Array.isArray(payload.signal_keywords)
                  ? (payload.signal_keywords as string[]).join(", ")
                  : ""
              }
              placeholder="TSMC, Taiwan Semi, 2nm node"
              onChange={(v) =>
                patch(
                  "signal_keywords",
                  v
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </div>
        </div>
      );
    case "add_signal_source":
      return (
        <div className="space-y-3">
          <TextField
            label="대상 Capability key"
            value={(payload.capability_key as string) ?? ""}
            placeholder="rad_hard_compute"
            mono
            onChange={(v) => patch("capability_key", v)}
          />
          <TextField
            label="arXiv 키워드 (콤마 구분, 필수)"
            value={
              Array.isArray(payload.arxiv_keywords)
                ? (payload.arxiv_keywords as string[]).join(", ")
                : ""
            }
            placeholder="radiation hardened processor, rad-hard FPGA"
            onChange={(v) =>
              patch(
                "arxiv_keywords",
                v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
          <TextField
            label="USPTO 키워드 (선택)"
            value={
              Array.isArray(payload.uspto_keywords)
                ? (payload.uspto_keywords as string[]).join(", ")
                : ""
            }
            placeholder="radiation tolerant integrated circuit"
            onChange={(v) =>
              patch(
                "uspto_keywords",
                v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
          <TextField
            label="News 키워드 (선택)"
            value={
              Array.isArray(payload.news_keywords)
                ? (payload.news_keywords as string[]).join(", ")
                : ""
            }
            placeholder="rad-hard chip, NASA radiation testing"
            onChange={(v) =>
              patch(
                "news_keywords",
                v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      );
    case "edit":
    case "other":
    default:
      return (
        <div className="rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 p-4 text-[12px] leading-relaxed text-neutral-400">
          이 종류는 구조화 필드가 없습니다. 본문 + 근거 자료로 admin이 검토 후
          반영합니다. 다음 단계로 진행해주세요.
        </div>
      );
  }
}

// ===== Reusable atoms ====================================================

function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? "any"}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-right font-mono text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </label>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 focus:border-cyan-700 focus:outline-none"
      />
    </div>
  );
}
