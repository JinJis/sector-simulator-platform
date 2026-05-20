from __future__ import annotations

from fastapi.testclient import TestClient
from simulation_service.main import app

client = TestClient(app)


def test_health() -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_list_includes_space_data_center() -> None:
    r = client.get("/sims")
    assert r.status_code == 200
    slugs = [s["slug"] for s in r.json()]
    assert "space-data-center" in slugs


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
