from __future__ import annotations

from sqladmin import ModelView

from data_pipeline.admin.models import JobConfig


class JobConfigView(ModelView, model=JobConfig):
    """SQLAdmin ModelView for managing JobConfig settings dynamically.

    Allows the operator to adjust dynamic parameters (e.g., lookback window,
    limit overrides, thresholds) directly through the Admin cockpit without
    touching the .env file or restarting the Docker containers.
    """

    column_list = ["key", "value", "kind", "group", "description", "updated_at"]
    column_searchable_list = ["key", "group"]
    column_filters = ["group", "kind"]
    column_sortable_list = ["key", "group", "updated_at"]

    # Restrict forms to only editable/safe columns. Editing 'key' or 'kind'
    # is highly discouraged as they bind to specific runtime conventions.
    form_columns = ["value", "description"]

    name = "Job Config"
    plural_name = "Job Configs"
    icon = "fa-solid fa-sliders"
    category = "Jobs"
