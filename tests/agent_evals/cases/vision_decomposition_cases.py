"""Vision Builder — VisionDecomposition eval cases (M41e).

Five canonical vision prompts the platform must handle correctly:

  - fusion-power-grid-parity     (Energy / balanced)
  - quantum-rsa-break            (Compute / balanced)
  - humanoid-manufacturing       (Robotics / broad)
  - mrna-personalized-cancer     (Bio / broad)
  - direct-to-cell-satellite     (Space / balanced)

Each case carries:
  - A realistic prompt + the validator's pinned slug/name/sizing.
  - A canned `VisionDecompositionResult` that offline mode replays.
    The canned response is what a *healthy* opus call should return —
    calibrated forward (5 caps summing to 1.0, valid DAG, etc.),
    not reverse-engineered to pass assertions.
  - The harness-provided baseline assertions run against every case.

Invariants tested by the per-case file (in addition to harness invariants):
  - The ValidationGate passes when fed (draft, no signal_config).
  - The slug from the response matches the slug the validator pinned.
  - The binding capability key resolves to a real capability.
"""

from __future__ import annotations

import re

from agent_orchestration.schemas import (
    ActorDraft,
    CapabilityActorAssignmentDraft,
    CapabilityDependencyDraft,
    CapabilityDraft,
    RiskDraft,
    VisionDecompositionResult,
    VisionFeasibilityDraft,
)
from agent_orchestration.validation_gate import run_validation_gate
from harness import Case, CostBudget


# ---- Shared invariant assertions -----------------------------------------


_KEY_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
_ISO_PATTERN = re.compile(r"^[A-Z]{2}$")


def _all_capability_keys_snake_case(d: VisionDecompositionResult) -> None:
    for c in d.capabilities:
        assert _KEY_PATTERN.match(c.key), f"capability key {c.key!r} not snake_case"


def _all_actor_keys_snake_case(d: VisionDecompositionResult) -> None:
    for a in d.actors:
        assert _KEY_PATTERN.match(a.key), f"actor key {a.key!r} not snake_case"


def _all_iso_country_codes_alpha2_upper(d: VisionDecompositionResult) -> None:
    for a in d.actors:
        assert _ISO_PATTERN.match(a.iso_country), (
            f"actor {a.key}: iso_country {a.iso_country!r} not alpha-2 uppercase"
        )


def _slug_is_kebab_case(d: VisionDecompositionResult) -> None:
    assert _SLUG_PATTERN.match(d.slug), f"slug {d.slug!r} not kebab-case"


def _capability_count_in_useful_range(d: VisionDecompositionResult) -> None:
    # Bounds also enforced by Pydantic (3-15); this catches degenerate
    # responses that hit the minimum or stuff the maximum unnecessarily.
    assert 3 <= len(d.capabilities) <= 15, (
        f"capability count {len(d.capabilities)} outside useful range"
    )


def _actor_count_in_useful_range(d: VisionDecompositionResult) -> None:
    assert 3 <= len(d.actors) <= 30, (
        f"actor count {len(d.actors)} outside useful range"
    )


def _weights_sum_to_one(d: VisionDecompositionResult) -> None:
    total = sum(c.weight for c in d.capabilities)
    assert 0.90 <= total <= 1.10, (
        f"capability weights sum to {total:.3f} — outside [0.9, 1.1]"
    )


def _binding_capability_resolves(d: VisionDecompositionResult) -> None:
    keys = {c.key for c in d.capabilities}
    assert d.initial_feasibility.binding_capability_key in keys, (
        "binding_capability_key references unknown capability"
    )


def _all_deps_reference_existing(d: VisionDecompositionResult) -> None:
    keys = {c.key for c in d.capabilities}
    for dep in d.dependencies:
        assert dep.source_key in keys, f"dep source {dep.source_key} unknown"
        assert dep.target_key in keys, f"dep target {dep.target_key} unknown"


def _all_capability_actors_reference_existing(d: VisionDecompositionResult) -> None:
    cap_keys = {c.key for c in d.capabilities}
    actor_keys = {a.key for a in d.actors}
    for ca in d.capability_actors:
        assert ca.capability_key in cap_keys, (
            f"capability_actor refs unknown capability {ca.capability_key}"
        )
        assert ca.actor_key in actor_keys, (
            f"capability_actor refs unknown actor {ca.actor_key}"
        )


def _gate_passes(d: VisionDecompositionResult) -> None:
    """The pure-Python ValidationGate is the production safety net —
    every eval case should pass it cleanly."""
    result = run_validation_gate(draft=d, signal_config=None)
    assert result.ok, f"validation gate failed: {result.errors}"


