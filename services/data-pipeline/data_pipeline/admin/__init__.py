"""SQLAdmin-based admin surface (M55).

Replaces the deprecated `apps/admin/` Next.js app. Mounted by
`data_pipeline.main.create_app` at `/admin` on the same FastAPI process
that serves the pipeline endpoints. One process, one auth gate, one
URL.

Public entry point: `mount_admin(app)` — wires the AsyncEngine, the
AuthenticationBackend, every ModelView, and the custom queue/Vision
Builder pages. Called once at FastAPI startup; idempotent.
"""

from data_pipeline.admin.mount import mount_admin

__all__ = ["mount_admin"]
