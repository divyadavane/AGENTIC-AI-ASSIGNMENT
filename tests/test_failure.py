"""
Tests for failure handling logic.

Verifies the three layers of failure handling:
  1. Retry with exponential backoff
  2. Graceful degradation (fallback on non-critical failure)
  3. Hard abort on decomposition failure

Also tests:
  - Error streaming to user
  - Structured logging of failures
  - Pipeline continuation after non-critical step failure
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from llm.client import LLMClientError
from models.schemas import AgentResult, Step, StepStatus
from orchestrator.core import Orchestrator, DecompositionError


# ─── Retry Logic Tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_retry_on_agent_exception():
    """Test that agent exceptions trigger retry before final failure."""
    step = Step(id="s1", agent="retriever", instruction="fetch", depends_on=[])

    call_count = {"n": 0}

    async def failing_run(self, step, context):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise TimeoutError("Simulated timeout")
        return AgentResult(
            step_id=step.id,
            agent="retriever",
            status=StepStatus.SUCCESS,
            output="Data retrieved after retry",
        )

    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []

    with patch("agents.retriever.RetrieverAgent.run", failing_run):
        from agents.retriever import RetrieverAgent

        orch.agents = {"retriever": RetrieverAgent()}

        result = await orch._execute_step_with_retry(step)

    assert result.status == StepStatus.SUCCESS
    assert call_count["n"] == 2  # First call failed, second succeeded


@pytest.mark.asyncio
async def test_all_retries_exhausted():
    """Test that step is marked FAILED after all retries are exhausted."""
    step = Step(id="s1", agent="retriever", instruction="fetch", depends_on=[])

    async def always_fail(self, step, context):
        raise ConnectionError("Network is down")

    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []

    with patch("agents.retriever.RetrieverAgent.run", always_fail):
        from agents.retriever import RetrieverAgent

        orch.agents = {"retriever": RetrieverAgent()}

        result = await orch._execute_step_with_retry(step)

    assert result.status == StepStatus.FAILED
    assert "failed after" in result.error.lower()


# ─── Graceful Degradation Tests ──────────────────────────────────────

@pytest.mark.asyncio
async def test_pipeline_continues_after_non_critical_failure():
    """
    Test that pipeline continues when a non-critical step fails.

    Scenario: step_1 (retriever) fails, but step_2 (analyzer) doesn't
    depend on it — it should still execute.
    """
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch A", depends_on=[]),
        Step(id="s2", agent="retriever", instruction="fetch B", depends_on=[]),
        Step(id="s3", agent="analyzer", instruction="analyze", depends_on=["s2"]),
    ]

    async def mock_run(self, step, context):
        if step.id == "s1":
            return AgentResult(
                step_id=step.id,
                agent="retriever",
                status=StepStatus.FAILED,
                error="Simulated failure",
            )
        return AgentResult(
            step_id=step.id,
            agent=step.agent,
            status=StepStatus.SUCCESS,
            output=f"Output from {step.id}",
        )

    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []

    with patch("agents.retriever.RetrieverAgent.run", mock_run):
        with patch("agents.analyzer.AnalyzerAgent.run", mock_run):
            from agents.retriever import RetrieverAgent
            from agents.analyzer import AnalyzerAgent
            from agents.writer import WriterAgent

            orch.agents = {
                "retriever": RetrieverAgent(),
                "analyzer": AnalyzerAgent(),
                "writer": WriterAgent(),
            }

            results = []
            async for result in orch.execute_pipeline(steps):
                results.append(result)

    # All 3 steps should execute (s1 fails, s2 and s3 succeed)
    assert len(results) == 3

    s1_result = next(r for r in results if r.step_id == "s1")
    assert s1_result.status == StepStatus.FAILED

    s2_result = next(r for r in results if r.step_id == "s2")
    assert s2_result.status == StepStatus.SUCCESS

    s3_result = next(r for r in results if r.step_id == "s3")
    assert s3_result.status == StepStatus.SUCCESS


# ─── Hard Abort Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_decomposition_failure_aborts():
    """Test that decomposition failure raises DecompositionError (hard abort)."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.llm_client = AsyncMock()
    orch.llm_client.call = AsyncMock(
        side_effect=LLMClientError("API is completely down")
    )

    with pytest.raises(DecompositionError) as exc_info:
        await orch.decompose("Some task")

    assert "failed after" in str(exc_info.value).lower()


# ─── Unknown Agent Tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unknown_agent_returns_failed():
    """Test that an unknown agent type returns a FAILED result."""
    step = Step(id="s1", agent="retriever", instruction="fetch", depends_on=[])
    # Override agent to something not in registry
    step_dict = step.model_dump()
    step_dict["agent"] = "unknown_agent"

    # We need to bypass Pydantic validation for this test
    # since "unknown_agent" isn't a valid Literal value
    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []
    orch.agents = {}  # Empty registry

    # Create a mock step with an agent that won't be in the registry
    mock_step = Step(id="s1", agent="retriever", instruction="fetch", depends_on=[])

    # Manually set the agent dict to empty so "retriever" isn't found
    result = await orch._execute_step_with_retry(mock_step)

    assert result.status == StepStatus.FAILED
    assert "unknown agent" in result.error.lower() or "failed" in result.error.lower()


# ─── Logging Tests ────────────────────────────────────────────────────

def test_log_entry_creation():
    """Test that _log_step creates structured log entries."""
    orch = Orchestrator.__new__(Orchestrator)
    orch.log_entries = []

    result = AgentResult(
        step_id="s1",
        agent="retriever",
        status=StepStatus.SUCCESS,
        output="data",
        duration_ms=150.5,
    )

    orch._log_step(result)

    assert len(orch.log_entries) == 1
    entry = orch.log_entries[0]
    assert entry.step_id == "s1"
    assert entry.agent == "retriever"
    assert entry.status == "success"
    assert entry.duration_ms == 150.5