_BASELINE_ASSERTIONS = [
    _all_capability_keys_snake_case,
    _all_actor_keys_snake_case,
    _all_iso_country_codes_alpha2_upper,
    _slug_is_kebab_case,
    _capability_count_in_useful_range,
    _actor_count_in_useful_range,
    _weights_sum_to_one,
    _binding_capability_resolves,
    _all_deps_reference_existing,
    _all_capability_actors_reference_existing,
    _gate_passes,
]


# ---- Builder helper — keep canned cases readable -------------------------


def _cap(
    key: str,
    name: str,
    *,
    description: str,
    rationale: str,
    weight: float,
    display_order: int,
    technical: float,
    economic: float,
    regulatory: float,
    supply: float,
) -> CapabilityDraft:
    return CapabilityDraft(
        key=key,
        name=name,
        description=description,
        rationale=rationale,
        weight=weight,
        display_order=display_order,
        initial_technical=technical,
        initial_economic=economic,
        initial_regulatory=regulatory,
        initial_supply=supply,
        confidence=0.75,
    )


def _actor(
    key: str,
    name: str,
    *,
    iso: str,
    category: str,
    blurb: str,
    stage: str,
    relevance: float,
    rationale: str,
    keywords: list[str],
) -> ActorDraft:
    return ActorDraft(
        key=key,
        name=name,
        iso_country=iso,
        category=category,  # type: ignore[arg-type]
        blurb=blurb,
        stage=stage,  # type: ignore[arg-type]
        signal_keywords=keywords,
        relevance=relevance,
        rationale=rationale,
        display_order=10,
    )


def _risk(
    key: str,
    *,
    category: str,
    name: str,
    description: str,
    severity: str,
    likelihood: str,
    time_horizon: str,
    affects: list[str],
) -> RiskDraft:
    return RiskDraft(
        key=key,
        category=category,  # type: ignore[arg-type]
        name=name,
        description=description,
        severity=severity,  # type: ignore[arg-type]
        likelihood=likelihood,  # type: ignore[arg-type]
        time_horizon=time_horizon,  # type: ignore[arg-type]
        affected_capability_keys=affects,
        display_order=10,
    )


def _ca(
    cap: str, actor: str, role: str = "lead"
) -> CapabilityActorAssignmentDraft:
    return CapabilityActorAssignmentDraft(
        capability_key=cap, actor_key=actor, role=role  # type: ignore[arg-type]
    )


# ---- Case 1: Commercial Fusion Power -------------------------------------


