"""M28 — smoke tests for the new HTTP routes.

End-to-end HTTP coverage. Each new endpoint gets one happy-path test
proving the request shape lands, the workflow finishes, and the
expected output dict is on the response.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from tests.test_m28_workflows import (
    SAMPLE_CODE_GEN,
    SAMPLE_CODE_REVIEW,
    SAMPLE_DRIVER_INFERENCE,
    SAMPLE_EDGE_INFERENCE,
    SAMPLE_RESEARCH,
    _full_pipeline_factory,
)


def _wait_succeeded(app, wid: str, timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = app.get(f"/workflows/{wid}")
        assert r.status_code == 200, r.text
        body = r.json()
        if body["status"] not in ("pending", "running"):
            return body
        time.sleep(0.01)
    raise AssertionError(f"workflow {wid} did not finish in {timeout}s")


def test_research_route_smoke(app, fake_anthropic: Any) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_RESEARCH
    r = app.post(
        "/workflows/research",
        json={
            "description": "Orbital data centers powered by solar arrays.",
            "focus_areas": ["launch cost", "radiation tolerance"],
        },
    )
    assert r.status_code == 202, r.text
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid)
    assert body["status"] == "succeeded"
    assert body["kind"] == "research"
    assert body["output"]["summary"].startswith("LEO data centers")
    assert len(body["output"]["anchors"]) == 1


def test_driver_inference_route_smoke(
    app, fake_anthropic: Any, sample_decomposition: Any
) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_DRIVER_INFERENCE
    r = app.post(
        "/workflows/driver-inference",
        json={
            "decomposition": sample_decomposition.model_dump(),
            "research_brief": SAMPLE_RESEARCH.model_dump(),
        },
    )
    assert r.status_code == 202, r.text
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid)
    assert body["status"] == "succeeded"
    assert body["kind"] == "driver_inference"
    assert len(body["output"]["drivers"]) == 2


def test_code_gen_route_smoke(
    app, fake_anthropic: Any, sample_decomposition: Any
) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_CODE_GEN
    r = app.post(
        "/workflows/code-gen",
        json={
            "slug": "ai-memory-demand",
            "decomposition": sample_decomposition.model_dump(),
            "driver_inference": SAMPLE_DRIVER_INFERENCE.model_dump(),
            "edge_inference": SAMPLE_EDGE_INFERENCE.model_dump(),
        },
    )
    assert r.status_code == 202, r.text
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid)
    assert body["status"] == "succeeded"
    assert body["kind"] == "code_gen"
    assert "AIMemoryDemandSim" in body["output"]["source"]


def test_code_review_route_smoke(
    app, fake_anthropic: Any, sample_decomposition: Any
) -> None:
    fake_anthropic.messages.parsed_factory = lambda **kw: SAMPLE_CODE_REVIEW
    r = app.post(
        "/workflows/code-review",
        json={
            "source": SAMPLE_CODE_GEN.source,
            "decomposition": sample_decomposition.model_dump(),
            "driver_inference": SAMPLE_DRIVER_INFERENCE.model_dump(),
            "edge_inference": SAMPLE_EDGE_INFERENCE.model_dump(),
            "concerns": list(SAMPLE_CODE_GEN.concerns),
        },
    )
    assert r.status_code == 202, r.text
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid)
    assert body["status"] == "succeeded"
    assert body["kind"] == "code_review"
    assert body["output"]["status"] == "revise"


def test_full_pipeline_route_smoke(
    app, fake_anthropic: Any, sample_decomposition: Any
) -> None:
    fake_anthropic.messages.parsed_factory = _full_pipeline_factory(
        sample_decomposition
    )
    r = app.post(
        "/workflows/full-pipeline",
        json={
            "description": "AI memory demand driven by HBM ramp and accelerator capex.",
            "focus_areas": ["HBM ASP trend"],
        },
    )
    assert r.status_code == 202, r.text
    wid = r.json()["id"]
    body = _wait_succeeded(app, wid, timeout=5.0)
    assert body["status"] == "succeeded", body.get("error")
    assert body["kind"] == "full_pipeline"
    out = body["output"]
    assert "research" in out
    assert "decomposition" in out
    assert "driver_inference" in out
    assert "edge_inference" in out
    assert "code_gen" in out
    assert "code_review" in out
    assert out["code_review"]["status"] == "revise"


@pytest.mark.parametrize(
    "path,body",
    [
        ("/workflows/research", {"description": "short"}),
        ("/workflows/full-pipeline", {"description": "short"}),
    ],
)
def test_routes_reject_short_descriptions(app, path: str, body: dict[str, Any]) -> None:
    r = app.post(path, json=body)
    assert r.status_code == 422, r.text
