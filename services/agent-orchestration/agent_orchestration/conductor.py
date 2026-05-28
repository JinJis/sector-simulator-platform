"""Vision Builder Conductor — multi-stage orchestration.

End-to-end pipeline:

  1. PromptValidator (haiku)         → reject early on bad prompts
  2. VisionDecomposition (opus)      → full structured draft
  3. DataSourceSelector (sonnet)     → per-capability keyword sets
  4. ValidationGate (pure Python)    → relational checks, DAG, FK,
                                       weight normalization

Total cost target per successful build: <$0.55. Pipeline aborts at the
first failure — no point calling opus if the prompt is bad. Cost is
reported per stage so the admin UI can show "where the budget went."

The conductor does NOT persist anything. Its output is a draft + a
gate verdict; the tRPC layer in sector-service decides whether to
write to the DB after admin approval.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter

from agent_tools import CostMeter, LLMClient

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
    # when the gate failed (we don't waste a sonnet call on a rejected
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
    the code complexity — the opus call dominates wall-clock.
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

        # ---- Stage 1: PromptValidator (haiku) -------------------------
        validation, m1 = await self._run_validator(
            prompt=prompt,
            existing_vision_slugs=existing_vision_slugs,
        )
        stages.append(m1)
        if not validation.is_valid:
            log.info(
                "conductor: prompt rejected at stage 1 (kind=%s)",
                validation.rejection_kind,
            )
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

        # ---- Stage 2: VisionDecomposition (opus) ----------------------
        draft, m2 = await self._run_decomposition(
            validation=validation,
            existing_actor_keys=existing_actor_keys,
            research_brief=research_brief,
        )
        stages.append(m2)

        # ---- Stage 3: DataSourceSelector (sonnet) ---------------------
        signal_config, m3 = await self._run_selector(draft=draft)
        stages.append(m3)

        # ---- Stage 4: ValidationGate (pure Python) --------------------
        gate_start = perf_counter()
        gate = run_validation_gate(
            draft=draft,
            signal_config=signal_config,
            existing_vision_slugs=existing_vision_slugs,
            existing_actor_keys=existing_actor_keys,
        )
        stages.append(
            StageMetric(
                name="validation_gate",
                cost_usd=0.0,
                duration_ms=int((perf_counter() - gate_start) * 1000),
            )
        )

        # Prefer the normalized draft (weights adjusted) when the gate
        # produced one; fall back to the raw draft if it didn't (gate
        # passed cleanly OR gate failed and rejected the draft).
        final_draft = gate.normalized_draft or draft

        # ---- Stage 5 (optional): ThesisDrafter (sonnet) ---------------
        # Only runs when the gate passed — no point spending a sonnet
        # call on a rejected draft. Failures here don't propagate;
        # commit just lands without thesis/catalysts and the panels
        # render empty.
        thesis_catalysts: ThesisCatalystsDraft | None = None
        m5: StageMetric | None = None
        if gate.ok:
            try:
                thesis_catalysts, m5 = await self._run_thesis_drafter(
                    draft=final_draft
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
                    )
                )

        total_cost = m1.cost_usd + m2.cost_usd + m3.cost_usd
        if m5 is not None:
            total_cost += m5.cost_usd
        total_duration_ms = int((perf_counter() - total_start) * 1000)

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
