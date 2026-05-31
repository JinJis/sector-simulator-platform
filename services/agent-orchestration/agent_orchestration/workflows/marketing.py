"""MarketingContent workflow — bilingual social copy from a vision snapshot.

Turns a live :class:`VisionMarketingSnapshot` (binding-constraint
capability, current readiness, the most notable recent signal + source,
lead actor) into ready-to-post Threads + Instagram copy in Korean and
English. Product-led: every CTA links the public vision page.

Called by the data-pipeline ``marketing_digest`` job (cost-gated,
operator-armed cron) via the ``/marketing-content/generate`` endpoint.
Prompt: ``prompts/marketing_content.md``. Balanced tier — the copy needs
judgment + bilingual nuance, not deep reasoning.
"""

from __future__ import annotations

import asyncio
import logging

from agent_tools import CostMeter, LLMClient

from agent_orchestration.prompts import load_prompt
from agent_orchestration.schemas import (
    MarketingPostSet,
    VisionMarketingSnapshot,
)

log = logging.getLogger("agent_orchestration")


class MarketingContentWorkflow:
    """Generate one bilingual social-post set for one vision snapshot."""

    kind = "marketing_content"

    def __init__(self, llm: LLMClient) -> None:
        self._llm = llm

    async def run(
        self, request: VisionMarketingSnapshot, *, cost_meter: CostMeter
    ) -> MarketingPostSet:
        llm = self._llm.clone(cost_meter=cost_meter)
        system = load_prompt("marketing_content")
        user = self._format_user_turn(request)
        result = await asyncio.to_thread(
            llm.call,
            tier="balanced",
            system=system,
            user=user,
            max_tokens=3072,
            # Bilingual copy with a consistent insight across ko/en
            # benefits from a little planning before it commits to the
            # hook — cheap at balanced tier, better parity.
            adaptive_thinking=True,
            response_model=MarketingPostSet,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"marketing_content returned unparseable output "
                f"(stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, MarketingPostSet)
        return result.parsed

    @staticmethod
    def _format_user_turn(request: VisionMarketingSnapshot) -> str:
        parts: list[str] = []
        parts.append(f"## Vision — {request.vision_name} ({request.vision_slug})")
        parts.append(f"**Vision page (CTA target)**: {request.vision_url}")
        parts.append(f"**Audience**: {request.audience}")

        if request.binding_constraint_score is not None:
            cap = request.binding_capability_name or "the weakest capability"
            parts.append(
                f"\n**Feasibility (binding constraint)**: "
                f"{request.binding_constraint_score:.0f}/100 — gated by "
                f"**{cap}** (Liebig's Law of the Minimum)."
            )
        elif request.binding_capability_name:
            parts.append(
                f"\n**Binding capability**: {request.binding_capability_name} "
                "(score not yet assessed)."
            )

        if request.capabilities:
            parts.append("\n## Capability readiness")
            for c in request.capabilities:
                score = (
                    f"{c.composite:.0f}/100" if c.composite is not None else "—"
                )
                flag = " ⟵ binding" if c.is_binding else ""
                parts.append(f"- {c.name}: {score}{flag}")

        if request.lead_actor_name:
            parts.append(f"\n**Lead actor**: {request.lead_actor_name}")

        sig = request.notable_signal
        if sig is not None:
            parts.append("\n## Most notable recent signal")
            src = sig.source_kind
            if sig.source_domain:
                src += f" · {sig.source_domain}"
            when = f" ({sig.published_at})" if sig.published_at else ""
            parts.append(f"- **{src}**{when}: {sig.title}")
            if sig.dominant_delta is not None:
                sign = "+" if sig.dominant_delta >= 0 else ""
                parts.append(
                    f"  - moved a capability by {sign}{sig.dominant_delta:g} pts"
                )
            if sig.summary:
                snippet = sig.summary[:400]
                parts.append(
                    f"  > {snippet}{'…' if len(sig.summary) > 400 else ''}"
                )
        else:
            parts.append(
                "\n## Most notable recent signal\n- (none in window — lead with "
                "the binding-constraint story instead; do not invent a signal.)"
            )

        if getattr(request, "custom_guidelines", None):
            parts.append(
                f"\n\n## Custom Tone & Example Guidelines (CRITICAL OVERRIDE)\n"
                f"Please strictly apply the following operator-defined custom tone, "
                f"style, and example post guidelines for each platform:\n"
                f"{request.custom_guidelines}"
            )

        platforms = ", ".join(request.platforms)
        parts.append(
            f"\n\nWrite one post per platform ({platforms}), each with ko + en "
            "variants and hashtags. Ground every claim in the facts above — "
            "invent no numbers. Output only the MarketingPostSet schema."
        )
        return "\n".join(parts)
