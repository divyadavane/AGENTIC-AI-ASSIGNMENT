"""
Pytest configuration and shared fixtures for the Agentic AI System tests.

This conftest.py provides:
  - Auto asyncio mode configuration
  - Shared fixtures for creating test steps and mock contexts
  - Temporary directory fixture for log testing
"""

from __future__ import annotations

import os
import sys

import pytest

# Ensure the project root is on the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.schemas import AgentResult, Step, StepStatus


@pytest.fixture
def sample_steps() -> list[Step]:
    """A standard 3-step pipeline: retriever → analyzer → writer."""
    return [
        Step(
            id="step_1",
            agent="retriever",
            instruction="Search for information about artificial intelligence",
            depends_on=[],
        ),
        Step(
            id="step_2",
            agent="analyzer",
            instruction="Analyze the key findings about AI trends",
            depends_on=["step_1"],
        ),
        Step(
            id="step_3",
            agent="writer",
            instruction="Write a concise summary of AI developments",
            depends_on=["step_2"],
        ),
    ]


@pytest.fixture
def parallel_steps() -> list[Step]:
    """Steps with independent retriever tasks that can run in parallel."""
    return [
        Step(id="s1", agent="retriever", instruction="Search topic A", depends_on=[]),
        Step(id="s2", agent="retriever", instruction="Search topic B", depends_on=[]),
        Step(id="s3", agent="retriever", instruction="Search topic C", depends_on=[]),
        Step(
            id="s4",
            agent="analyzer",
            instruction="Analyze all topics",
            depends_on=["s1", "s2", "s3"],
        ),
        Step(
            id="s5",
            agent="writer",
            instruction="Write combined report",
            depends_on=["s4"],
        ),
    ]


@pytest.fixture
def mock_context() -> dict[str, AgentResult]:
    """A pre-filled context dict with a successful retriever result."""
    return {
        "step_1": AgentResult(
            step_id="step_1",
            agent="retriever",
            status=StepStatus.SUCCESS,
            output="Retrieved data: AI is transforming industries worldwide...",
            duration_ms=1500.0,
        ),
    }
