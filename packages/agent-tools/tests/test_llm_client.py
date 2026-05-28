"""Offline tests — never touches the network. The single provider
(Gemini via `google-genai`) is faked so we can assert the wrapper
builds the right request shape and threads tier → model id correctly.

History:
- pre-M34: faked the Anthropic SDK.
- M34 (2026-05-22): swapped to Gemini.
- M35 (2026-05-22): added Anthropic back for the opus tier (dual fakes).
- F9 (2026-05-28): dropped Anthropic. All three tiers now route through
  Gemini and the test file is back to a single fake surface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from pydantic import BaseModel

from agent_tools import LLMClient, available_models


# ---- Gemini fake -----------------------------------------------------------


@dataclass
class _FakeUsage:
    """Mirrors `genai.types.GenerateContentResponseUsageMetadata`."""

    prompt_token_count: int = 0
    candidates_token_count: int = 0
    thoughts_token_count: int = 0
    cached_content_token_count: int = 0


@dataclass
class _FakePart:
    text: str = ""


@dataclass
class _FakeContent:
    parts: list[_FakePart] = field(default_factory=list)


@dataclass
class _FakeCandidate:
    content: _FakeContent | None = None
    finish_reason: str | None = "STOP"


@dataclass
class _FakeResponse:
    text: str = ""
    parsed: Any = None
    candidates: list[_FakeCandidate] = field(default_factory=list)
    usage_metadata: _FakeUsage = field(default_factory=_FakeUsage)


class _FakeModels:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.next_response: _FakeResponse | None = None
        # Optional queue of exceptions to raise on successive calls;
        # popped left-to-right. Lets a test simulate "first call throws
        # constraint-too-tall, second call succeeds" — the wrapper's
        # retry path.
        self.exception_queue: list[Exception] = []

    def generate_content(self, **kwargs: Any) -> _FakeResponse:
        self.requests.append(kwargs)
        if self.exception_queue:
            raise self.exception_queue.pop(0)
        if self.next_response is not None:
            return self.next_response
        return _FakeResponse(
            text="ok",
            candidates=[
                _FakeCandidate(
                    content=_FakeContent(parts=[_FakePart(text="ok")]),
                    finish_reason="STOP",
                )
            ],
            usage_metadata=_FakeUsage(
                prompt_token_count=10,
                candidates_token_count=20,
                thoughts_token_count=0,
                cached_content_token_count=0,
            ),
        )


class _FakeGenAI:
    def __init__(self) -> None:
        self.models = _FakeModels()


# ---- tier-mapping ----------------------------------------------------------


def test_available_models_returns_expected_tier_mapping() -> None:
    models = available_models()
    assert models["haiku"] == "gemini-3.5-flash-lite"
    assert models["sonnet"] == "gemini-3.5-flash"
    assert models["opus"] == "gemini-3.1-pro-preview"


def test_env_override_takes_precedence_over_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """`LLM_OPUS_MODEL` env var should redirect the opus tier without
    requiring a code change — useful for trying a newer Pro model
    without rebuilding the container."""
    monkeypatch.setenv("LLM_OPUS_MODEL", "gemini-3.2-pro-experimental")
    assert available_models()["opus"] == "gemini-3.2-pro-experimental"


# ---- per-tier dispatch + request shape -------------------------------------


def test_call_routes_sonnet_to_correct_gemini_model_id() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3.5-flash"


def test_call_routes_haiku_to_correct_gemini_model_id() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3.5-flash-lite"


def test_call_routes_opus_to_gemini_pro_preview() -> None:
    """F9 swap: opus tier now routes to gemini-3.1-pro-preview through
    the same Gemini SDK, not Claude via AnthropicVertex."""
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="opus", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["model"] == "gemini-3.1-pro-preview"
    # Opus + sonnet + haiku all go through the same Gemini surface now.
    # The request payload looks identical regardless of tier.
    assert sent["config"]["system_instruction"] == "sys"
    assert sent["contents"][-1]["parts"][0]["text"] == "hi"


def test_call_passes_system_instruction_in_config() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(
        tier="haiku",
        system=["chunk one — generic instructions", "chunk two — task-specific addenda"],
        user="hi",
    )
    sent = fake.models.requests[-1]
    sys_instr = sent["config"]["system_instruction"]
    assert "chunk one" in sys_instr
    assert "chunk two" in sys_instr


def test_call_translates_user_turn_into_contents() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="current question")
    sent = fake.models.requests[-1]
    contents = sent["contents"]
    assert contents[-1]["role"] == "user"
    assert contents[-1]["parts"][0]["text"] == "current question"


# ---- thinking_budget --------------------------------------------------------


def test_thinking_budget_zero_for_haiku_by_default() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": 0}


def test_thinking_budget_dynamic_when_adaptive_thinking_on() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi", adaptive_thinking=True)
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": -1}


def test_thinking_budget_medium_for_sonnet_without_adaptive() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    sent = fake.models.requests[-1]
    # sonnet default effort = "medium" → budget 1024
    assert sent["config"]["thinking_config"] == {"thinking_budget": 1024}


def test_thinking_budget_high_for_opus_by_default() -> None:
    """Opus tier (gemini-3.1-pro-preview) defaults to effort='high' →
    4096-token thinking budget — gives the pro model room to plan
    before emitting the JSON decomposition."""
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="opus", system="sys", user="hi")
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": 4096}


def test_thinking_budget_low_effort_override() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi", effort="low")
    sent = fake.models.requests[-1]
    assert sent["config"]["thinking_config"] == {"thinking_budget": 512}


# ---- usage + pricing --------------------------------------------------------


def test_call_records_usage_and_cost_via_meter() -> None:
    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text="response body",
        usage_metadata=_FakeUsage(
            prompt_token_count=1000,
            candidates_token_count=500,
            thoughts_token_count=0,
            cached_content_token_count=0,
        ),
    )
    client = LLMClient(genai_client=fake)
    result = client.call(tier="haiku", system="sys", user="hi")
    assert result.text == "response body"
    assert result.raw_usage["input_tokens"] == 1000
    assert result.raw_usage["output_tokens"] == 500
    # flash-lite (haiku tier): 1000 * $0.25/1M + 500 * $1.50/1M
    #                       = 0.00025 + 0.00075 = 0.001
    assert abs(client.cost_meter.total_usd - 0.001) < 1e-6


def test_cache_read_tokens_billed_at_discounted_rate() -> None:
    """When the response reports cached_content_token_count, we should
    bill those tokens through the cache-read multiplier rather than the
    full input price."""
    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text="ok",
        usage_metadata=_FakeUsage(
            prompt_token_count=2000,  # of which 1000 cached
            candidates_token_count=0,
            cached_content_token_count=1000,
        ),
    )
    client = LLMClient(genai_client=fake)
    client.call(tier="sonnet", system="sys", user="hi")
    # sonnet (gemini-3.5-flash): input 1000 * $0.50/1M = $0.0005
    # plus cache-read 1000 * $0.50/1M * 0.25 = $0.000125
    # output 0
    expected = (1000 * 0.50 + 1000 * 0.50 * 0.25) / 1_000_000.0
    assert abs(client.cost_meter.total_usd - expected) < 1e-6


def test_opus_call_records_cost_at_gemini_pro_pricing() -> None:
    """Opus tier now bills at gemini-3.1-pro-preview rates ($1.25 in /
    $10 out per 1M tokens) instead of claude-opus-4-7 ($15/$75)."""
    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text="ok",
        usage_metadata=_FakeUsage(
            prompt_token_count=1000, candidates_token_count=500,
        ),
    )
    client = LLMClient(genai_client=fake)
    client.call(tier="opus", system="sys", user="hi")
    # 1000 * $1.25/1M + 500 * $10/1M = 0.00125 + 0.005 = 0.00625
    assert abs(client.cost_meter.total_usd - 0.00625) < 1e-6


# ---- structured output -----------------------------------------------------


def test_call_with_pydantic_response_model_sets_response_schema() -> None:
    class Item(BaseModel):
        name: str

    fake = _FakeGenAI()
    fake.models.next_response = _FakeResponse(
        text='{"name": "alpha"}',
        parsed=Item(name="alpha"),
        usage_metadata=_FakeUsage(
            prompt_token_count=20, candidates_token_count=10
        ),
    )
    client = LLMClient(genai_client=fake)
    result = client.call(tier="sonnet", system="sys", user="hi", response_model=Item)
    sent = fake.models.requests[-1]
    assert sent["config"]["response_schema"] is Item
    assert sent["config"]["response_mime_type"] == "application/json"
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "alpha"


def test_extra_messages_are_prepended_and_assistant_becomes_model() -> None:
    """Gemini uses role="model" instead of "assistant". The wrapper has
    to translate when callers pass Anthropic-era extra_messages
    (kept for backward-compat with code that still hand-builds chat
    history)."""
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    client.call(
        tier="sonnet",
        system="sys",
        user="current question",
        extra_messages=[
            {"role": "user", "content": "earlier turn"},
            {"role": "assistant", "content": "earlier response"},
        ],
    )
    contents = fake.models.requests[-1]["contents"]
    assert len(contents) == 3
    assert contents[0]["role"] == "user"
    assert contents[0]["parts"][0]["text"] == "earlier turn"
    assert contents[1]["role"] == "model"  # ← translated
    assert contents[1]["parts"][0]["text"] == "earlier response"
    assert contents[-1]["parts"][0]["text"] == "current question"


def test_tools_passed_through_when_supplied() -> None:
    fake = _FakeGenAI()
    client = LLMClient(genai_client=fake)
    tools = [{"function_declarations": [{"name": "lookup_sector"}]}]
    client.call(tier="sonnet", system="sys", user="hi", tools=tools)
    assert fake.models.requests[-1]["config"]["tools"] == tools


# ---- constraint-too-tall retry path ----------------------------------------


def test_gemini_retries_without_response_schema_on_constraint_too_tall() -> None:
    """Vertex/Gemini compiles `response_schema` into an FST constraint
    with a hard size cap (~5888 states). Nested schemas (e.g., the
    Vision Builder's DataSourceSelector or ThesisDrafter) routinely
    blow past that limit and the call fails with `400 INVALID_ARGUMENT
    … Constraint is too tall: NNNNN (vs max of 5888)`. The wrapper
    must retry without `response_schema` and validate via Pydantic
    post-parse so the caller still gets a typed result back."""

    class Item(BaseModel):
        name: str
        category: str

    fake = _FakeGenAI()
    fake.models.exception_queue = [
        RuntimeError(
            "400 INVALID_ARGUMENT. Constraint is too tall: 13376 "
            "(vs max of 5888); see go/constraint-is-too-big; Failed "
            "while executing Op 'Prefill'"
        )
    ]
    fake.models.next_response = _FakeResponse(
        text='{"name": "alpha", "category": "x"}',
        candidates=[
            _FakeCandidate(
                content=_FakeContent(
                    parts=[_FakePart(text='{"name": "alpha", "category": "x"}')]
                ),
                finish_reason="STOP",
            )
        ],
        usage_metadata=_FakeUsage(
            prompt_token_count=100,
            candidates_token_count=50,
        ),
    )
    client = LLMClient(genai_client=fake)
    result = client.call(
        tier="sonnet",
        system="sys",
        user="hi",
        response_model=Item,
    )
    # Two calls total — first was the failed strict call, second was
    # the retry without response_schema.
    assert len(fake.models.requests) == 2
    first, second = fake.models.requests
    assert "response_schema" in first["config"]
    assert "response_schema" not in second["config"]
    # Mime type stays so the model still emits JSON.
    assert second["config"]["response_mime_type"] == "application/json"
    # Wrapper post-parsed the text into a typed Pydantic instance.
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "alpha"
    assert result.parsed.category == "x"


def test_gemini_retry_injects_json_schema_into_prompt() -> None:
    """Without server-side schema enforcement the model only follows
    the shape it can see in the prompt. The retry path must append the
    Pydantic JSON Schema + a direct "return ONLY JSON" instruction so
    the model knows exactly what to produce — otherwise the post-parse
    Pydantic validation fails with a missing/mistyped-field error and
    the caller sees `parsed=None`."""

    class Item(BaseModel):
        name: str
        category: str

    fake = _FakeGenAI()
    fake.models.exception_queue = [RuntimeError("Constraint is too tall: 9999 vs 5888")]
    fake.models.next_response = _FakeResponse(
        text='{"name": "alpha", "category": "x"}',
        candidates=[
            _FakeCandidate(
                content=_FakeContent(
                    parts=[_FakePart(text='{"name": "alpha", "category": "x"}')]
                ),
                finish_reason="STOP",
            )
        ],
    )
    client = LLMClient(genai_client=fake)
    result = client.call(
        tier="sonnet", system="sys", user="orig", response_model=Item,
    )
    assert isinstance(result.parsed, Item)
    # The retry call (second request) must contain BOTH the original
    # user turn AND the schema-reminder turn.
    retry_contents = fake.models.requests[1]["contents"]
    assert len(retry_contents) == 2, "retry should append one schema turn"
    schema_turn_text = retry_contents[-1]["parts"][0]["text"]
    assert "Return ONLY" in schema_turn_text
    assert "Item" in schema_turn_text  # schema name
    assert '"category"' in schema_turn_text  # field name from JSON schema
    assert '"name"' in schema_turn_text


def test_gemini_retry_tolerates_markdown_fence_around_json() -> None:
    """Gemini sometimes wraps its JSON output in a ```json fence when
    not under strict schema enforcement (because the system prompt
    typically says "return JSON" — the model falls back to its
    markdown habit). The post-retry parser must strip the fence."""

    class Item(BaseModel):
        name: str

    fake = _FakeGenAI()
    fake.models.exception_queue = [RuntimeError("Constraint is too tall: 9999 vs 5888")]
    fake.models.next_response = _FakeResponse(
        text='```json\n{"name": "fenced"}\n```',
        candidates=[
            _FakeCandidate(
                content=_FakeContent(
                    parts=[_FakePart(text='```json\n{"name": "fenced"}\n```')]
                ),
                finish_reason="STOP",
            )
        ],
    )
    client = LLMClient(genai_client=fake)
    result = client.call(
        tier="sonnet", system="sys", user="hi", response_model=Item,
    )
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "fenced"


def test_gemini_retry_tolerates_prose_preamble_around_json() -> None:
    """When relying on prompt-only structured output, Gemini will
    sometimes prepend a one-liner ("Here's the requested JSON:")
    before the JSON object. The post-parse helper isolates the first
    {…} block so this doesn't fail Pydantic."""

    class Item(BaseModel):
        name: str

    fake = _FakeGenAI()
    fake.models.exception_queue = [RuntimeError("Constraint is too tall: 9999 vs 5888")]
    fake.models.next_response = _FakeResponse(
        text='Here is the JSON object you requested:\n{"name": "loose"}',
        candidates=[
            _FakeCandidate(
                content=_FakeContent(
                    parts=[
                        _FakePart(
                            text='Here is the JSON object you requested:\n{"name": "loose"}'
                        )
                    ]
                ),
                finish_reason="STOP",
            )
        ],
    )
    client = LLMClient(genai_client=fake)
    result = client.call(
        tier="sonnet", system="sys", user="hi", response_model=Item,
    )
    assert isinstance(result.parsed, Item)
    assert result.parsed.name == "loose"


def test_gemini_propagates_non_constraint_errors_unchanged() -> None:
    """Constraint-too-tall is the only retry trigger — every other
    Gemini error (auth, quota, timeout) should bubble up so the
    caller sees the real failure mode."""

    class Item(BaseModel):
        name: str

    fake = _FakeGenAI()
    fake.models.exception_queue = [RuntimeError("403 PERMISSION_DENIED")]
    client = LLMClient(genai_client=fake)
    with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
        client.call(
            tier="sonnet", system="sys", user="hi", response_model=Item,
        )
    assert len(fake.models.requests) == 1  # no retry


# ---- backwards-compat constructor + default client -------------------------


def test_legacy_client_kwarg_maps_to_genai_client() -> None:
    """Pre-M35 fixtures pass `client=` (Gemini-only era). The wrapper
    still accepts that as an alias for `genai_client=`."""
    fake = _FakeGenAI()
    client = LLMClient(client=fake)
    client.call(tier="haiku", system="sys", user="hi")
    assert len(fake.models.requests) == 1


def test_default_client_picks_vertex_when_env_flag_set(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """Vertex AI mode reads creds from the SA JSON + region from
    GOOGLE_CLOUD_LOCATION + project from the SA JSON's project_id."""
    sa_path = tmp_path / "sa.json"
    sa_path.write_text('{"project_id": "proj-fake-123"}')
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(sa_path))
    monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "global")
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs

    from agent_tools import llm_client as mod

    class _FakeGenAIModule:
        Client = _FakeGenAIClient

    monkeypatch.setattr(mod, "genai", _FakeGenAIModule)
    # _load_sa_credentials returns None when google-auth isn't
    # importable; monkeypatch the function to skip the SA build step.
    monkeypatch.setattr(mod, "_load_sa_credentials", lambda _path: None)

    client = mod._build_default_client(api_key=None)
    assert isinstance(client, _FakeGenAIClient)
    assert client.kwargs["vertexai"] is True
    assert client.kwargs["project"] == "proj-fake-123"
    assert client.kwargs["location"] == "global"


def test_default_client_reads_project_id_from_sa_json_when_env_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """When GOOGLE_CLOUD_PROJECT isn't set, the project comes from the
    SA JSON's project_id field. Mirrors the canonical Vertex-on-GCP
    pattern."""
    sa_path = tmp_path / "sa.json"
    sa_path.write_text('{"project_id": "proj-from-sa-789"}')
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(sa_path))
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_LOCATION", raising=False)

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs

    from agent_tools import llm_client as mod

    class _FakeGenAIModule:
        Client = _FakeGenAIClient

    monkeypatch.setattr(mod, "genai", _FakeGenAIModule)
    monkeypatch.setattr(mod, "_load_sa_credentials", lambda _path: None)

    client = mod._build_default_client(api_key=None)
    assert isinstance(client, _FakeGenAIClient)
    assert client.kwargs["project"] == "proj-from-sa-789"
    # location defaults to "global" when env unset.
    assert client.kwargs["location"] == "global"


def test_default_client_falls_back_to_api_key_when_vertex_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the Vertex flag isn't set, fall back to AI Studio via API key."""
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "fake-api-key")

    class _FakeGenAIClient:
        def __init__(self, **kwargs: Any) -> None:
            self.kwargs = kwargs

    from agent_tools import llm_client as mod

    class _FakeGenAIModule:
        Client = _FakeGenAIClient

    monkeypatch.setattr(mod, "genai", _FakeGenAIModule)

    client = mod._build_default_client(api_key=None)
    assert isinstance(client, _FakeGenAIClient)
    assert client.kwargs["api_key"] == "fake-api-key"
    # No Vertex kwargs in the AI Studio path.
    assert "vertexai" not in client.kwargs


def test_default_client_errors_with_no_auth_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    from agent_tools import llm_client as mod

    with pytest.raises(RuntimeError, match="No LLM auth configured"):
        mod._build_default_client(api_key=None)


def test_default_client_vertex_without_project_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """Vertex mode + no project (env unset + SA JSON without
    project_id) is a misconfiguration — surface it loudly at boot
    rather than at the first call site."""
    sa_path = tmp_path / "sa.json"
    sa_path.write_text("{}")  # no project_id
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(sa_path))
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)

    from agent_tools import llm_client as mod

    with pytest.raises(RuntimeError, match="Vertex AI mode requires"):
        mod._build_default_client(api_key=None)
