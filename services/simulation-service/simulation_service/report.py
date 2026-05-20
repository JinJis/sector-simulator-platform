"""Deterministic markdown report builder.

Phase 2 will route through an LLM (with this templated version as a fallback
for cost / safety). The signature stays the same so the swap is local: take
a sim class + resolved drivers + optional scenario metadata, return a
`ReportResponse`.

Design choices
--------------
- No external dependencies. Stdlib `datetime` + plain string templating.
- Output is plain markdown; the client renders it. The structured `sources`
  field on the response is the same list the body cites — exposed
  separately so a client can build a sidebar / download a CSV without
  re-parsing the markdown.
- Sensitivity is computed once and shown as a top-5 for each scalar output.
- Series outputs are summarized as first/last/min/max so the report stays
  scannable. Full series remain available via `/sims/{slug}/run` for
  clients that want a chart.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from simulation_service.schemas import ReportRequest, ReportResponse, ReportSource

if TYPE_CHECKING:
    from platform_sdk import SimulationBase


_TOP_SENSITIVITY = 5
_SCALAR_SECTION = "## Headline outputs"
_SERIES_SECTION = "## Trajectories"
_OVERRIDES_SECTION = "## Driver overrides"
_SENSITIVITY_SECTION = "## Sensitivity (top drivers)"
_SOURCES_SECTION = "## Sources"


def build_report(
    *,
    sim_cls: type[SimulationBase],
    req: ReportRequest,
    resolved_drivers: dict[str, float],
) -> ReportResponse:
    sim = sim_cls()
    outputs = sim.simulate(**resolved_drivers)
    sensitivity = sim.sensitivity()

    generated_at = req.generated_at or datetime.now(UTC).isoformat(timespec="seconds")

    overrides = _compute_overrides(sim_cls, resolved_drivers)
    sources = _collect_sources(sim_cls)

    sections: list[str] = []
    sections.append(_header(sim_cls, req, generated_at, overrides_count=len(overrides)))
    sections.append(_describe(sim_cls))
    if req.scenario_notes:
        sections.append(f"> **Note**: {req.scenario_notes}")
    sections.append(_scalars(outputs))
    sections.append(_series(outputs))
    sections.append(_overrides_table(sim_cls, overrides))
    sections.append(_sensitivity_block(sim_cls, sensitivity, outputs))
    sections.append(_sources_block(sources))

    markdown = "\n\n".join(s for s in sections if s).strip() + "\n"
    return ReportResponse(
        slug=sim_cls.slug,
        generated_at=generated_at,
        markdown=markdown,
        sources=sources,
    )


# --- Section builders ---


def _header(
    sim_cls: type[SimulationBase],
    req: ReportRequest,
    generated_at: str,
    overrides_count: int,
) -> str:
    title_suffix = f" — {req.scenario_name}" if req.scenario_name else " — Defaults"
    return (
        f"# {sim_cls.name}{title_suffix}\n\n"
        f"_Generated {generated_at}_  \n"
        f"**Horizon**: {sim_cls.horizon_years} years  \n"
        f"**Active drivers**: {overrides_count} override"
        f"{'' if overrides_count == 1 else 's'} vs sector defaults"
    )


def _describe(sim_cls: type[SimulationBase]) -> str:
    if not sim_cls.description:
        return ""
    return f"## Overview\n\n{sim_cls.description}"


def _scalars(outputs: dict[str, object]) -> str:
    rows: list[str] = []
    for name, out in outputs.items():
        scalar = getattr(out, "scalar", None)
        if scalar is None:
            continue
        unit = getattr(out, "unit", "")
        description = getattr(out, "description", "")
        rows.append(
            f"| {_pretty(name)} | {_fmt_value(scalar, unit)} | {description} |"
        )
    if not rows:
        return ""
    return (
        f"{_SCALAR_SECTION}\n\n"
        "| Output | Value | Description |\n"
        "| --- | ---: | --- |\n" + "\n".join(rows)
    )


def _series(outputs: dict[str, object]) -> str:
    """Summarize series outputs as start → end + min / max. Keeps the
    report scannable; full series ship via /sims/{slug}/run."""
    rows: list[str] = []
    for name, out in outputs.items():
        series = getattr(out, "series", None)
        if not series:
            continue
        unit = getattr(out, "unit", "")
        start = series[0]
        end = series[-1]
        lo = min(series)
        hi = max(series)
        delta_pct = ""
        if start not in (0, 0.0) and start != float("inf"):
            delta_pct = f" ({(end / start - 1) * 100:+.1f}%)"
        rows.append(
            f"| {_pretty(name)} | {_fmt_value(start, unit)} | {_fmt_value(end, unit)}"
            f"{delta_pct} | {_fmt_value(lo, unit)} – {_fmt_value(hi, unit)} |"
        )
    if not rows:
        return ""
    return (
        f"{_SERIES_SECTION}\n\n"
        "| Series | Start (y0) | End | Range |\n"
        "| --- | ---: | ---: | ---: |\n" + "\n".join(rows)
    )


def _overrides_table(
    sim_cls: type[SimulationBase],
    overrides: list[tuple[str, float, float]],
) -> str:
    if not overrides:
        return (
            f"{_OVERRIDES_SECTION}\n\n"
            "_All drivers at sector defaults._"
        )
    rows: list[str] = []
    for name, value, default in overrides:
        driver = sim_cls.drivers[name]
        delta = value - default
        delta_pct = ""
        if default != 0:
            delta_pct = f" ({delta / abs(default) * 100:+.1f}%)"
        rows.append(
            f"| {_pretty(name)} | "
            f"{_fmt_value(value, driver.unit)} | "
            f"{_fmt_value(default, driver.unit)} | "
            f"{_fmt_value(delta, driver.unit)}{delta_pct} |"
        )
    return (
        f"{_OVERRIDES_SECTION}\n\n"
        "| Driver | Value | Default | Δ |\n"
        "| --- | ---: | ---: | ---: |\n" + "\n".join(rows)
    )


def _sensitivity_block(
    sim_cls: type[SimulationBase],
    sensitivity: dict[str, dict[str, float]],
    outputs: dict[str, object],
) -> str:
    if not sensitivity:
        return ""
    blocks: list[str] = [_SENSITIVITY_SECTION, ""]
    for out_name, drivers in sensitivity.items():
        if not drivers:
            continue
        unit = getattr(outputs.get(out_name), "unit", "") if out_name in outputs else ""
        ranked = sorted(drivers.items(), key=lambda kv: abs(kv[1]), reverse=True)
        top = ranked[:_TOP_SENSITIVITY]
        if not top:
            continue
        blocks.append(f"### {_pretty(out_name)}")
        for i, (driver_name, swing) in enumerate(top, start=1):
            driver_unit = sim_cls.drivers[driver_name].unit if driver_name in sim_cls.drivers else ""
            blocks.append(
                f"{i}. **{_pretty(driver_name)}**"
                f"{f' ({driver_unit})' if driver_unit else ''}"
                f" — swing {_fmt_value(swing, unit)}"
            )
        blocks.append("")
    block = "\n".join(blocks).rstrip()
    return block if len(blocks) > 2 else ""


def _sources_block(sources: list[ReportSource]) -> str:
    if not sources:
        return ""
    by_kind: dict[str, list[ReportSource]] = {}
    for s in sources:
        by_kind.setdefault(s.kind or "unclassified", []).append(s)
    # Render in display-stable order (alphabetical kind for now — the web
    # client can re-sort using its own SOURCE_KIND_ORDER if it wants).
    parts: list[str] = [_SOURCES_SECTION, ""]
    for kind in sorted(by_kind):
        kind_sources = by_kind[kind]
        parts.append(f"### {kind} ({len(kind_sources)})")
        for s in kind_sources:
            link = f"[{s.title}]({s.url})" if s.url else s.title
            asof = f" — {s.as_of}" if s.as_of else ""
            driver_list = ", ".join(_pretty(d) for d in s.drivers[:3])
            backs = f" · backs {driver_list}" if driver_list else ""
            parts.append(f"- {link}{asof}{backs}")
        parts.append("")
    return "\n".join(parts).rstrip()


# --- Helpers ---


def _compute_overrides(
    sim_cls: type[SimulationBase], resolved: dict[str, float]
) -> list[tuple[str, float, float]]:
    """Return (name, value, default) for drivers whose value differs from
    the sim's default. Tolerates floats by comparing to a small epsilon."""
    out: list[tuple[str, float, float]] = []
    for name, driver in sim_cls.drivers.items():
        v = resolved.get(name, driver.default)
        if abs(v - driver.default) > 1e-9:
            out.append((name, v, driver.default))
    return out


