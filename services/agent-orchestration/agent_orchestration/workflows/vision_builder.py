"""Concrete workflow classes — Vision Builder conductor steps.
(PromptValidator → VisionDecomposition → DataSourceSelector →
ThesisDrafter → ProposalPayloadDrafter.)

Extracted from the monolithic ``workflows.py`` in slice 6b. The
:class:`Workflow` protocol + :class:`WorkflowRunner` still live in
:mod:`agent_orchestration.runner`; this module just holds the
domain-specific implementations.
"""

from __future__ import annotations

import asyncio
import logging

from agent_tools import CostMeter, LLMClient
from pydantic import BaseModel

from agent_orchestration.prompts import load_prompt
from agent_orchestration.schemas import (
    AddActorPayload,
    AddCapabilityPayload,
    AddDriverPayload,
    AddEquityPayload,
    AddRiskPayload,
    AddSignalSourcePayload,
    CapabilityKeywordSet,
    DataSourceConfigDraft,
    DataSourceSelectorRequest,
    PromptValidationResult,
    ProposalPayloadDraftRequest,
    ThesisCatalystsDraft,
    ThesisDrafterRequest,
    VisionBuilderPromptRequest,
    VisionDecompositionRequest,
    VisionDecompositionResult,
)

log = logging.getLogger("agent_orchestration")


class PromptValidatorWorkflow:
    """Sanity-check a user vision prompt before the expensive pipeline
    stages run. Cheap (fast) — runs once per user submission.
    Prompt: prompts/prompt_validator.md.
    """

    kind = "prompt_validator"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: VisionBuilderPromptRequest,
        *,
        cost_meter: CostMeter,
    ) -> PromptValidationResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("prompt_validator")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="fast",
            system=system,
            user=user,
            max_tokens=1024,
            adaptive_thinking=False,
            response_model=PromptValidationResult,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"prompt-validator returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, PromptValidationResult)

        # Defensive: agent sometimes ignores duplicate check. If the
        # suggested_slug already exists, force rejection here.
        if (
            result.parsed.is_valid
            and result.parsed.suggested_slug in request.existing_vision_slugs
        ):
            log.info(
                "prompt-validator: forcing duplicate rejection on slug %r",
                result.parsed.suggested_slug,
            )
            return result.parsed.model_copy(
                update={
                    "is_valid": False,
                    "rejection_kind": "duplicate",
                    "rejection_reason": (
                        f"Slug '{result.parsed.suggested_slug}' is already registered."
                        " Refine the question to a different scope."
                    ),
                }
            )

        return result.parsed

    @staticmethod
    def _format_user_turn(request: VisionBuilderPromptRequest) -> str:
        existing_block = ""
        if request.existing_vision_slugs:
            slugs = ", ".join(request.existing_vision_slugs[:50])
            extra = (
                f" (+{len(request.existing_vision_slugs) - 50} more)"
                if len(request.existing_vision_slugs) > 50
                else ""
            )
            existing_block = (
                f"\n\n## Existing vision slugs\n{slugs}{extra}\n\n"
                "If the user's prompt would duplicate one of these, return "
                "rejection_kind='duplicate' and reference the existing slug "
                "in rejection_reason."
            )
        return (
            f"## User prompt\n\n{request.prompt}"
            f"{existing_block}\n\n"
            "Validate, then return the PromptValidationResult schema."
        )


# =====================================================================
# M41 — VisionDecompositionWorkflow (deep tier — the heart of M41)
# =====================================================================
#
# Stage-3 of the Vision Builder pipeline. Takes a validated prompt and
# emits a full vision draft: capabilities (+4-dim initial scores),
# dependencies (DAG edges), risks, actors, capability-actor wiring,
# and an initial feasibility estimate.
#
# Why deep: this single call produces the entire structured shape of
# a new vision — magnitude calibration, capability decomposition,
# realistic actor selection across geographies, and DAG construction
# all at once. Skimping here cascades into bad downstream UX.
#
# Prompt: prompts/vision_decomposition.md
# =====================================================================

