"""
Tests for individual agents.

Tests each agent with mocked dependencies:
  - RetrieverAgent with mocked search results
  - AnalyzerAgent with mocked LLM response
  - WriterAgent with mocked LLM response
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from agents.retriever import RetrieverAgent
from agents.analyzer import AnalyzerAgent
from agents.writer import WriterAgent
from models.schemas import AgentResult, Step, StepStatus


# ─── Test Fixtures ────────────────────────────────────────────────────

def make_step(
    step_id: str = "step_1",
    agent: str = "retriever",
    instruction: str = "Test instruction",
    depends_on: list[str] | None = None,
) -> Step:
    """Helper to create a Step for testing."""
    return Step(
        id=step_id,
        agent=agent,
        instruction=instruction,
        depends_on=depends_on or [],
    )


def make_context(outputs: dict[str, str] | None = None) -> dict[str, AgentResult]:
    """Helper to create a context dict with mock results."""
    context = {}
    if outputs:
        for step_id, output in outputs.items():
            context[step_id] = AgentResult(
                step_id=step_id,
                agent="mock",
                status=StepStatus.SUCCESS,
                output=output,
            )
    return context


# ─── RetrieverAgent Tests ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_retriever_success_with_ddg():
    """Test retriever returns results when DuckDuckGo works."""
    agent = RetrieverAgent()
    step = make_step(instruction="Search for Python programming")

    # Mock DuckDuckGo to return results
    mock_results = "1. [Python](https://python.org)\n   Python is a programming language"

    with patch.object(agent, "_search_duckduckgo", return_value=mock_results):
        with patch.object(agent, "_search_wikipedia", return_value=None):
            result = await agent.run(step, {})

    assert result.status == StepStatus.SUCCESS
    assert "Python" in result.output
    assert result.step_id == "step_1"


@pytest.mark.asyncio
async def test_retriever_fallback_to_wikipedia():
    """Test retriever falls back to Wikipedia when DDG fails."""
    agent = RetrieverAgent()
    step = make_step(instruction="What is machine learning")

    wiki_result = "**Machine Learning**\n\nMachine learning is a subset of AI..."

    with patch.object(agent, "_search_duckduckgo", return_value=None):
        with patch.object(agent, "_search_wikipedia", return_value=wiki_result):
            result = await agent.run(step, {})

    assert result.status == StepStatus.SUCCESS
    assert "Machine Learning" in result.output


@pytest.mark.asyncio
async def test_retriever_both_sources_fail():
    """Test retriever returns FAILED when both sources fail."""
    agent = RetrieverAgent()
    step = make_step(instruction="Search for something")

    with patch.object(agent, "_search_duckduckgo", return_value=None):
        with patch.object(agent, "_search_wikipedia", return_value=None):
            result = await agent.run(step, {})

    assert result.status == StepStatus.FAILED
    assert result.error is not None


# ─── AnalyzerAgent Tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_analyzer_success():
    """Test analyzer produces analysis from LLM call."""
    agent = AnalyzerAgent()
    step = make_step(
        step_id="step_2",
        agent="analyzer",
        instruction="Analyze the data",
        depends_on=["step_1"],
    )
    context = make_context({"step_1": "Raw data about electric vehicles..."})

    with patch("agents.analyzer.LLMClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.call = AsyncMock(
            return_value="Analysis: EVs are growing rapidly in market share..."
        )

        result = await agent.run(step, context)

    assert result.status == StepStatus.SUCCESS
    assert "EVs" in result.output or "Analysis" in result.output


@pytest.mark.asyncio
async def test_analyzer_llm_failure():
    """Test analyzer returns FAILED when LLM call fails."""
    from llm.client import LLMClientError

    agent = AnalyzerAgent()
    step = make_step(step_id="step_2", agent="analyzer")

    with patch("agents.analyzer.LLMClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.call = AsyncMock(side_effect=LLMClientError("API Error"))

        result = await agent.run(step, {})

    assert result.status == StepStatus.FAILED
    assert "failed" in result.error.lower()


# ─── WriterAgent Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_writer_success():
    """Test writer produces output from streaming LLM call."""
    agent = WriterAgent()
    step = make_step(
        step_id="step_3",
        agent="writer",
        instruction="Write a summary",
        depends_on=["step_2"],
    )
    context = make_context({"step_2": "Analysis of electric vehicles..."})

    async def mock_stream(*args, **kwargs):
        for token in ["Electric ", "vehicles ", "are ", "the ", "future."]:
            yield token

    with patch("agents.writer.LLMClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.call_stream = mock_stream

        result = await agent.run(step, context)

    assert result.status == StepStatus.SUCCESS
    assert "Electric vehicles are the future." == result.output


@pytest.mark.asyncio
async def test_writer_empty_output():
    """Test writer returns FAILED when LLM produces empty output."""
    agent = WriterAgent()
    step = make_step(step_id="step_3", agent="writer")

    async def mock_stream(*args, **kwargs):
        for token in []:
            yield token

    with patch("agents.writer.LLMClient") as MockClient:
        mock_instance = MockClient.return_value
        mock_instance.call_stream = mock_stream

        result = await agent.run(step, {})

    assert result.status == StepStatus.FAILED
    assert "empty" in result.error.lower()