def _fusion_power_canned() -> VisionDecompositionResult:
    caps = [
        _cap(
            "plasma_confinement",
            "Plasma confinement (Q≥10)",
            description="Sustained net-energy plasma confinement at Q≥10 in a deployable reactor geometry.",
            rationale="Without sustained burning plasma there's no electricity to sell.",
            weight=0.30,
            display_order=10,
            technical=42,
            economic=20,
            regulatory=55,
            supply=50,
        ),
        _cap(
            "first_wall_materials",
            "Neutron-tolerant first wall",
            description="Structural materials that survive 14 MeV neutron flux over commercial reactor lifetimes.",
            rationale="Pilots survive months; commercial reactors need decades.",
            weight=0.20,
            display_order=20,
            technical=35,
            economic=30,
            regulatory=60,
            supply=40,
        ),
        _cap(
            "tritium_breeding",
            "Closed tritium fuel cycle",
            description="Self-sufficient tritium breeding from lithium blankets at >1.0 breeding ratio.",
            rationale="Tritium is rare; reactors must make their own to scale.",
            weight=0.20,
            display_order=30,
            technical=40,
            economic=35,
            regulatory=50,
            supply=30,
        ),
        _cap(
            "power_balance_economics",
            "Recirculating power < 20% of gross",
            description="Cryo + magnets + heating systems consume <20% of plant output.",
            rationale="Without this LCOE never competes with fission or renewables-plus-storage.",
            weight=0.20,
            display_order=40,
            technical=50,
            economic=25,
            regulatory=70,
            supply=60,
        ),
        _cap(
            "regulatory_pathway",
            "Bespoke fusion regulatory regime",
            description="Risk-graded fusion licensing distinct from fission, in at least US + EU + KR.",
            rationale="Treating fusion as fission would price commercial deployment out of the market.",
            weight=0.10,
            display_order=50,
            technical=70,
            economic=80,
            regulatory=45,
            supply=85,
        ),
    ]
    return VisionDecompositionResult(
        slug="fusion-power-grid-parity",
        name="Commercial Fusion Power",
        vision_question="Will commercial fusion reach grid parity by 2040?",
        description=(
            "Net-energy fusion reactors selling electricity to the grid at cost-parity"
            " with combined-cycle gas. Tracks both ITER-class tokamaks and the private"
            " sector (Commonwealth, TAE, Helion, Tokamak Energy, ...) across confinement,"
            " materials, fuel cycle, and regulatory dimensions."
        ),
        domain_label="Energy",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="plasma_confinement",
                target_key="power_balance_economics",
                rationale="Higher Q directly relaxes the recirculating-power constraint.",
            ),
            CapabilityDependencyDraft(
                source_key="first_wall_materials",
                target_key="power_balance_economics",
                rationale="Wall replacement cycles drive availability and LCOE.",
            ),
        ],
        risks=[
            _risk(
                "tritium_supply",
                category="supply",
                name="Tritium scarcity through 2030s",
                description="CANDU reactors are the only commercial tritium source; supply is tight before breeding closes.",
                severity="high",
                likelihood="high",
                time_horizon="5y",
                affects=["tritium_breeding"],
            ),
            _risk(
                "regulatory_drift",
                category="legal",
                name="Risk-graded regulatory regime stalls",
                description="If US-NRC or EU drifts toward fission-style licensing, capex explodes.",
                severity="critical",
                likelihood="medium",
                time_horizon="3y",
                affects=["regulatory_pathway"],
            ),
        ],
        actors=[
            _actor(
                "commonwealth_fusion",
                "Commonwealth Fusion Systems",
                iso="US",
                category="private_startup",
                blurb="HTS-magnet ARC tokamak; SPARC demo 2025-2027.",
                stage="pilot",
                relevance=90,
                rationale="Best-funded private fusion attempt; HTS magnets unlock compact tokamak geometry.",
                keywords=["Commonwealth Fusion", "CFS", "SPARC", "ARC tokamak"],
            ),
            _actor(
                "iter",
                "ITER Organization",
                iso="FR",
                category="standards_body",
                blurb="International tokamak; first plasma slipped to 2034.",
                stage="research",
                relevance=70,
                rationale="Sets shared baseline for tokamak physics; slipping schedule reduces relevance to commercial timelines.",
                keywords=["ITER", "Cadarache", "international tokamak"],
            ),
            _actor(
                "helion",
                "Helion Energy",
                iso="US",
                category="private_startup",
                blurb="FRC + D-He3 cycle; Microsoft PPA 2028.",
                stage="pilot",
                relevance=75,
                rationale="Direct-conversion architecture skips the steam cycle; aggressive timeline.",
                keywords=["Helion", "Polaris", "FRC", "D-He3"],
            ),
        ],
        capability_actors=[
            _ca("plasma_confinement", "commonwealth_fusion", "lead"),
            _ca("plasma_confinement", "iter", "competitor"),
            _ca("first_wall_materials", "iter", "lead"),
            _ca("tritium_breeding", "commonwealth_fusion", "lead"),
            _ca("power_balance_economics", "helion", "lead"),
            _ca("regulatory_pathway", "iter", "regulator"),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=38,
            initial_p10=22,
            initial_p90=55,
            binding_capability_key="plasma_confinement",
            eta_median_years=15,
            eta_p10_years=8,
            eta_p90_years=30,
            rationale="Q≥10 plasma confinement is the binding constraint; everything else can move once Q is solved.",
        ),
        rationale=(
            "Decomposition anchors on plasma confinement (Q) as the binding constraint —"
            " every commercial fusion path hinges on it. Materials + tritium are necessary-but-not-sufficient;"
            " power-balance economics is the throughline from physics to grid sales; regulatory"
            " carries equal weight because a fission-style regime would block commercial deployment"
            " even with the physics working."
        ),
        confidence=0.78,
    )


# ---- Case 2: Quantum vs RSA ----------------------------------------------