class VisionDecompositionWorkflow:
    """Decompose a validated prompt into a full structured vision draft.

    Opus tier with adaptive_thinking — this is the most expensive single
    LLM call in the platform. Cost per run target: <$0.50 (admin-gated
    so we don't run it on every page load).
    """

    kind = "vision_decomposition"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: VisionDecompositionRequest,
        *,
        cost_meter: CostMeter,
    ) -> VisionDecompositionResult:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("vision_decomposition")
        user = self._format_user_turn(request)
        # Gemini caps thinking + candidate tokens together against
        # max_output_tokens. With adaptive_thinking=True (budget=-1)
        # the model often spends 10K+ tokens reasoning, leaving the
        # 5K+ JSON payload truncated mid-object on the retry path
        # (which injects the full schema, inviting even more thinking).
        # 32K gives ~16K of headroom for the JSON itself — gemini-3.1-
        # pro-preview supports up to 64K output, so we're well clear.
        result = await asyncio.to_thread(
            llm.call,
            tier="deep",
            system=system,
            user=user,
            max_tokens=32_000,
            adaptive_thinking=True,
            response_model=VisionDecompositionResult,
        )
        if result.parsed is None:
            # Possible causes: hit max_output_tokens mid-JSON (Gemini
            # finish_reason="MAX_TOKENS"), schema validation failure
            # after the constraint-too-tall retry path, or the SDK
            # returned an empty candidate. The stop_reason is the
            # cheapest signal to surface.
            raise RuntimeError(
                "vision-decomposition returned unparseable output "
                f"(stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, VisionDecompositionResult)
        draft = result.parsed

        # Defensive overrides: agent occasionally drifts from the
        # validator's pinned slug / name / domain. Force-restore those
        # so downstream FK integrity is guaranteed.
        if draft.slug != request.suggested_slug:
            log.info(
                "vision-decomposition: restoring slug %r over agent's %r",
                request.suggested_slug,
                draft.slug,
            )
            draft = draft.model_copy(update={"slug": request.suggested_slug})

        return draft

    @staticmethod
    def _format_user_turn(request: VisionDecompositionRequest) -> str:
        parts = [
            "## Validated prompt context",
            f"- Refined question: {request.refined_question}",
            f"- Vision slug (pinned): {request.suggested_slug}",
            f"- Vision name (pinned): {request.suggested_name}",
            f"- Domain: {request.domain_label}",
            f"- Scope: {request.scope}",
            f"- Target capability count: {request.target_capability_count}",
            f"- Target actor count: {request.target_actor_count}",
        ]
        if request.existing_actor_keys:
            existing = ", ".join(sorted(request.existing_actor_keys)[:100])
            extra = (
                f" (+{len(request.existing_actor_keys) - 100} more not shown)"
                if len(request.existing_actor_keys) > 100
                else ""
            )
            parts.append("")
            parts.append("## Existing global actor keys (reuse — do NOT duplicate)")
            parts.append(existing + extra)
        if request.research_brief:
            parts.append("")
            parts.append("## Research brief")
            parts.append(request.research_brief)
        parts.append("")
        parts.append(
            "Produce the full VisionDecompositionResult. Pin slug and"
            " name as given above. Every dependency.source_key /"
            " target_key MUST match one of the capabilities[].key you"
            " produced. Every capability_actors[].capability_key must"
            " match a capabilities[].key, and every"
            " capability_actors[].actor_key must match an actors[].key."
            " initial_feasibility.binding_capability_key must match one"
            " of the capabilities[].key."
        )
        return "\n".join(parts)


# =====================================================================
# M41 — DataSourceSelectorWorkflow (balanced tier)
# =====================================================================
#
# Stage-4 of the Vision Builder pipeline. Given the decomposition's
# capabilities, emit per-capability keyword sets that the M39 signal
# ingest cron will use to fetch arXiv / USPTO / News results.
#
# Why balanced: keyword generation is narrower than decomposition, but
# domain vocab matters enough that haiku produces overly generic
# terms. Sonnet hits the sweet spot.
#
# Prompt: prompts/data_source_selector.md
# =====================================================================

class DataSourceSelectorWorkflow:
    """Generate per-capability arXiv/USPTO/News keyword sets."""

    kind = "data_source_selector"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: DataSourceSelectorRequest,
        *,
        cost_meter: CostMeter,
    ) -> DataSourceConfigDraft:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("data_source_selector")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="balanced",
            system=system,
            user=user,
            max_tokens=4096,
            adaptive_thinking=False,
            response_model=DataSourceConfigDraft,
        )
        if result.parsed is None:
            raise RuntimeError(
                "data-source-selector returned unparseable output "
                f"(stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, DataSourceConfigDraft)
        config = result.parsed

        # Defensive: drop any keyword sets referring to capabilities
        # that weren't in the input. This blocks the agent from
        # hallucinating keys.
        valid_keys = {c.key for c in request.capabilities}
        cleaned: list[CapabilityKeywordSet] = []
        for kws in config.keywords_by_capability:
            if kws.capability_key in valid_keys:
                cleaned.append(kws)
            else:
                log.info(
                    "data-source-selector: dropping keyword set for unknown capability %r",
                    kws.capability_key,
                )
        if not cleaned:
            raise RuntimeError(
                "data-source-selector emitted zero keyword sets that match input capabilities"
            )
        return config.model_copy(update={"keywords_by_capability": cleaned})

    @staticmethod
    def _format_user_turn(request: DataSourceSelectorRequest) -> str:
        parts = [
            f"## Vision: {request.slug} ({request.domain_label})",
            "",
            "## Capabilities",
        ]
        for c in request.capabilities:
            parts.append(f"### {c.key} — {c.name}")
            parts.append(f"  Description: {c.description}")
            parts.append(f"  Rationale: {c.rationale}")
            parts.append("")
        parts.append(
            "For each capability above, produce one CapabilityKeywordSet "
            "with arxiv_keywords, uspto_keywords, news_keywords. "
            "Total keyword sets MUST equal the capability count."
        )
        return "\n".join(parts)


# =====================================================================
# F8a-2 — ThesisDrafterWorkflow (balanced tier)
# =====================================================================
#
# Stage 5 (final, optional) of the Vision Builder pipeline. Takes the
# gate-approved decomposition and emits an InvestmentThesis + Catalyst[]
# bundle — the editorial-overlay rows that populate /visions/<slug>'s
# hero thesis card + catalyst timeline.
#
# Why balanced: narrative quality matters, but the input space is already
# narrowed by stages 2-4. Opus would 2-3x the cost without proportional
# quality gain. Caller treats this stage as best-effort — if it fails
# the vision still commits with thesis=null.
#
# Prompt: prompts/thesis_drafter.md
# Cost target: <$0.05 per call.
# =====================================================================

class ThesisDrafterWorkflow:
    """Draft the investor thesis + upcoming catalyst timeline."""

    kind = "thesis_drafter"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: ThesisDrafterRequest,
        *,
        cost_meter: CostMeter,
    ) -> ThesisCatalystsDraft:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("thesis_drafter")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="balanced",
            system=system,
            user=user,
            max_tokens=4096,
            adaptive_thinking=False,
            response_model=ThesisCatalystsDraft,
        )
        if result.parsed is None:
            raise RuntimeError(
                "thesis-drafter returned unparseable output "
                f"(stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, ThesisCatalystsDraft)
        draft = result.parsed

        # Defensive: drop catalysts that reference an unknown
        # capability_key. The agent occasionally invents keys.
        valid_keys = {c.key for c in request.capabilities}
        cleaned_catalysts = []
        for cat in draft.catalysts:
            if cat.capability_key is not None and cat.capability_key not in valid_keys:
                log.info(
                    "thesis-drafter: nulling unknown capability_key %r on catalyst %r",
                    cat.capability_key,
                    cat.label,
                )
                cleaned_catalysts.append(cat.model_copy(update={"capability_key": None}))
            else:
                cleaned_catalysts.append(cat)
        return draft.model_copy(update={"catalysts": cleaned_catalysts})

    @staticmethod
    def _format_user_turn(request: ThesisDrafterRequest) -> str:
        parts = [
            f"## Vision: {request.name} ({request.slug})",
            f"- Refined question: {request.refined_question}",
            f"- Domain: {request.domain_label}",
            f"- Day-0 composite: {request.initial_composite:.0f}/100",
            f"- Binding capability (cap on composite): {request.binding_capability_key}",
            "",
            "## Description",
            request.description,
            "",
            "## Capabilities (key — name — rationale)",
        ]
        for c in request.capabilities:
            parts.append(f"- `{c.key}` — {c.name}: {c.rationale}")
        parts.append("")
        parts.append("## Risks (category — name — severity/likelihood — description)")
        for r in request.risks:
            parts.append(
                f"- [{r.category}] {r.name} ({r.severity}/{r.likelihood}): {r.description}"
            )
        parts.append("")
        parts.append(
            "Produce the ThesisCatalystsDraft. Anchor at least one catalyst"
            f" to the binding capability `{request.binding_capability_key}`."
            " Tie bull / bear bullets to specific capabilities or risks above"
            " — don't write generic statements. ISO date `YYYY-MM-DD` for"
            " every catalyst.expected_at."
        )
        return "\n".join(parts)


# =====================================================================
# M55 follow-up — ProposalPayloadDrafterWorkflow (fast tier)
# =====================================================================
#
# Fills the structured `proposed_payload` for a community proposal
# from just the (kind, sector, title, body) the user typed in steps
# 1-3 of the New Proposal wizard. Replaces the hand-typed step 4 form
# — user reviews + confirms instead of filling.
#
# Prompt: prompts/proposal_payload_drafter.md
# Cost target: ≤$0.001 per call (fast; regenerate is cheap).
# =====================================================================


_PROPOSAL_PAYLOAD_SCHEMA_BY_KIND: dict[str, type[BaseModel]] = {
    "add_capability": AddCapabilityPayload,
    "add_risk": AddRiskPayload,
    "add_actor": AddActorPayload,
    "add_driver": AddDriverPayload,
    "add_equity": AddEquityPayload,
    "add_signal_source": AddSignalSourcePayload,
}

class ProposalPayloadDrafterWorkflow:
    """Draft a structured `proposed_payload` from the user's free-text
    proposal title + body. One fast-tier call; consumer (sector-service
    tRPC + UI) re-validates against Zod before persisting."""

    kind = "proposal_payload_drafter"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        request: ProposalPayloadDraftRequest,
        *,
        cost_meter: CostMeter,
    ) -> BaseModel:
        schema_cls = _PROPOSAL_PAYLOAD_SCHEMA_BY_KIND.get(request.target_kind)
        if schema_cls is None:
            # Caller already gated on the Literal type; this is defensive
            # in case a future kind gets added to the Literal without a
            # matching schema entry.
            raise ValueError(
                f"proposal_payload_drafter: unsupported target_kind {request.target_kind!r}"
            )
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("proposal_payload_drafter")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="fast",
            system=system,
            user=user,
            max_tokens=1024,
            adaptive_thinking=False,
            response_model=schema_cls,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"proposal_payload_drafter returned unparseable output "
                f"(stop_reason={result.stop_reason})"
            )
        return result.parsed

    @staticmethod
    def _format_user_turn(request: ProposalPayloadDraftRequest) -> str:
        return (
            f"target_kind: {request.target_kind}\n"
            f"sector_slug: {request.sector_slug}\n"
            f"sector_name: {request.sector_name}\n"
            f"title: {request.title}\n"
            f"body: {request.body}\n"
            "\n"
            "Emit the JSON object matching the per-kind schema. "
            "No prose, no markdown fences, no commentary."
        )