def _collect_sources(sim_cls: type[SimulationBase]) -> list[ReportSource]:
    """Walk every driver's provenance, dedupe by (title, url, as_of), and
    keep a list of drivers each source backs."""
    keyed: dict[tuple[str, str, str], ReportSource] = {}
    order: list[tuple[str, str, str]] = []
    for driver_name, prov in sim_cls.provenance.items():
        for s in prov.sources:
            key = (s.title, s.url, s.as_of)
            existing = keyed.get(key)
            if existing is None:
                keyed[key] = ReportSource(
                    title=s.title,
                    url=s.url,
                    as_of=s.as_of,
                    kind=s.kind,
                    drivers=[driver_name],
                )
                order.append(key)
            else:
                if driver_name not in existing.drivers:
                    existing.drivers.append(driver_name)
    return [keyed[k] for k in order]


def _pretty(snake: str) -> str:
    # Lightweight mirror of the client's prettyName(). Kept here so the
    # markdown reads the same with or without the client. We deliberately
    # do not import a shared util — keeps service surface lean.
    s = snake.replace("_", " ")
    for upper in ("usd", "pflops", "npv", "kw", "kg", "mw", "mwh", "co2", "h2", "om"):
        s = s.replace(f" {upper} ", f" {upper.upper()} ")
        if s.endswith(f" {upper}"):
            s = s[: -len(upper)] + upper.upper()
        if s.startswith(f"{upper} "):
            s = upper.upper() + s[len(upper) :]
    return s.strip()


def _fmt_value(v: float, unit: str) -> str:
    if v is None:
        return "—"
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return str(v)
    if fv != fv:  # NaN
        return "—"
    if fv == float("inf") or fv == float("-inf"):
        return "∞"
    absv = abs(fv)
    if unit in ("USD", "$"):
        sign = "-" if fv < 0 else ""
        if absv >= 1e9:
            return f"{sign}${absv / 1e9:.2f}B"
        if absv >= 1e6:
            return f"{sign}${absv / 1e6:.2f}M"
        if absv >= 1e3:
            return f"{sign}${absv / 1e3:.1f}k"
        return f"{sign}${absv:.0f}"
    body: str
    if absv >= 1e6:
        body = f"{fv / 1e6:.2f}M"
    elif absv >= 1e3:
        body = f"{fv / 1e3:.1f}k"
    elif absv >= 10 or fv.is_integer():
        body = f"{fv:.1f}"
    else:
        body = f"{fv:.2f}"
    return f"{body} {unit}".strip() if unit else body
