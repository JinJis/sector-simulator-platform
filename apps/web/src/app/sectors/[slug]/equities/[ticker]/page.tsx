"use client";

import { useParams } from "next/navigation";

import { EquityDetail } from "./equity-detail";

export default function EquityDetailPage() {
  const params = useParams<{ slug: string; ticker: string }>();
  const ticker = decodeURIComponent(params?.ticker ?? "");
  return <EquityDetail ticker={ticker} />;
}
