"""Shared base class + enum choice lists for the per-model view modules.

Every value in this file mirrors the corresponding ``// a | b | c``
comment in ``packages/db/prisma/schema.prisma`` — the schema comment
is the source of truth; this file is the cockpit's rendering of it.
When you add a new value to the schema enum, mirror it here too; no
validator will catch the drift, SQLAdmin will silently render the form
without it.

The pattern below is repeated per editable ModelView::

    form_overrides = {"<col>": SelectField}
    form_args      = {"<col>": {"choices": _XYZ_CHOICES, "coerce": str}}

A leading ``("", "—")`` choice is added for nullable enums
(Risk.source_kind, CapabilityActor.stage) via :data:`_NULLABLE_PREFIX`
so the operator can clear the field without tripping WTForms'
``validate_choice``.
"""

from __future__ import annotations

from sqladmin import ModelView

from data_pipeline.admin.format import KST_TYPE_FORMATTERS


class _BaseModelView(ModelView):
    """Shared defaults for every cockpit ModelView. Currently just the
    timezone-aware datetime formatter (KST or whatever
    ADMIN_DISPLAY_TZ resolves to) so the operator never sees a raw
    UTC timestamp in a list / details view."""

    # SQLAdmin overrides BASE_FORMATTERS per-view, so we hand it the
    # full map (None + bool + datetime) — losing the bool tick/cross
    # icon would be a regression.
    column_type_formatters = KST_TYPE_FORMATTERS


# Sector lifecycle (schema.prisma: draft | live | archived).
_SECTOR_STATUS_CHOICES: list[tuple[str, str]] = [
    ("draft", "draft — invisible on /visions, freshly built"),
    ("live", "live — published, surfaced to end users"),
    ("archived", "archived — soft-hidden from both UIs"),
]

# Risk taxonomy (schema.prisma Risk model).
_RISK_CATEGORY_CHOICES: list[tuple[str, str]] = [
    ("political", "political"),
    ("legal", "legal"),
    ("supply", "supply"),
    ("safety", "safety"),
    ("environmental", "environmental"),
    ("financial", "financial"),
    ("social", "social"),
]
_RISK_SEVERITY_CHOICES: list[tuple[str, str]] = [
    ("low", "low"),
    ("medium", "medium"),
    ("high", "high"),
    ("critical", "critical"),
]
_RISK_LIKELIHOOD_CHOICES: list[tuple[str, str]] = [
    ("low", "low"),
    ("medium", "medium"),
    ("high", "high"),
]
# time_horizon — schema comment says "free string so we can extend";
# we still pre-populate the known set and let admins add via DB if needed.
_RISK_TIME_HORIZON_CHOICES: list[tuple[str, str]] = [
    ("immediate", "immediate"),
    ("1y", "1y"),
    ("3y", "3y"),
    ("5y", "5y"),
    ("10y", "10y"),
]

# Shared by Risk.source_kind (nullable) + EconomicsDatapoint.source_kind +
# Signal.source_kind. Pulled from observed seed-data values, broader than
# the schema comment on EconomicsDatapoint.
_SOURCE_KIND_CHOICES: list[tuple[str, str]] = [
    ("analyst_report", "analyst_report"),
    ("filing", "filing"),
    ("gov_report", "gov_report"),
    ("news", "news"),
    ("paper", "paper"),
    ("patent", "patent"),
    ("press", "press"),
]

# Actor (schema.prisma Actor model).
_ACTOR_CATEGORY_CHOICES: list[tuple[str, str]] = [
    ("public_corp", "public_corp"),
    ("private_startup", "private_startup"),
    ("government_lab", "government_lab"),
    ("national_lab", "national_lab"),
    ("academic_lab", "academic_lab"),
    ("standards_body", "standards_body"),
    ("ngo", "ngo"),
]
# Shared by Actor.stage + CapabilityActor.stage (override).
_ACTOR_STAGE_CHOICES: list[tuple[str, str]] = [
    ("research", "research"),
    ("pilot", "pilot"),
    ("commercial", "commercial"),
    ("scaling", "scaling"),
]

# CapabilityActor.role (schema.prisma CapabilityActor model).
_CAPABILITY_ACTOR_ROLE_CHOICES: list[tuple[str, str]] = [
    ("lead", "lead — primary developer / consortium lead"),
    ("competitor", "competitor — alternative pursuing same outcome"),
    ("supplier", "supplier — upstream inputs"),
    ("customer", "customer — buys when ready"),
    ("regulator", "regulator — sets rules / approvals"),
]

# CommunityProposal lifecycle + payload kind (schema.prisma comments).
_PROPOSAL_TARGET_KIND_CHOICES: list[tuple[str, str]] = [
    ("add_driver", "add_driver"),
    ("add_equity", "add_equity"),
    ("add_capability", "add_capability"),
    ("add_risk", "add_risk"),
    ("add_actor", "add_actor"),
    ("add_signal_source", "add_signal_source"),
    ("edit", "edit"),
    ("other", "other"),
]
_PROPOSAL_STATUS_CHOICES: list[tuple[str, str]] = [
    ("open", "open — accepting votes"),
    ("review", "review — admin is looking"),
    ("applied", "applied — DB write succeeded"),
    ("rejected", "rejected"),
    ("stale", "stale — auto-aged out, no decision"),
]

# Empty-leading variant for nullable enum columns. WTForms' SelectField
# defaults to validate_choice=True, so an empty submit needs a matching
# ("", "—") option to clear the value instead of erroring.
_NULLABLE_PREFIX: list[tuple[str, str]] = [("", "— (none)")]
