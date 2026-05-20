from __future__ import annotations

from fastapi.testclient import TestClient
from simulation_service.main import app

client = TestClient(app)


def _post(slug: str, body: dict | None = None) -> dict:
    r = client.post(f"/sims/{slug}/report", json=body or {})
    assert r.status_code == 200, (r.status_code, r.text)
    return r.json()


def test_report_endpoint_returns_markdown_for_defaults() -> None:
    body = _post("space-data-center")
    assert body["slug"] == "space-data-center"
    assert body["markdown"].startswith("# Space Data Center"), body["markdown"][:80]
    # No overrides → "All drivers at sector defaults" sentence appears.
    assert "All drivers at sector defaults" in body["markdown"]


def test_report_lists_overrides_when_drivers_diverge_from_defaults() -> None:
    body = _post(
        "space-data-center",
        {
            "drivers": {"launch_cost_usd_per_kg": 300.0, "compute_demand_pflops": 100.0},
            "scenario_name": "Aggressive launch",
        },
    )
    md = body["markdown"]
    assert "Aggressive launch" in md  # scenario name reaches the title
    assert "## Driver overrides" in md
    # Override rows show the new value, the default, and the percent delta.
    # `$/kg` isn't the "USD" unit, so it formats as `300.0 $/kg`.
    assert "300.0 $/kg" in md
    assert "1.5k $/kg" in md
    # 300 vs default 1500 → −80%; the sign should show up explicitly.
    assert "-80.0%" in md
    assert "Active drivers**: 2 overrides" in md


def test_report_collects_distinct_sources_with_driver_backrefs() -> None:
    body = _post("space-data-center")
    sources = body["sources"]
    assert len(sources) > 0
    # Each source carries kind + at least one driver it backs.
    for s in sources:
        assert "kind" in s and "drivers" in s
        assert isinstance(s["drivers"], list) and len(s["drivers"]) >= 1
    # No duplicate citations (deduped by (title, url, as_of)).
    keys = {(s["title"], s["url"], s["as_of"]) for s in sources}
    assert len(keys) == len(sources)


def test_report_sensitivity_top_drivers_shown_per_scalar() -> None:
    md = _post("space-data-center")["markdown"]
    assert "## Sensitivity (top drivers)" in md
    # The headline output should appear as a subsection.
    assert "### NPV savings vs ground" in md or "### NPV" in md


def test_report_handles_unknown_driver_with_400() -> None:
    r = client.post(
        "/sims/space-data-center/report",
        json={"drivers": {"bogus_lever": 1.0}},
    )
    assert r.status_code == 400
    assert "Unknown drivers" in r.json()["detail"]


def test_report_returns_404_for_unknown_slug() -> None:
    r = client.post("/sims/does-not-exist/report", json={})
    assert r.status_code == 404


def test_report_works_for_all_registered_sectors() -> None:
    """Report shape is sector-agnostic; verify each registered sim builds
    without errors and returns non-trivial markdown."""
    for slug in ("space-data-center", "memory-semi", "sofc"):
        body = _post(slug)
        assert body["slug"] == slug
        assert len(body["markdown"]) > 500, f"{slug} report unexpectedly short"
        assert "## Headline outputs" in body["markdown"], slug


def test_report_includes_scenario_notes_when_provided() -> None:
    body = _post(
        "memory-semi",
        {
            "drivers": {"hbm_premium_x": 7.0},
            "scenario_name": "AI super-cycle",
            "scenario_notes": "Bull case: HBM premium holds longer than analyst consensus.",
        },
    )
    md = body["markdown"]
    assert "Bull case" in md
    assert "AI super-cycle" in md