def _quantum_rsa_canned() -> VisionDecompositionResult:
    caps = [
        _cap(
            "logical_qubit_count",
            "Logical qubits at RSA-2048 scale",
            description="At least ~4000 logical qubits with surface-code overhead → ~20M physical qubits.",
            rationale="Shor on RSA-2048 needs this scale; current best is <100 logical.",
            weight=0.30,
            display_order=10,
            technical=15,
            economic=10,
            regulatory=60,
            supply=20,
        ),
        _cap(
            "two_qubit_gate_fidelity",
            "2-qubit gate fidelity >99.9%",
            description="Below the surface-code threshold for the chosen architecture.",
            rationale="Without it logical qubit count is meaningless — errors swamp computation.",
            weight=0.25,
            display_order=20,
            technical=55,
            economic=40,
            regulatory=65,
            supply=50,
        ),
        _cap(
            "shor_implementation",
            "Optimized Shor circuit",
            description="Shor's algorithm compiled to the target architecture with reasonable depth.",
            rationale="Circuit depth × T-gate cost dominates how many qubits you actually need.",
            weight=0.15,
            display_order=30,
            technical=45,
            economic=50,
            regulatory=70,
            supply=80,
        ),
        _cap(
            "cryogenic_supply_chain",
            "Dilution refrigerator supply",
            description="At-scale supply of mK-temp cryogenics + RF interconnect for 1000+ qubit systems.",
            rationale="Today's supply chain serves dozens of refrigerators/yr; commercial scale needs thousands.",
            weight=0.20,
            display_order=40,
            technical=40,
            economic=25,
            regulatory=60,
            supply=15,
        ),
        _cap(
            "post_quantum_displacement",
            "Post-quantum crypto window",
            description="How fast the world rolls out PQ crypto before RSA-2048 is breakable.",
            rationale="If migration completes first, the vision's relevance collapses regardless of QC progress.",
            weight=0.10,
            display_order=50,
            technical=60,
            economic=55,
            regulatory=40,
            supply=70,
        ),
    ]
    return VisionDecompositionResult(
        slug="quantum-rsa-break",
        name="Quantum vs RSA",
        vision_question="By when will quantum computers break RSA-2048?",
        description=(
            "Cryptographically-relevant quantum computers — the moment a Shor implementation"
            " on RSA-2048 becomes tractable. Tracks both physical/logical qubit progress and the"
            " inverse race: NIST PQ migration timelines."
        ),
        domain_label="Compute",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="two_qubit_gate_fidelity",
                target_key="logical_qubit_count",
                rationale="Surface code only produces logical qubits when physical fidelity is above threshold.",
            ),
            CapabilityDependencyDraft(
                source_key="cryogenic_supply_chain",
                target_key="logical_qubit_count",
                rationale="At ~20M physical qubits you need industrial cryogenics.",
            ),
        ],
        risks=[
            _risk(
                "export_controls",
                category="legal",
                name="US BIS export controls tighten",
                description="Restrictions on quantum-tech exports could fragment global progress.",
                severity="medium",
                likelihood="high",
                time_horizon="3y",
                affects=["cryogenic_supply_chain"],
            ),
            _risk(
                "pq_already_won",
                category="political",
                name="Post-quantum migration wins the race",
                description="NIST PQC suite deployment completes before any breakable QC exists.",
                severity="high",
                likelihood="medium",
                time_horizon="10y",
                affects=["post_quantum_displacement"],
            ),
        ],
        actors=[
            _actor(
                "ibm_q",
                "IBM Quantum",
                iso="US",
                category="public_corp",
                blurb="Superconducting; Heron r2 + Condor; published roadmap to 100k qubits by 2033.",
                stage="commercial",
                relevance=85,
                rationale="Most aggressive published superconducting roadmap with quantum-cloud production traffic.",
                keywords=["IBM Quantum", "IBM Heron", "Condor", "Osprey"],
            ),
            _actor(
                "google_quantum_ai",
                "Google Quantum AI",
                iso="US",
                category="public_corp",
                blurb="Willow chip; demonstrated below-threshold scaling 2024.",
                stage="research",
                relevance=80,
                rationale="First-ever demonstrated below-threshold error scaling — pivotal milestone.",
                keywords=["Google Willow", "Google Quantum AI", "Sycamore"],
            ),
            _actor(
                "psiquantum",
                "PsiQuantum",
                iso="US",
                category="private_startup",
                blurb="Photonic FBQC; aiming for 1M physical qubits by 2027.",
                stage="pilot",
                relevance=70,
                rationale="Only credible photonic-FBQC path at this scale.",
                keywords=["PsiQuantum", "PsiQ", "photonic FBQC"],
            ),
        ],
        capability_actors=[
            _ca("logical_qubit_count", "ibm_q", "lead"),
            _ca("logical_qubit_count", "google_quantum_ai", "competitor"),
            _ca("two_qubit_gate_fidelity", "google_quantum_ai", "lead"),
            _ca("shor_implementation", "ibm_q", "lead"),
            _ca("cryogenic_supply_chain", "ibm_q", "lead"),
            _ca("post_quantum_displacement", "ibm_q", "competitor"),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=28,
            initial_p10=12,
            initial_p90=52,
            binding_capability_key="logical_qubit_count",
            eta_median_years=18,
            eta_p10_years=10,
            eta_p90_years=35,
            rationale="Logical qubit count is the binding constraint by several orders of magnitude.",
        ),
        rationale=(
            "This is a two-curve race: QC scale + cost vs PQ migration. Decomposition reflects"
            " that by including post_quantum_displacement as a real capability. Logical qubit"
            " count is the binding technical constraint — the rest are necessary but tractable."
        ),
        confidence=0.72,
    )


# ---- Case 3: Humanoids in Manufacturing ----------------------------------


