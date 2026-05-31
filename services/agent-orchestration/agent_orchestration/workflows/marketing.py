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


_STRATEGY_PROMPTS: dict[str, str] = {
    "vision_bottleneck": (
        "### CAMPAIGN STRATEGY: Liebig's Constraint Story (Default)\n"
        "- Focus: Frame the feasibility score around Liebig's Law of the Minimum. "
        "Highlight the weakest capability gating the entire vision (the bottleneck) "
        "and detail the recent signals (arXiv/patents/news) that moved it."
    ),
    "early_hype": (
        "### CAMPAIGN STRATEGY: Early Inflow Grabber (TOF / Attention & Hook)\n"
        "- Focus: Maximize early user acquisition, attention, and debate.\n"
        "- Style: Bold, high-energy, slightly contrarian, and engaging. Open with a "
        "provocative, scroll-stopping question about the feasibility of this tech (e.g., "
        "'Is LEO satellite edge computing a multi-billion dollar breakthrough or just "
        "VC hype?').\n"
        "- Goal: Grab attention immediately, frame our platform as the ultimate hype-free "
        "BS detector for frontier technology, and prompt the reader to click and check "
        "the empirical data."
    ),
    "high_level_pitch": (
        "### CAMPAIGN STRATEGY: High-Level Product Pitch (TOF/MOF / Acquisition)\n"
        "- Focus: Product-led introduction. Promote the Vision Feasibility Monitor "
        "itself.\n"
        "- Style: Authoritative, clear, value-focused, highly accessible.\n"
        "- Core concept: Explain how our platform operates. We take a bold "
        "deep-tech vision, decompose it into a capability tree, crawl "
        "peer-reviewed papers (arXiv) and patent filings (USPTO) daily, "
        "and mathematically roll up all signal deltas into a 5-second "
        "feasibility index. It's collective, source-grounded truth.\n"
        "- Goal: Drive clear value proposition comprehension and early user acquisition."
    ),
    "actor_race": (
        "### CAMPAIGN STRATEGY: Lead Actor Competitive Dynamics (BOF / Ecosystem Race)\n"
        "- Focus: Showcase the ecosystem race between top organizations "
        "(startups, labs, corps) pursuing these capabilities.\n"
        "- Style: Competitive, business-oriented, analytical. Frame it as a "
        "technology race.\n"
        "- Goal: Highlight that we track actor contributions, and invite readers "
        "to explore the platform to see who holds the commercial lead."
    ),
    "grounded_digest": (
        "### CAMPAIGN STRATEGY: Evidence-Grounded Truth (MOF/BOF / Trust & Authority)\n"
        "- Focus: Position the platform as the ultimate source of truth against "
        "vague tech journalism.\n"
        "- Style: Fact-oriented, precise, objective, completely anti-hype.\n"
        "- Core concept: We don't guess, predict, or write PR hype. Every "
        "score delta drills to a verifiable primary source. The capability "
        "scores are peer-review grounded.\n"
        "- Goal: Win trust of serious developers, deeptech researchers, and "
        "long-term investors."
    ),
}


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
            max_tokens=8192,
            # Bilingual copy with a consistent insight across ko/en
            # benefits from a little planning before it commits to the
            # hook — cheap at balanced tier, better parity.
            adaptive_thinking=True,
            response_model=MarketingPostSet,
        )
        if result.parsed is None:
            raise RuntimeError(
                f"marketing_content returned unparseable output (stop_reason={result.stop_reason})"
            )
        assert isinstance(result.parsed, MarketingPostSet)
        return result.parsed

    @classmethod
    def _format_user_turn(cls, request: VisionMarketingSnapshot) -> str:
        if request.platform_promo:
            return cls._format_platform_promo_turn(request)

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
                score = f"{c.composite:.0f}/100" if c.composite is not None else "—"
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
                parts.append(f"  - moved a capability by {sign}{sig.dominant_delta:g} pts")
            if sig.summary:
                snippet = sig.summary[:400]
                parts.append(f"  > {snippet}{'…' if len(sig.summary) > 400 else ''}")
        else:
            parts.append(
                "\n## Most notable recent signal\n- (none in window — lead with "
                "the binding-constraint story instead; do not invent a signal.)"
            )

        concept = request.campaign_concept
        parts.append(
            f"\n\n## Campaign Strategy & Objective\n"
            f"{_STRATEGY_PROMPTS.get(concept, _STRATEGY_PROMPTS['vision_bottleneck'])}"
        )

        if request.custom_guidelines:
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

    @classmethod
    def _format_platform_promo_turn(cls, request: VisionMarketingSnapshot) -> str:
        """User turn for brand-level posts (no specific vision selected).

        No vision numbers are available, so the agent promotes the platform
        itself. We forbid fabricating a specific vision's figures and point
        the CTA at the homepage."""
        parts: list[str] = []
        parts.append("## Brand-level promotion — NO specific vision selected")
        parts.append(
            "This is a **platform/brand post**, not a single-vision post. The "
            "operator wants to promote the **Vision Feasibility Monitor** itself, "
            "kept general so it appeals beyond any one technology."
        )
        parts.append(f"**Home page (CTA target)**: {request.vision_url}")
        parts.append(f"**Audience**: {request.audience}")
        parts.append(
            "\n### What the platform is (use only this — invent no specifics)\n"
            "- We pick any bold technology vision (fusion power, orbital data "
            "centers, room-temperature superconductors, …).\n"
            "- We decompose it into the capabilities it needs and ingest daily "
            "source-grounded signals (arXiv papers, patents, news, filings).\n"
            "- We roll everything into one 0–100 feasibility number you can read "
            "in 5 seconds — gated by the weakest capability (Liebig's Law).\n"
            "- It is collective and source-grounded: every score delta drills to "
            "a primary source; the community proposes and builds visions together."
        )

        concept = request.campaign_concept
        parts.append(
            f"\n\n## Campaign Strategy & Objective\n"
            f"{_STRATEGY_PROMPTS.get(concept, _STRATEGY_PROMPTS['high_level_pitch'])}"
        )

        if request.custom_guidelines:
            parts.append(
                f"\n\n## Custom Tone & Example Guidelines (CRITICAL OVERRIDE)\n"
                f"Please strictly apply the following operator-defined custom tone, "
                f"style, and example post guidelines for each platform:\n"
                f"{request.custom_guidelines}"
            )

        platforms = ", ".join(request.platforms)
        parts.append(
            f"\n\nWrite one post per platform ({platforms}), each with ko + en "
            "variants and hashtags. Speak about the platform in general — do NOT "
            "name a specific vision's score, capability, signal, or actor (you "
            "have none). Invent no numbers. The CTA invites the reader to explore "
            "the monitor for free. Output only the MarketingPostSet schema."
        )
        return "\n".join(parts)
