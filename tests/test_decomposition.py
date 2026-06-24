"""
Tests for task decomposition logic.

Tests the Orchestrator's decompose() method:
  - Valid decomposition with proper JSON steps
  - Malformed JSON handling (retry then error)
  - Empty response handling
  - JSON cleaning (markdown code blocks)
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from models.schemas import Step
from orchestrator.core import Orchestrator, DecompositionError


# ─── Sample Data ──────────────────────────────────────────────────────

VALID_DECOMPOSITION_JSON = json.dumps({
    "steps": [
        {
            "id": "step_1",
            "agent": "retriever",
            "instruction": "Search for recent information about electric vehicles",
            "depends_on": [],
        },
        {
            "id": "step_2",
            "agent": "analyzer",
            "instruction": "Analyze the key trends and developments in EV technology",
            "depends_on": ["step_1"],
        },
        {
            "id": "step_3",
            "agent": "writer",
            "instruction": "Write a 3-paragraph summary about electric vehicles",
            "depends_on": ["step_2"],
        },
    ]
})

MALFORMED_JSON = "This is not valid JSON at all {{{}"

WRAPPED_JSON = f"```json\n{VALID_DECOMPOSITION_JSON}\n```"

EMPTY_STEPS_JSON = json.dumps({"steps": []})


# ─── Tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_decompose_valid_json():
    """Test that valid JSON decomposition returns correct Step objects."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()
    orch.llm_client.call = AsyncMock(return_value=VALID_DECOMPOSITION_JSON)

    steps = await orch.decompose("Research electric vehicles and write a summary")

    assert len(steps) == 3
    assert all(isinstance(s, Step) for s in steps)
    assert steps[0].id == "step_1"
    assert steps[0].agent == "retriever"
    assert steps[1].depends_on == ["step_1"]
    assert steps[2].agent == "writer"


@pytest.mark.asyncio
async def test_decompose_markdown_wrapped_json():
    """Test that JSON wrapped in markdown code blocks is cleaned properly."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()
    orch.llm_client.call = AsyncMock(return_value=WRAPPED_JSON)

    steps = await orch.decompose("Some task")

    assert len(steps) == 3
    assert steps[0].agent == "retriever"


@pytest.mark.asyncio
async def test_decompose_malformed_json_raises():
    """Test that malformed JSON causes DecompositionError after retry."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()
    orch.llm_client.call = AsyncMock(return_value=MALFORMED_JSON)

    with pytest.raises(DecompositionError) as exc_info:
        await orch.decompose("Some task")

    assert "failed after" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_decompose_empty_steps_raises():
    """Test that empty step list causes DecompositionError."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()
    orch.llm_client.call = AsyncMock(return_value=EMPTY_STEPS_JSON)

    with pytest.raises(DecompositionError):
        await orch.decompose("Some task")


@pytest.mark.asyncio
async def test_decompose_retries_on_first_failure():
    """Test that decomposition retries once on LLM failure, then succeeds."""
    from llm.client import LLMClientError

    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()

    # First call fails, second succeeds
    orch.llm_client.call = AsyncMock(
        side_effect=[
            LLMClientError("Timeout"),
            VALID_DECOMPOSITION_JSON,
        ]
    )

    steps = await orch.decompose("Some task")

    assert len(steps) == 3
    assert orch.llm_client.call.call_count == 2


@pytest.mark.asyncio
async def test_clean_json_response():
    """Test the JSON cleaning helper directly."""
    orch = Orchestrator.__new__(Orchestrator)

    # Plain JSON
    assert orch._clean_json_response('  {"a": 1}  ') == '{"a": 1}'

    # Markdown wrapped
    assert orch._clean_json_response('```json\n{"a": 1}\n```') == '{"a": 1}'

    # With extra whitespace
    assert orch._clean_json_response('\n\n```\n{"a": 1}\n```\n') == '{"a": 1}'
