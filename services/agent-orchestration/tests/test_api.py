"""End-to-end HTTP tests using TestClient + fake LLM. Exercises the full
request → workflow → response path."""

from __future__ import annotations

import time


def _wait_succeeded(app, wid: str, timeout: float = 2.0) -> dict:
    """Poll /workflows/{id} until it leaves the running state."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = app.get(f"/workflows/{wid}")
        assert r.status_code == 200, r.text
        body = r.json()
        if body["status"] not in ("pending", "running"):
            return body
        time.sleep(0.01)
    raise AssertionError(f"workflow {wid} did not finish in {timeout}s")


def test_health_endpoint(app) -> None:
    r = app.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_post_decompose_returns_202_with_workflow_record(app) -> None:
    r = app.post(
        "/workflows/decompose",
        json={"description": "An asteroid mining sector — capex, dev cycles, ore grades."},
    )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["kind"] == "decomposition"
    assert body["id"].startswith("wf_")
    assert body["status"] in ("pending", "running")
    assert body["input"]["description"].startswith("An asteroid mining")


def test_workflow_completes_and_carries_output(app) -> None:
    r = app.post(
        "/workflows/decompose",
        json={"description": "A green-hydrogen production sector for industrial off-takers."},
    )
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid)
    assert body["status"] == "succeeded"
    assert body["output"] is not None
    assert body["output"]["slug"] == "ai-memory-demand"  # echoed from the fixture
    assert body["output"]["drivers"]
    assert body["cost_usd"] > 0


def test_get_unknown_workflow_returns_404(app) -> None:
    r = app.get("/workflows/wf_does-not-exist")
    assert r.status_code == 404


def test_post_decompose_rejects_too_short_description(app) -> None:
    r = app.post("/workflows/decompose", json={"description": "short"})
    assert r.status_code == 422
    assert "at least 10 characters" in r.text or "min_length" in r.text


def test_list_workflows_returns_most_recent_first(app) -> None:
    ids = []
    for i in range(3):
        r = app.post(
            "/workflows/decompose",
            json={"description": f"Run number {i} for the listing test"},
        )
        ids.append(r.json()["id"])
        time.sleep(0.01)
    listed = app.get("/workflows").json()
    listed_ids = [w["id"] for w in listed]
    # The 3 we just kicked off are the most recent — newest first.
    assert listed_ids[:3] == list(reversed(ids))


def test_list_workflows_filters_by_kind(app) -> None:
    app.post(
        "/workflows/decompose",
        json={"description": "One run to populate the filter test"},
    )
    listed = app.get("/workflows?kind=decomposition").json()
    assert all(w["kind"] == "decomposition" for w in listed)
    empty = app.get("/workflows?kind=nonexistent").json()
    assert empty == []