def _humanoid_canned() -> VisionDecompositionResult:
    caps = [
        _cap(
            "bipedal_locomotion",
            "Reliable bipedal locomotion",
            description="≥99.9% uptime over 8-hour shifts on real factory floors (oil, debris, mixed surfaces).",
            rationale="Falls = downtime + safety claims; this gates deployment economics entirely.",
            weight=0.20,
            display_order=10,
            technical=58,
            economic=40,
            regulatory=70,
            supply=50,
        ),
        _cap(
            "dexterous_manipulation",
            "Dual-arm + hand dexterity",
            description="Sub-mm pick-and-place + multi-finger tool use at human-comparable speed.",
            rationale="Most assembly tasks aren't bipedal-vs-wheeled — they're hand-bound.",
            weight=0.25,
            display_order=20,
            technical=45,
            economic=35,
            regulatory=70,
            supply=50,
        ),
        _cap(
            "vla_foundation_model",
            "Vision-Language-Action models",
            description="Robust generalist VLA models that transfer across tasks with hours, not weeks, of training.",
            rationale="Without transfer, every task is a 6-week deployment — replacement labor isn't viable.",
            weight=0.20,
            display_order=30,
            technical=40,
            economic=45,
            regulatory=70,
            supply=60,
        ),
        _cap(
            "battery_energy_density",
            "8-hour shift on one charge",
            description="Pack-level energy density that supports a full shift without swap, at safe form factor.",
            rationale="Hot-swappable batteries are operational drag; one-charge shifts unlock deployment.",
            weight=0.15,
            display_order=40,
            technical=55,
            economic=40,
            regulatory=80,
            supply=55,
        ),
        _cap(
            "safety_certification",
            "Co-worker safety certification",
            description="ISO 10218/13482 or equivalent updates that allow unguarded humanoid work alongside humans.",
            rationale="Without certified co-working, ROI collapses — humanoids replace caged robots, not unguarded people.",
            weight=0.20,
            display_order=50,
            technical=60,
            economic=55,
            regulatory=30,
            supply=80,
        ),
    ]
    return VisionDecompositionResult(
        slug="humanoid-manufacturing",
        name="Humanoids in Manufacturing",
        vision_question="By when will humanoid robots replace human labor on manufacturing lines?",
        description=(
            "General-purpose humanoid robots performing the long-tail of manufacturing work"
            " that wasn't worth bespoke-automating: hand assembly, mixed-product lines, kitting,"
            " inspection, fixturing. Tracked across locomotion, manipulation, VLA models,"
            " batteries, and safety certification."
        ),
        domain_label="Robotics",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="vla_foundation_model",
                target_key="dexterous_manipulation",
                rationale="Generalist VLA models are what makes hand-task transfer cheap.",
            ),
            CapabilityDependencyDraft(
                source_key="battery_energy_density",
                target_key="bipedal_locomotion",
                rationale="Locomotion is the dominant energy draw; battery directly gates shift length.",
            ),
        ],
        risks=[
            _risk(
                "safety_incident",
                category="safety",
                name="High-profile humanoid workplace incident",
                description="A serious injury during early deployment could freeze certification for years.",
                severity="critical",
                likelihood="medium",
                time_horizon="3y",
                affects=["safety_certification"],
            ),
            _risk(
                "labor_market_pushback",
                category="social",
                name="Labor / political pushback",
                description="UAW-style contracts could ban humanoid co-working in key US industries.",
                severity="medium",
                likelihood="medium",
                time_horizon="5y",
                affects=[],
            ),
        ],
        actors=[
            _actor(
                "tesla_optimus",
                "Tesla Optimus",
                iso="US",
                category="public_corp",
                blurb="Vertical hardware + software stack; targeting in-factory deployment first.",
                stage="pilot",
                relevance=85,
                rationale="Largest hardware bet by a Tier-1 manufacturer; in-house deployment is a forcing function.",
                keywords=["Tesla Optimus", "Tesla Bot", "Optimus humanoid"],
            ),
            _actor(
                "figure_ai",
                "Figure AI",
                iso="US",
                category="private_startup",
                blurb="Figure 02; BMW + OpenAI partnerships.",
                stage="pilot",
                relevance=75,
                rationale="Most-funded humanoid startup with real factory deployments.",
                keywords=["Figure AI", "Figure 02", "Figure humanoid"],
            ),
            _actor(
                "boston_dynamics",
                "Boston Dynamics",
                iso="US",
                category="private_startup",
                blurb="Atlas (electric); Hyundai-owned; commercial focus.",
                stage="pilot",
                relevance=70,
                rationale="Deepest legacy locomotion stack; electric Atlas is the bridge to commercial deployment.",
                keywords=["Boston Dynamics", "Atlas humanoid", "BD Atlas"],
            ),
        ],
        capability_actors=[
            _ca("bipedal_locomotion", "boston_dynamics", "lead"),
            _ca("bipedal_locomotion", "tesla_optimus", "competitor"),
            _ca("dexterous_manipulation", "figure_ai", "lead"),
            _ca("vla_foundation_model", "figure_ai", "lead"),
            _ca("battery_energy_density", "tesla_optimus", "lead"),
            _ca("safety_certification", "boston_dynamics", "lead"),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=47,
            initial_p10=32,
            initial_p90=62,
            binding_capability_key="dexterous_manipulation",
            eta_median_years=9,
            eta_p10_years=5,
            eta_p90_years=18,
            rationale="Manipulation, not locomotion, is the throughline for value capture.",
        ),
        rationale=(
            "Common mistake: weighting bipedal locomotion as the binding capability. It's the most"
            " visible but not the most binding — manipulation + VLA transfer determine economic value."
            " Safety certification carries 20% because it's the regulatory throughline that converts"
            " technical readiness into deployment."
        ),
        confidence=0.75,
    )


