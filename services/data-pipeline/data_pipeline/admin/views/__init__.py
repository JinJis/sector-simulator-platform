"""Per-model ModelView definitions for the SQLAdmin cockpit.

Split out of the old monolithic ``admin/views.py`` so each domain
(Sector / Capability / Risk / Actor / Signal / …) lives in its own
file mirroring the model boundary. ``mount.py`` consumes the
:data:`ALL_VIEWS` list below; new views must be added there to show
up in the admin sidebar.
"""

from __future__ import annotations

from sqladmin import ModelView

from data_pipeline.admin.views.actor import ActorView
from data_pipeline.admin.views.audit_log import AuditLogView
from data_pipeline.admin.views.capability import (
    CapabilityScoreView,
    CapabilityView,
)
from data_pipeline.admin.views.community_proposal import CommunityProposalView
from data_pipeline.admin.views.crawl_run import CrawlRunView
from data_pipeline.admin.views.risk import RiskView
from data_pipeline.admin.views.sector import SectorView
from data_pipeline.admin.views.signal import SignalView
from data_pipeline.admin.views.user import UserView
from data_pipeline.admin.views.job_config import JobConfigView

# Order here is the order they appear in the SQLAdmin sidebar — keep
# domain-grouped (Vision-tied first, then Operations) so the cockpit
# stays scannable as more models surface.
ALL_VIEWS: list[type[ModelView]] = [
    SectorView,
    CapabilityView,
    CapabilityScoreView,
    SignalView,
    RiskView,
    ActorView,
    CrawlRunView,
    CommunityProposalView,
    JobConfigView,
    UserView,
    AuditLogView,
]
