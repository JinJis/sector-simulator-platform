"""M46b PredictionV2 resolver endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, FastAPI, HTTPException

from data_pipeline.jobs.resolve_predictions_v2 import ResolvePredictionsV2Result
from data_pipeline.jobs.runners import run_resolve_predictions_v2_job

log = logging.getLogger("data_pipeline")


def create_router(app: FastAPI) -> APIRouter:
    router = APIRouter(tags=["predictions"])

    @router.post(
        "/jobs/resolve-predictions-v2",
        response_model=ResolvePredictionsV2Result,
    )
    async def trigger_resolve_predictions_v2() -> ResolvePredictionsV2Result:
        if app.state.resolver_v2_repo is None:
            raise HTTPException(
                status_code=503,
                detail="prediction-v2 resolver unavailable — DATABASE_URL not configured",
            )
        log.info("data-pipeline: manual /jobs/resolve-predictions-v2 triggered")
        result = await run_resolve_predictions_v2_job(app=app)
        if result is None:
            raise HTTPException(status_code=503, detail="prediction-v2 resolver skipped")
        return result

    @router.get(
        "/jobs/resolve-predictions-v2/last",
        response_model=ResolvePredictionsV2Result,
    )
    async def last_resolve_predictions_v2() -> ResolvePredictionsV2Result:
        last: ResolvePredictionsV2Result | None = getattr(
            app.state, "last_resolve_v2_result", None
        )
        if last is None:
            raise HTTPException(
                status_code=404,
                detail="no prediction-v2 resolve has run since process start",
            )
        return last

    return router