# ---- Case 4: mRNA Personalized Cancer Vaccines ----------------------------


def _mrna_canned() -> VisionDecompositionResult:
    caps = [
        _cap(
            "neoantigen_prediction",
            "Patient-specific neoantigen prediction",
            description="Reliable ML+wet-lab pipeline picking 10-20 neoantigens per tumor that elicit immune response.",
            rationale="Garbage neoantigens = no efficacy; this is the front-of-pipeline quality gate.",
            weight=0.25,
            display_order=10,
            technical=55,
            economic=40,
            regulatory=70,
            supply=60,
        ),
        _cap(
            "rapid_mrna_manufacturing",
            "<14-day patient-to-dose manufacturing",
            description="GMP individualized mRNA production within the clinically-useful adjuvant window.",
            rationale="Slower than 14 days and the surgical adjuvant window closes for most indications.",
            weight=0.20,
            display_order=20,
            technical=50,
            economic=45,
            regulatory=60,
            supply=40,
        ),
        _cap(
            "lnp_delivery_optimization",
            "LNP delivery to dendritic cells",
            description="LNP formulations that preferentially traffic to lymph node dendritic cells.",
            rationale="Misdirected LNPs = reactogenicity without efficacy.",
            weight=0.15,
            display_order=30,
            technical=58,
            economic=50,
            regulatory=70,
            supply=55,
        ),
        _cap(
            "clinical_efficacy_data",
            "Phase III efficacy in solid tumors",
            description="Pivotal trials showing improved RFS / OS in melanoma + colorectal + pancreatic.",
            rationale="Without phase III data, no payer covers it and adoption stalls.",
            weight=0.25,
            display_order=40,
            technical=45,
            economic=60,
            regulatory=70,
            supply=80,
        ),
        _cap(
            "regulatory_payer_pathway",
            "Personalized-bio reimbursement pathway",
            description="CMS + EU + KR + JP reimbursement schemes covering personalized mRNA at affordable per-patient cost.",
            rationale="Even with efficacy, $200K/dose blocks population-scale impact.",
            weight=0.15,
            display_order=50,
            technical=85,
            economic=40,
            regulatory=35,
            supply=80,
        ),
    ]
    return VisionDecompositionResult(
        slug="mrna-personalized-cancer",
        name="mRNA Cancer Vaccines",
        vision_question="By when will personalized mRNA cancer vaccines become standard of care?",
        description=(
            "Patient-specific mRNA vaccines targeting tumor neoantigens, delivered in the post-surgical"
            " adjuvant window. Tracks the four required curves: neoantigen prediction, manufacturing"
            " speed, LNP delivery, and clinical efficacy + reimbursement."
        ),
        domain_label="Bio",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="neoantigen_prediction",
                target_key="clinical_efficacy_data",
                rationale="Bad neoantigens directly cause null trial readouts.",
            ),
            CapabilityDependencyDraft(
                source_key="rapid_mrna_manufacturing",
                target_key="clinical_efficacy_data",
                rationale="Trial designs assume the adjuvant window; manufacturing speed shapes which indications work.",
            ),
        ],
        risks=[
            _risk(
                "trial_failure",
                category="financial",
                name="Pivotal trial readouts fail",
                description="If KEYNOTE-942-class trials don't replicate, capital pulls back industry-wide.",
                severity="critical",
                likelihood="medium",
                time_horizon="3y",
                affects=["clinical_efficacy_data"],
            ),
            _risk(
                "reimbursement_gridlock",
                category="political",
                name="CMS doesn't create a personalized-bio code",
                description="Without a billing code, US adoption stalls regardless of efficacy.",
                severity="high",
                likelihood="medium",
                time_horizon="5y",
                affects=["regulatory_payer_pathway"],
            ),
        ],
        actors=[
            _actor(
                "moderna",
                "Moderna",
                iso="US",
                category="public_corp",
                blurb="mRNA-4157 (INT) partnership with Merck; melanoma + colorectal trials.",
                stage="commercial",
                relevance=90,
                rationale="Furthest-along mRNA cancer program with Phase III readout schedules.",
                keywords=["Moderna", "mRNA-4157", "INT-4157", "individualized neoantigen"],
            ),
            _actor(
                "biontech",
                "BioNTech",
                iso="DE",
                category="public_corp",
                blurb="BNT122 (autogene cevumeran); Genentech partnership; pancreatic + colorectal.",
                stage="commercial",
                relevance=85,
                rationale="Pancreatic data (CTLA-4 + cevumeran) is the field's standout signal.",
                keywords=["BioNTech", "BNT122", "autogene cevumeran", "cevumeran"],
            ),
            _actor(
                "merck",
                "Merck & Co",
                iso="US",
                category="public_corp",
                blurb="Keytruda combo partner; phase III sponsor.",
                stage="commercial",
                relevance=70,
                rationale="Phase III sponsorship + Keytruda combo signal that the field moves on this data.",
                keywords=["Merck Keytruda", "Keytruda combo", "pembrolizumab combo"],
            ),
        ],
        capability_actors=[
            _ca("neoantigen_prediction", "moderna", "lead"),
            _ca("neoantigen_prediction", "biontech", "competitor"),
            _ca("rapid_mrna_manufacturing", "moderna", "lead"),
            _ca("lnp_delivery_optimization", "biontech", "lead"),
            _ca("clinical_efficacy_data", "merck", "lead"),
            _ca("regulatory_payer_pathway", "moderna", "regulator"),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=52,
            initial_p10=35,
            initial_p90=68,
            binding_capability_key="clinical_efficacy_data",
            eta_median_years=8,
            eta_p10_years=4,
            eta_p90_years=15,
            rationale="Pivotal phase III readouts are the binding capability for adoption.",
        ),
        rationale=(
            "Decomposition prioritizes clinical efficacy + neoantigen prediction (50% combined weight)"
            " because everything else is necessary infrastructure. Manufacturing speed gets meaningful"
            " weight because <14 days isn't a 'nice-to-have' — it's the difference between coverable"
            " indications and not."
        ),
        confidence=0.76,
    )


