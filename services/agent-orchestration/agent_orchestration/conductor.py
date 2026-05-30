"""Vision Builder Conductor — multi-stage orchestration.

End-to-end pipeline:

  1. PromptValidator (fast)         → reject early on bad prompts
  2. VisionDecomposition (deep)      → full structured draft
  3. DataSourceSelector (balanced)     → per-capability keyword sets
  4. ValidationGate (pure Python)    → relational checks, DAG, FK,
                                       weight normalization

Total cost target per successful build: <$0.55. Pipeline aborts at the
first failure — no point calling the deep tier if the prompt is bad. Cost is
reported per stage so the admin UI can show "where the budget went."

The conductor does NOT persist anything. Its output is a draft + a
gate verdict; the tRPC layer in sector-service decides whether to
write to the DB after admin approval.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter

from agent_tools import CostMeter, LLMClient

from agent_orchestration import progress
from agent_orchestration.schemas import (
    DataSourceConfigDraft,
    DataSourceSelectorRequest,
    PromptValidationResult,
    ThesisCatalystsDraft,
    ThesisDrafterRequest,
    VisionBuilderPromptRequest,
    VisionDecompositionRequest,
    VisionDecompositionResult,
)
from agent_orchestration.validation_gate import (
    ValidationGateResult,
    run_validation_gate,
)
from agent_orchestration.workflows import (
    DataSourceSelectorWorkflow,
    PromptValidatorWorkflow,
    ThesisDrafterWorkflow,
    VisionDecompositionWorkflow,
)

log = logging.getLogger("agent_orchestration.conductor")


@dataclass
class StageMetric:
    name: str
    cost_usd: float
    duration_ms: int
    # Slice 15 — one-line summary of what the stage produced. Surfaced
    # in the admin real-time progress panel + the post-completion
    # review timeline. Optional so legacy code paths still construct
    # StageMetric(name=..., cost_usd=..., duration_ms=...).
    output_summary: str | None = None


# Stage display names — used by the real-time progress emit calls so
# the UI label matches what the operator already sees in the existing
# stage-completion log lines.
_STAGE_DISPLAY: dict[str, str] = {
    "prompt_validator": "PromptValidator",
    "vision_decomposition": "VisionDecomposition",
    "data_source_selector": "DataSourceSelector",
    "validation_gate": "ValidationGate",
    "thesis_drafter": "ThesisDrafter",
}


def _summarize_validation(v: PromptValidationResult) -> str:
    if v.is_valid:
        return "prompt accepted"
    return f"prompt rejected: {v.rejection_kind or 'unspecified'}"


def _summarize_decomposition(d: VisionDecompositionResult) -> str:
    return (
        f"{len(d.capabilities)} capabilities · "
        f"{len(d.risks)} risks · "
        f"{len(d.actors)} actors · "
        f"{len(d.dependencies)} edges"
    )


def _summarize_selector(c: DataSourceConfigDraft) -> str:
    keyword_count = len(getattr(c, "capability_keywords", []))
    return f"{keyword_count} capability keyword sets"


def _summarize_gate(g: ValidationGateResult) -> str:
    if g.ok:
        normalized = (
            len(g.normalized_draft.capabilities)
            if g.normalized_draft is not None
            else 0
        )
        return f"gate passed · {normalized} capabilities normalized"
    if g.errors:
        return f"gate rejected: {g.errors[0]} ({len(g.errors)} total)"
    return "gate rejected (no error message)"


def _summarize_thesis(t: ThesisCatalystsDraft) -> str:
    thesis = t.thesis
    bull = len(thesis.bull_case) if thesis is not None else 0
    bear = len(thesis.bear_case) if thesis is not None else 0
    return f"{bull} bull bullets · {bear} bear bullets · {len(t.catalysts)} catalysts"


@dataclass
class VisionBuilderResult:
    """What the conductor produces.

    `success=False, validation.is_valid=False` → prompt was rejected at
    stage 1, no draft to show beyond the validator's refined_question.

    `success=False, gate.ok=False` → stages 1-3 completed but the
    validation gate found relational errors. Admin sees errors + the
    raw draft (not the normalized one — that field is None when gate
    fails).

    `success=True` → all stages clean. `draft` is the normalized one,
    safe to persist directly.
    """

    success: bool
    validation: PromptValidationResult
    draft: VisionDecompositionResult | None
    signal_config: DataSourceConfigDraft | None
    gate: ValidationGateResult | None
    # F8a-2: editorial overlay produced by ThesisDrafter (stage 5). Null
    # when the gate failed (we don't waste a balanced-tier call on a rejected
    # draft) or when the drafter itself threw — neither blocks commit.
    thesis_catalysts: ThesisCatalystsDraft | None
    stages: list[StageMetric]
    total_cost_usd: float
    total_duration_ms: int


class VisionBuilderConductor:
    """Stitches the four stages together with per-stage cost metering.

    Each stage runs sequentially — stages 2-4 wait for stage 1, stage 3
    waits for stage 2, etc. Stage 4 is pure Python (no LLM call) so it
    contributes 0 to the LLM cost meter.

    We could parallelize stage 3 (DataSourceSelector) with the
    pure-Python parts of stage 4, but the marginal speedup isn't worth
    the code complexity — the deep-tier call dominates wall-clock.
    """

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self,
        *,
        prompt: str,
        existing_vision_slugs: list[str] | None = None,
        existing_actor_keys: list[str] | None = None,
        research_brief: str | None = None,
    ) -> VisionBuilderResult:
        stages: list[StageMetric] = []
        total_start = perf_counter()
        existing_vision_slugs = existing_vision_slugs or []
        existing_actor_keys = existing_actor_keys or []

        # Slice 15 — wipe the in-process progress slot so the admin UI
        # gets a fresh view from t=0 for THIS pipeline. The conductor
        # owns the slot lifecycle (no external coordination); the HTTP
        # layer just hits pipeline_complete(status="failed") on
        # exception bubbling.
        progress.reset(prompt=prompt)

        # ---- Stage 1: PromptValidator (fast) -------------------------
        progress.stage_started(_STAGE_DISPLAY["prompt_validator"])
        stage_started_at = datetime.now(UTC)
        validation, m1 = await self._run_validator(
            prompt=prompt,
            existing_vision_slugs=existing_vision_slugs,
        )
        m1.output_summary = _summarize_validation(validation)
        progress.stage_completed(
            name=_STAGE_DISPLAY["prompt_validator"],
            started_at=stage_started_at,
            duration_ms=m1.duration_ms,
            cost_usd=m1.cost_usd,
            output_summary=m1.output_summary,
        )
        stages.append(m1)
        if not validation.is_valid:
            log.info(
                "conductor: prompt rejected at stage 1 (kind=%s)",
                validation.rejection_kind,
            )
            progress.pipeline_complete(status="succeeded")
            return VisionBuilderResult(
                success=False,
                validation=validation,
                draft=None,
                signal_config=None,
                gate=None,
                thesis_catalysts=None,
                stages=stages,
                total_cost_usd=m1.cost_usd,
                total_duration_ms=int((perf_counter() - total_start) * 1000),
            )

        # ---- Stage 2: VisionDecomposition (deep) ----------------------
        progress.stage_started(_STAGE_DISPLAY["vision_decomposition"])
        stage_started_at = datetime.now(UTC)
        draft, m2 = await self._run_decomposition(
            validation=validation,
            existing_actor_keys=existing_actor_keys,
            research_brief=research_brief,
        )
        m2.output_summary = _summarize_decomposition(draft)
        progress.stage_completed(
            name=_STAGE_DISPLAY["vision_decomposition"],
            started_at=stage_started_at,
            duration_ms=m2.duration_ms,
            cost_usd=m2.cost_usd,
            output_summary=m2.output_summary,
        )
        stages.append(m2)

        # ---- Stage 3: DataSourceSelector (balanced) ---------------------
        progress.stage_started(_STAGE_DISPLAY["data_source_selector"])
        stage_started_at = datetime.now(UTC)
        signal_config, m3 = await self._run_selector(draft=draft)
        m3.output_summary = _summarize_selector(signal_config)
        progress.stage_completed(
            name=_STAGE_DISPLAY["data_source_selector"],
            started_at=stage_started_at,
            duration_ms=m3.duration_ms,
            cost_usd=m3.cost_usd,
            output_summary=m3.output_summary,
        )
        stages.append(m3)

        # ---- Stage 4: ValidationGate (pure Python) --------------------
        progress.stage_started(_STAGE_DISPLAY["validation_gate"])
        gate_stage_started_at = datetime.now(UTC)
        gate_start = perf_counter()
        gate = run_validation_gate(
            draft=draft,
            signal_config=signal_config,
            existing_vision_slugs=existing_vision_slugs,
            existing_actor_keys=existing_actor_keys,
        )
        gate_duration_ms = int((perf_counter() - gate_start) * 1000)
        gate_summary = _summarize_gate(gate)
        stages.append(
            StageMetric(
                name="validation_gate",
                cost_usd=0.0,
                duration_ms=gate_duration_ms,
                output_summary=gate_summary,
            )
        )
        progress.stage_completed(
            name=_STAGE_DISPLAY["validation_gate"],
            started_at=gate_stage_started_at,
            duration_ms=gate_duration_ms,
            cost_usd=0.0,
            output_summary=gate_summary,
        )

        # Prefer the normalized draft (weights adjusted) when the gate
        # produced one; fall back to the raw draft if it didn't (gate
        # passed cleanly OR gate failed and rejected the draft).
        final_draft = gate.normalized_draft or draft

        # ---- Stage 5 (optional): ThesisDrafter (balanced) ---------------
        # Only runs when the gate passed — no point spending a balanced-
        # tier call on a rejected draft. Failures here don't propagate;
        # commit just lands without thesis/catalysts and the panels
        # render empty.
        thesis_catalysts: ThesisCatalystsDraft | None = None
        m5: StageMetric | None = None
        if gate.ok:
            progress.stage_started(_STAGE_DISPLAY["thesis_drafter"])
            thesis_stage_started_at = datetime.now(UTC)
            try:
                thesis_catalysts, m5 = await self._run_thesis_drafter(
                    draft=final_draft
                )
                m5.output_summary = _summarize_thesis(thesis_catalysts)
                progress.stage_completed(
                    name=_STAGE_DISPLAY["thesis_drafter"],
                    started_at=thesis_stage_started_at,
                    duration_ms=m5.duration_ms,
                    cost_usd=m5.cost_usd,
                    output_summary=m5.output_summary,
                )
                stages.append(m5)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "conductor: thesis-drafter raised — committing without thesis: %s",
                    exc,
                )
                # Record a zero-cost stage so the admin UI still shows
                # the stage column (with cost=0, duration measured).
                stages.append(
                    StageMetric(
                        name="thesis_drafter",
                        cost_usd=0.0,
                        duration_ms=0,
                        output_summary=f"skipped: {exc}",
                    )
                )
                progress.stage_completed(
                    name=_STAGE_DISPLAY["thesis_drafter"],
                    started_at=thesis_stage_started_at,
                    duration_ms=0,
                    cost_usd=0.0,
                    output_summary=f"skipped: {exc}",
                )

        total_cost = m1.cost_usd + m2.cost_usd + m3.cost_usd
        if m5 is not None:
            total_cost += m5.cost_usd
        total_duration_ms = int((perf_counter() - total_start) * 1000)

        progress.pipeline_complete(status="succeeded")
        return VisionBuilderResult(
            success=gate.ok,
            validation=validation,
            draft=final_draft if gate.ok else draft,
            signal_config=signal_config,
            gate=gate,
            thesis_catalysts=thesis_catalysts,
            stages=stages,
            total_cost_usd=round(total_cost, 6),
            total_duration_ms=total_duration_ms,
        )

    # ---- per-stage runners ----------------------------------------------------

    async def _run_validator(
        self, *, prompt: str, existing_vision_slugs: list[str]
    ) -> tuple[PromptValidationResult, StageMetric]:
        wf = PromptValidatorWorkflow(llm=self._llm)
        meter = CostMeter()
        t0 = perf_counter()
        result = await wf.run(
            VisionBuilderPromptRequest(
                prompt=prompt, existing_vision_slugs=existing_vision_slugs
            ),
            cost_meter=meter,
        )
        return result, StageMetric(
            name="prompt_validator",
            cost_usd=round(meter.total_usd, 6),
            duration_ms=int((perf_counter() - t0) * 1000),
        )

    async def _run_decomposition(
        self,
        *,
        validation: PromptValidationResult,
        existing_actor_keys: list[str],
        research_brief: str | None,
    ) -> tuple[VisionDecompositionResult, StageMetric]:
        wf = VisionDecompositionWorkflow(llm=self._llm)
        meter = CostMeter()
        t0 = perf_counter()
        result = await wf.run(
            VisionDecompositionRequest(
                refined_question=validation.refined_question,
                suggested_name=validation.suggested_name,
                suggested_slug=validation.suggested_slug,
                domain_label=validation.domain_label,
                scope=validation.scope,
                target_capability_count=validation.suggested_capability_count,
                target_actor_count=validation.suggested_actor_count,
                research_brief=research_brief,
                existing_actor_keys=existing_actor_keys,
            ),
            cost_meter=meter,
        )
        return result, StageMetric(
            name="vision_decomposition",
            cost_usd=round(meter.total_usd, 6),
            duration_ms=int((perf_counter() - t0) * 1000),
        )

    async def _run_selector(
        self, *, draft: VisionDecompositionResult
    ) -> tuple[DataSourceConfigDraft, StageMetric]:
        wf = DataSourceSelectorWorkflow(llm=self._llm)
        meter = CostMeter()
        t0 = perf_counter()
        result = await wf.run(
            DataSourceSelectorRequest(
                slug=draft.slug,
                domain_label=draft.domain_label,
                capabilities=draft.capabilities,
            ),
            cost_meter=meter,
        )
        return result, StageMetric(
            name="data_source_selector",
            cost_usd=round(meter.total_usd, 6),
            duration_ms=int((perf_counter() - t0) * 1000),
        )

    async def _run_thesis_drafter(
        self, *, draft: VisionDecompositionResult
    ) -> tuple[ThesisCatalystsDraft, StageMetric]:
        wf = ThesisDrafterWorkflow(llm=self._llm)
        meter = CostMeter()
        t0 = perf_counter()
        result = await wf.run(
            ThesisDrafterRequest(
                slug=draft.slug,
                name=draft.name,
                refined_question=draft.vision_question,
                domain_label=draft.domain_label,
                description=draft.description,
                capabilities=draft.capabilities,
                risks=draft.risks,
                binding_capability_key=draft.initial_feasibility.binding_capability_key,
                initial_composite=draft.initial_feasibility.initial_composite,
            ),
            cost_meter=meter,
        )
        return result, StageMetric(
            name="thesis_drafter",
            cost_usd=round(meter.total_usd, 6),
            duration_ms=int((perf_counter() - t0) * 1000),
        )


# Convenience wrapper so tests can pass through `asyncio.run`.
async def build_vision(
    *,
    llm: LLMClient,
    prompt: str,
    existing_vision_slugs: list[str] | None = None,
    existing_actor_keys: list[str] | None = None,
    research_brief: str | None = None,
) -> VisionBuilderResult:
    conductor = VisionBuilderConductor(llm=llm)
    return await conductor.run(
        prompt=prompt,
        existing_vision_slugs=existing_vision_slugs,
        existing_actor_keys=existing_actor_keys,
        research_brief=research_brief,
    )
