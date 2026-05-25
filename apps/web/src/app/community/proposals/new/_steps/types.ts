/**
 * Shared types for the proposal wizard. The flow accumulates state in
 * `ProposalDraft` across steps; each step mutates the slice it owns
 * and the parent wizard never reads from sub-step internal state.
 */

import type { ProposalTargetKind } from "@/lib/community-proposal-client";

export interface EvidenceRow {
  kind: "text" | "url";
  content: string;
}

/** Per-target-kind payload shapes. Each step's form maps onto one of
 *  these. The wizard sends the matching variant on submit. */
export interface DriverPayload {
  name: string;
  group?: string;
  unit?: string;
  default: number;
  min: number;
  max: number;
  description: string;
}

export interface EquityPayload {
  ticker: string;
  exchange: string;
  iso_country: string;
  company_name: string;
  sector_exposure_pct: number;
  rationale?: string;
}

export interface CapabilityPayload {
  key: string;
  name: string;
  description: string;
  rationale: string;
  weight: number;
  initial_technical?: number;
  initial_economic?: number;
  initial_regulatory?: number;
  initial_supply?: number;
}

export interface RiskPayload {
  key: string;
  name: string;
  category: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  likelihood: "low" | "medium" | "high";
  time_horizon: "immediate" | "1y" | "3y" | "5y" | "10y";
  affected_capability_keys: string[];
}

export interface ActorPayload {
  key: string;
  name: string;
  iso_country: string;
  category: string;
  stage: string;
  blurb: string;
  signal_keywords: string[];
  relevance: number;
}

export interface SignalSourcePayload {
  capability_key: string;
  arxiv_keywords: string[];
  uspto_keywords: string[];
  news_keywords: string[];
}

export interface ProposalDraft {
  target_kind: ProposalTargetKind | null;
  sector_slug: string;
  target_ref: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  evidence: EvidenceRow[];
}

export const EMPTY_DRAFT: ProposalDraft = {
  target_kind: null,
  sector_slug: "",
  target_ref: "",
  title: "",
  body: "",
  payload: {},
  evidence: [],
};