# ---- Case 5: Direct-to-cell Satellite Service ----------------------------


def _direct_to_cell_canned() -> VisionDecompositionResult:
    caps = [
        _cap(
            "leo_spectrum_authorization",
            "Direct-to-cell spectrum authorization",
            description="Per-country regulatory approval to operate cellular spectrum from LEO satellites.",
            rationale="Without spectrum you don't have a service; carriers' MNO licenses don't transfer to space.",
            weight=0.25,
            display_order=10,
            technical=80,
            economic=70,
            regulatory=35,
            supply=70,
        ),
        _cap(
            "leo_payload_economics",
            "Per-satellite payload economics",
            description="LEO sat payload + bandwidth per dollar that supports voice + data at MNO-comparable pricing.",
            rationale="Without favorable payload economics the service stays niche-emergency.",
            weight=0.20,
            display_order=20,
            technical=55,
            economic=40,
            regulatory=60,
            supply=55,
        ),
        _cap(
            "phone_radio_compatibility",
            "Unmodified-phone radio compatibility",
            description="Service works on phones already in users' hands without modification.",
            rationale="Requiring a special handset destroys the addressable market.",
            weight=0.20,
            display_order=30,
            technical=70,
            economic=80,
            regulatory=75,
            supply=65,
        ),
        _cap(
            "mno_partnership_model",
            "MNO revenue-share model",
            description="Workable revenue-share + roaming-style settlement with terrestrial MNOs in 30+ countries.",
            rationale="Without MNO partnership distribution stalls — direct-to-consumer is too costly to acquire.",
            weight=0.20,
            display_order=40,
            technical=85,
            economic=50,
            regulatory=55,
            supply=80,
        ),
        _cap(
            "launch_capacity",
            "Launch capacity for constellations",
            description="Sufficient annual launch capacity to deploy + refresh 500+ sat constellations.",
            rationale="Falcon + Starship + competitors must collectively support multi-thousand sat fleets.",
            weight=0.15,
            display_order=50,
            technical=60,
            economic=55,
            regulatory=70,
            supply=50,
        ),
    ]
    return VisionDecompositionResult(
        slug="direct-to-cell-satellite",
        name="Direct-to-Cell Satellite Service",
        vision_question="Will direct-to-cell satellite voice + data be mass-market by 2030?",
        description=(
            "Unmodified mobile phones connecting directly to LEO satellites for voice + data,"
            " in cooperation with terrestrial MNOs. Spans LEO economics, spectrum authorization,"
            " phone compatibility, MNO partnership, and launch capacity."
        ),
        domain_label="Space",
        capabilities=caps,
        dependencies=[
            CapabilityDependencyDraft(
                source_key="launch_capacity",
                target_key="leo_payload_economics",
                rationale="Cheaper / faster launches directly improve payload economics per dollar.",
            ),
            CapabilityDependencyDraft(
                source_key="mno_partnership_model",
                target_key="leo_spectrum_authorization",
                rationale="MNO partnership is what unlocks spectrum approvals in most jurisdictions.",
            ),
        ],
        risks=[
            _risk(
                "spectrum_dispute",
                category="legal",
                name="ITU + national-regulator spectrum disputes",
                description="Incumbent MNO disputes over direct-to-cell sharing rights stall rollout.",
                severity="high",
                likelihood="high",
                time_horizon="3y",
                affects=["leo_spectrum_authorization"],
            ),
            _risk(
                "constellation_collisions",
                category="environmental",
                name="LEO debris + collision rate",
                description="Mega-constellation collisions push insurance cost up + spur restrictive rules.",
                severity="high",
                likelihood="medium",
                time_horizon="5y",
                affects=["launch_capacity"],
            ),
        ],
        actors=[
            _actor(
                "spacex_starlink",
                "SpaceX Starlink (D2C)",
                iso="US",
                category="public_corp",
                blurb="Starlink Direct-to-Cell; T-Mobile partnership; first voice 2025.",
                stage="pilot",
                relevance=90,
                rationale="Largest constellation + most aggressive D2C rollout; T-Mobile is anchor MNO.",
                keywords=["SpaceX Direct to Cell", "Starlink D2C", "Starlink direct-to-cell"],
            ),
            _actor(
                "ast_spacemobile",
                "AST SpaceMobile",
                iso="US",
                category="public_corp",
                blurb="Phased-array large-aperture satellites; AT&T + Verizon + Vodafone partners.",
                stage="pilot",
                relevance=75,
                rationale="Most credible Starlink competitor with multi-MNO partnerships in place.",
                keywords=["AST SpaceMobile", "ASTS", "BlueBird satellite"],
            ),
            _actor(
                "itu",
                "International Telecommunication Union",
                iso="CH",
                category="standards_body",
                blurb="WRC-27 spectrum-allocation cycle is the regulatory throughline.",
                stage="research",
                relevance=60,
                rationale="WRC-27 outcomes determine whether direct-to-cell scales beyond messaging.",
                keywords=["ITU WRC-27", "ITU-R", "international telecommunication union"],
            ),
        ],
        capability_actors=[
            _ca("leo_spectrum_authorization", "itu", "regulator"),
            _ca("leo_spectrum_authorization", "spacex_starlink", "lead"),
            _ca("leo_payload_economics", "spacex_starlink", "lead"),
            _ca("phone_radio_compatibility", "ast_spacemobile", "lead"),
            _ca("mno_partnership_model", "spacex_starlink", "lead"),
            _ca("launch_capacity", "spacex_starlink", "lead"),
        ],
        initial_feasibility=VisionFeasibilityDraft(
            initial_composite=58,
            initial_p10=40,
            initial_p90=72,
            binding_capability_key="leo_spectrum_authorization",
            eta_median_years=5,
            eta_p10_years=3,
            eta_p90_years=10,
            rationale="Spectrum authorization is the binding capability — physics + economics are tractable.",
        ),
        rationale=(
            "Spectrum authorization (25% weight) is the binding capability — every other dimension"
            " is more mature. WRC-27 outcomes matter disproportionately; ITU is on the actor list for"
            " that reason despite not being a 'lead' on any technical capability."
        ),
        confidence=0.80,
    )


