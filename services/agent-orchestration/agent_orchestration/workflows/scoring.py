"""Concrete workflow classes — scoring + extraction (SignalExtractor, CapabilityScoreUpdater).

Extracted from the monolithic ``workflows.py`` in slice 6b. The
:class:`Workflow` protocol + :class:`WorkflowRunner` still live in
:mod:`agent_orchestration.runner`; this module just holds the
domain-specific implementations.
"""

from __future__ import annotations

import asyncio
import logging

from agent_tools import CostMeter, LLMClient

from agent_orchestration.prompts import load_prompt
from agent_orchestration.schemas import (
    CapabilityScoreUpdate,
    CapabilityScoreUpdaterRequest,
    SignalExtractorRequest,
    SignalScoring,
)

log = logging.getLogger("agent_orchestration")


class SignalExtractorWorkflow:
    """Score one signal against one capability across 4 dimensions.

    Called by the signal_ingest cron (M39c) for every raw signal after
    the adapter writes it. Output (per-dim deltas + confidence +
    matched_actor_key) is written back to the signals row before the
    extractor returns to the caller.

    Prompt: `prompts/signal_extractor.md`. Conservative scoring —
    when ambiguous, dims are null + confidence < 0.5; the score
    updater (M40) drops these.
    """

    kind = "signal_extractor"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: SignalExtractorRequest, *, cost_meter: CostMeter
    ) -> SignalScoring:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("signal_extractor")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="fast",
            system=system,
            user=user,
            max_tokens=1024,
            # Haiku doesn't materially benefit from extended thinking on
            # this size of task — keep it fast.
            adaptive_thinking=False,
            response_model=SignalScoring,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"signal_extractor returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, SignalScoring)
        # Defensive: when extractor's matched_actor_key isn't in the
        # provided keyword set, drop it (the agent shouldn't hallucinate
        # keys, but cheap to guard).
        if result.parsed.matched_actor_key is not None:
            valid_keys = {ak.actor_key for ak in request.actor_keywords}
            if result.parsed.matched_actor_key not in valid_keys:
                log.warning(
                    "signal_extractor: dropping hallucinated actor_key %r (sector=%s cap=%s)",
                    result.parsed.matched_actor_key,
                    request.sector_slug,
                    request.capability_key,
                )
                # Pydantic v2 model_copy with update is the clean path.
                return result.parsed.model_copy(update={"matched_actor_key": None})
        return result.parsed

    @staticmethod
    def _format_user_turn(request: SignalExtractorRequest) -> str:
        actor_lines: list[str] = []
        if request.actor_keywords:
            actor_lines.append("\n## Actor keyword sets")
            for ak in request.actor_keywords:
                aliases = ", ".join(ak.aliases) if ak.aliases else "(none)"
                actor_lines.append(f"- {ak.actor_key}: {aliases}")
        summary_block = (
            f"\n### Summary\n{request.signal_summary}"
            if request.signal_summary
            else ""
        )
        return (
            f"## Capability — {request.capability_name} ({request.capability_key})\n\n"
            f"**Description**: {request.capability_description}\n\n"
            f"**Why it matters**: {request.capability_rationale}\n\n"
            f"## Signal ({request.source_kind})\n\n"
            f"### Title\n{request.signal_title}"
            f"{summary_block}\n"
            + "\n".join(actor_lines)
            + "\n\nScore per-dimension deltas, confidence, and (optionally) "
            "the matched actor key. Output only the SignalScoring schema."
        )


# =====================================================================
# M40b — CapabilityScoreUpdaterWorkflow (balanced tier)
# =====================================================================
#
# One call per (capability × recompute cycle). Reasoning-heavy: agent
# weighs the recent signal feed against current scores with temporal
# decay. Sonnet tier (gemini-3.5-flash) — middle of the road for both
# cost and judgment.
# =====================================================================

class CapabilityScoreUpdaterWorkflow:
    """Update a capability's 4-dim scores from recent signals.

    Called by data-pipeline's recompute_feasibility cron once per
    (vision × capability) per day. Prompt: prompts/score_updater.md.
    """

    kind = "capability_score_updater"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: CapabilityScoreUpdaterRequest,
        *,
        cost_meter: CostMeter,
    ) -> CapabilityScoreUpdate:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("score_updater")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="balanced",
            system=system,
            user=user,
            max_tokens=2048,
            # Sonnet benefits from extended thinking on multi-signal
            # reasoning. Caller pays ~$0.01-0.03 per call vs ~$0.005
            # without — worth it for the judgment quality.
            adaptive_thinking=True,
            response_model=CapabilityScoreUpdate,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"score-updater returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, CapabilityScoreUpdate)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: CapabilityScoreUpdaterRequest) -> str:
        parts: list[str] = []
        parts.append(
            f"## Capability — {request.capability_name} ({request.capability_key})"
        )
        parts.append(f"\n**Description**: {request.capability_description}")
        parts.append(f"\n**Why it matters**: {request.capability_rationale}")
        parts.append("\n## Current scores")
        for label, val in [
            ("technical", request.current_technical),
            ("economic", request.current_economic),
            ("regulatory", request.current_regulatory),
            ("supply", request.current_supply),
        ]:
            parts.append(
                f"- {label}: {val if val is not None else 'null (not assessed)'}"
            )
        parts.append("\n## Recent signals (newest first)")
        if not request.recent_signals:
            parts.append("- (no signals in window)")
        else:
            for s in request.recent_signals:
                deltas = []
                for dim, v in [
                    ("tech", s.delta_technical),
                    ("econ", s.delta_economic),
                    ("reg", s.delta_regulatory),
                    ("sup", s.delta_supply),
                ]:
                    if v is not None:
                        sign = "+" if v >= 0 else ""
                        deltas.append(f"{dim}={sign}{v}")
                deltas_str = " · ".join(deltas) if deltas else "no deltas"
                age_days = (
                    f" ({s.published_at.isoformat()[:10]})"
                    if s.published_at
                    else ""
                )
                actor = f" [{s.actor_short_name}]" if s.actor_short_name else ""
                parts.append(
                    f"- **{s.source_kind}**{actor}: {s.title}{age_days} — {deltas_str}"
                )
                if s.summary:
                    snippet = s.summary[:300]
                    parts.append(f"  > {snippet}{'…' if len(s.summary) > 300 else ''}")
        parts.append(
            "\n\nReturn the updated CapabilityScoreUpdate. Apply temporal decay; "
            "leave a dim null when no signal flow justifies a change."
        )
        return "\n".join(parts)


# =====================================================================
# M41 — PromptValidatorWorkflow (fast tier)
# =====================================================================
#
# Stage-1 gate of the Vision Builder pipeline. Cheap classification +
# refinement so we don't burn deep-tier budget on nonsense, off-topic, or
# duplicate prompts. Output drives whether the pipeline proceeds and
# sizes the downstream decomposition.
# =====================================================================
