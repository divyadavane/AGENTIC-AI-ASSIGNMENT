"""
Tests for the full pipeline execution.

Integration-level tests with all agents mocked:
  - Correct execution order (waves)
  - Dependency resolution
  - Result streaming
  - Context passing between steps
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from models.schemas import AgentResult, Step, StepStatus
from orchestrator.core import Orchestrator
from orchestrator.batching import compute_waves, BatchingError


# ─── Batching Tests ───────────────────────────────────────────────────

def test_compute_waves_linear():
    """Test linear dependency chain produces sequential waves."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch", depends_on=[]),
        Step(id="s2", agent="analyzer", instruction="analyze", depends_on=["s1"]),
        Step(id="s3", agent="writer", instruction="write", depends_on=["s2"]),
    ]
    waves = compute_waves(steps)

    assert len(waves) == 3
    assert [s.id for s in waves[0]] == ["s1"]
    assert [s.id for s in waves[1]] == ["s2"]
    assert [s.id for s in waves[2]] == ["s3"]


def test_compute_waves_parallel():
    """Test independent steps are grouped into the same wave."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch A", depends_on=[]),
        Step(id="s2", agent="retriever", instruction="fetch B", depends_on=[]),
        Step(id="s3", agent="analyzer", instruction="analyze", depends_on=["s1", "s2"]),
    ]
    waves = compute_waves(steps)

    assert len(waves) == 2
    wave0_ids = {s.id for s in waves[0]}
    assert wave0_ids == {"s1", "s2"}  # Parallel
    assert [s.id for s in waves[1]] == ["s3"]


def test_compute_waves_diamond():
    """Test diamond dependency pattern (A → B, A → C, B+C → D)."""
    steps = [
        Step(id="a", agent="retriever", instruction="fetch", depends_on=[]),
        Step(id="b", agent="analyzer", instruction="analyze B", depends_on=["a"]),
        Step(id="c", agent="analyzer", instruction="analyze C", depends_on=["a"]),
        Step(id="d", agent="writer", instruction="write", depends_on=["b", "c"]),
    ]
    waves = compute_waves(steps)

    assert len(waves) == 3
    assert [s.id for s in waves[0]] == ["a"]
    assert {s.id for s in waves[1]} == {"b", "c"}  # Parallel
    assert [s.id for s in waves[2]] == ["d"]


def test_compute_waves_circular_raises():
    """Test that circular dependencies raise BatchingError."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch", depends_on=["s2"]),
        Step(id="s2", agent="analyzer", instruction="analyze", depends_on=["s1"]),
    ]
    with pytest.raises(BatchingError) as exc_info:
        compute_waves(steps)

    assert "circular" in str(exc_info.value).lower()


def test_compute_waves_missing_dependency_raises():
    """Test that referencing a non-existent dependency raises BatchingError."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch", depends_on=["missing"]),
    ]
    with pytest.raises(BatchingError):
        compute_waves(steps)


# ─── Pipeline Execution Tests ────────────────────────────────────────

@pytest.mark.asyncio
async def test_pipeline_executes_in_order():
    """Test that pipeline executes steps in correct wave order."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch", depends_on=[]),
        Step(id="s2", agent="analyzer", instruction="analyze", depends_on=["s1"]),
        Step(id="s3", agent="writer", instruction="write", depends_on=["s2"]),
    ]

    execution_order: list[str] = []

    async def mock_agent_run(self, step, context):
        execution_order.append(step.id)
        return AgentResult(
            step_id=step.id,
            agent=step.agent,
            status=StepStatus.SUCCESS,
            output=f"Output from {step.id}",
        )

    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []

    with patch("agents.retriever.RetrieverAgent.run", mock_agent_run):
        with patch("agents.analyzer.AnalyzerAgent.run", mock_agent_run):
            with patch("agents.writer.WriterAgent.run", mock_agent_run):
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

    # Check order
    assert execution_order == ["s1", "s2", "s3"]
    assert len(results) == 3
    assert all(r.status == StepStatus.SUCCESS for r in results)


@pytest.mark.asyncio
async def test_pipeline_parallel_execution():
    """Test that independent steps in the same wave run together."""
    steps = [
        Step(id="s1", agent="retriever", instruction="fetch A", depends_on=[]),
        Step(id="s2", agent="retriever", instruction="fetch B", depends_on=[]),
        Step(id="s3", agent="analyzer", instruction="analyze", depends_on=["s1", "s2"]),
    ]

    async def mock_agent_run(self, step, context):
        return AgentResult(
            step_id=step.id,
            agent=step.agent,
            status=StepStatus.SUCCESS,
            output=f"Output from {step.id}",
        )

    orch = Orchestrator.__new__(Orchestrator)
    orch.context = {}
    orch.log_entries = []

    with patch("agents.retriever.RetrieverAgent.run", mock_agent_run):
        with patch("agents.analyzer.AnalyzerAgent.run", mock_agent_run):
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

    assert len(results) == 3
    # s1 and s2 should both complete before s3
    result_ids = [r.step_id for r in results]
    assert result_ids.index("s3") > result_ids.index("s1")
    assert result_ids.index("s3") > result_ids.index("s2")
