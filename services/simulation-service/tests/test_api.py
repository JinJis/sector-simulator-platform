from __future__ import annotations

from fastapi.testclient import TestClient
from simulation_service.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_list_includes_all_registered_sectors() -> None:
    r = client.get("/sims")
    assert r.status_code == 200
    slugs = {s["slug"] for s in r.json()}
    assert {"space-data-center", "memory-semi", "sofc"} <= slugs


def test_memory_semi_metadata_round_trip() -> None:
    r = client.get("/sims/memory-semi")
    assert r.status_code == 200
    meta = r.json()
    assert meta["horizon_years"] == 10
    groups = {d["group"] for d in meta["drivers"]}
    assert groups == {"Demand", "Pricing", "Supply", "Cost"}
    # Provenance carries kind labels for every cited source.
    for prov in meta["provenance"].values():
        for s in prov["sources"]:
            assert s["kind"], f"missing kind on source: {s['title']}"


def test_sofc_metadata_round_trip() -> None:
    r = client.get("/sims/sofc")
    assert r.status_code == 200
    meta = r.json()
    assert meta["horizon_years"] == 20
    groups = {d["group"] for d in meta["drivers"]}
    assert groups == {"System", "Stack", "Fuel", "Operations", "Economics"}


def test_new_sector_run_endpoint_returns_outputs() -> None:
    for slug, override_driver, output_check in [
        ("memory-semi", "ai_dram_demand_cagr_pct", "npv_free_cash_flow_usd"),
        ("sofc", "natural_gas_price_usd_per_mmbtu", "lcoe_usd_per_mwh"),
    ]:
        r = client.post(f"/sims/{slug}/run", json={"drivers": {override_driver: 1.0}})
        assert r.status_code == 200, slug
        names = {o["name"] for o in r.json()["outputs"]}
        assert output_check in names, slug


def test_metadata_exposes_groups_and_presets() -> None:
    r = client.get("/sims/space-data-center")
    assert r.status_code == 200
    meta = r.json()
    assert meta["horizon_years"] == 15
    assert len(meta["drivers"]) == 14
    groups = {d["group"] for d in meta["drivers"]}
    assert groups == {"Launch", "Compute", "Power", "Thermal", "Economics"}
    assert "Baseline (2026)" in meta["presets"]
    assert "Optimistic (Starship era)" in meta["presets"]


def test_run_with_overrides_returns_outputs() -> None:
    r = client.post(
        "/sims/space-data-center/run",
        json={"drivers": {"compute_demand_pflops": 100.0}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["drivers"]["compute_demand_pflops"] == 100.0
    names = {o["name"] for o in body["outputs"]}
    assert "system_capex_usd" in names
    assert "npv_savings_vs_ground_usd" in names


def test_run_with_unknown_driver_returns_400() -> None:
    r = client.post("/sims/space-data-center/run", json={"drivers": {"bogus_lever": 1.0}})
    assert r.status_code == 400
    assert "Unknown drivers" in r.json()["detail"]


def test_sensitivity_endpoint_ranked_descending() -> None:
    r = client.get("/sims/space-data-center/sensitivity")
    assert r.status_code == 200
    by_output = r.json()["by_output"]
    assert "npv_savings_vs_ground_usd" in by_output
    swings = [abs(e["swing"]) for e in by_output["npv_savings_vs_ground_usd"]]
    assert swings == sorted(swings, reverse=True)


def test_unknown_slug_returns_404() -> None:
    r = client.get("/sims/does-not-exist")
    assert r.status_code == 404
    r = client.get("/sims/does-not-exist/sensitivity")
    assert r.status_code == 404
