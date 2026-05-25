export type Horizon = "1d" | "1w" | "1m";

export interface EquityChoice {
  id: string;
  ticker: string;
  exchange: string;
  company_name: string;
  last_close_local: number | null;
}

export interface PredictionDraft {
  sector_slug: string;
  equity_id: string;
  horizon: Horizon;
  /** % spread (max-min)/mid × 100 */
  spread_pct: number;
  /** % directional offset from anchor */
  offset_pct: number;
  rationale: string;
}

export const EMPTY_PREDICTION: PredictionDraft = {
  sector_slug: "",
  equity_id: "",
  horizon: "1m",
  spread_pct: 5,
  offset_pct: 0,
  rationale: "",
};