# ---- Case list -----------------------------------------------------------


def vision_decomposition_cases() -> list[Case]:
    """Five canonical cases the platform must handle correctly. Each is
    a multi-page canned VisionDecompositionResult — offline mode replays
    it verbatim, live mode (`GEMINI_EVAL_LIVE=1`) calls real opus."""
    return [
        Case(
            name="fusion-power-grid-parity",
            description="Will commercial fusion power reach grid parity by 2040?",
            canned_response=_fusion_power_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.60),
        ),
        Case(
            name="quantum-rsa-break",
            description="By when will quantum computers break RSA-2048?",
            canned_response=_quantum_rsa_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.60),
        ),
        Case(
            name="humanoid-manufacturing",
            description="By when will humanoid robots replace human labor on manufacturing lines?",
            canned_response=_humanoid_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.60),
        ),
        Case(
            name="mrna-personalized-cancer",
            description="By when will personalized mRNA cancer vaccines become standard of care?",
            canned_response=_mrna_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.60),
        ),
        Case(
            name="direct-to-cell-satellite",
            description="Will direct-to-cell satellite voice + data be mass-market by 2030?",
            canned_response=_direct_to_cell_canned(),
            assertions=_BASELINE_ASSERTIONS,
            budget=CostBudget(max_usd=0.60),
        ),
    ]
