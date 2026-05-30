from __future__ import annotations

import logging
from fastapi import APIRouter, Request, HTTPException, status
from sqlalchemy import text
from data_pipeline.admin.auth import _secret, URLSafeTimedSerializer, SESSION_TTL_SECONDS, _expected_email

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/api")

def verify_admin_auth(request: Request) -> dict:
    token = request.session.get("admin_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    secret = _secret()
    if not secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session secret unconfigured")
    serializer = URLSafeTimedSerializer(secret, salt="admin-session")
    try:
        payload = serializer.loads(token, max_age=SESSION_TTL_SECONDS)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token signature")
    expected_email = _expected_email()
    if expected_email and payload.get("email") != expected_email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User email rotated")
    return payload

async def get_table_counts(engine) -> dict[str, int]:
    tables = [
        "sectors", "capabilities", "capability_scores", "signals", "risks",
        "actors", "community_proposals", "users", "audit_logs", "crawl_runs"
    ]
    counts = {}
    async with engine.connect() as conn:
        for t in tables:
            try:
                res = await conn.execute(text(f"SELECT COUNT(*) FROM {t}"))
                counts[t] = res.scalar()
            except Exception as exc:
                log.warning("Dashboard API count failed for %s: %s", t, exc)
                counts[t] = 0
    return counts

async def get_recent_crawl_runs(engine) -> list[dict]:
    async with engine.connect() as conn:
        try:
            res = await conn.execute(text("""
                SELECT id, vision_slug, fetcher_kind, status, cost_usd, signals_written, started_at, ended_at
                FROM crawl_runs
                ORDER BY started_at DESC
                LIMIT 5
            """))
            rows = res.fetchall()
            return [
                {
                    "id": r[0],
                    "vision_slug": r[1],
                    "fetcher_kind": r[2],
                    "status": r[3],
                    "cost_usd": float(r[4]) if r[4] is not None else None,
                    "signals_written": r[5],
                    "started_at": r[6].isoformat() if r[6] is not None else None,
                    "ended_at": r[7].isoformat() if r[7] is not None else None,
                }
                for r in rows
            ]
        except Exception as exc:
            log.warning("Dashboard API crawl_runs fetch failed: %s", exc)
            return []

@router.get("/dashboard-data")
async def get_dashboard_data(request: Request):
    verify_admin_auth(request)
    
    parent_app = getattr(request.app.state, "parent_app", None)
    if not parent_app:
        raise HTTPException(status_code=500, detail="Parent application context missing")
        
    engine = getattr(parent_app.state, "_sqladmin_engine", None)
    if not engine:
        raise HTTPException(status_code=500, detail="SQLAdmin database engine missing")
        
    # 1. Table Counts
    counts = await get_table_counts(engine)
    
    # 2. Recent Crawl Runs
    crawl_runs = await get_recent_crawl_runs(engine)
    
    # 3. ARQ Queue Metrics
    queue_info = {
        "available": False,
        "queue_name": "offline",
        "queued": 0,
        "in_progress": 0,
        "workers": 0,
        "deferred": 0,
    }
    q = getattr(parent_app.state, "queue_client", None)
    if q is not None:
        try:
            snap = await q.snapshot()
            queue_info = {
                "available": True,
                "queue_name": snap.queue_name,
                "queued": snap.queued,
                "in_progress": snap.in_progress,
                "workers": snap.workers,
                "deferred": snap.deferred,
            }
        except Exception as exc:
            log.warning("Dashboard API queue snapshot failed: %s", exc)
            
    return {
        "counts": counts,
        "crawl_runs": crawl_runs,
        "queue": queue_info,
    }
