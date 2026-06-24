"""
Pydantic models for the Agentic AI System.

These schemas define the contract between all components:
  - Orchestrator ↔ Agents
  - LLM responses → validated Python objects
  - Pipeline results → structured logging

All agents are stateless — these models carry the full context between steps.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class StepStatus(str, Enum):
    """Lifecycle status of a pipeline step."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class Step(BaseModel):
    """
    A single decomposed step in the task pipeline.

    Produced by the Orchestrator's decomposition LLM call.
    Each step is routed to one of the three specialized agents.
    """
    id: str = Field(description="Unique step identifier, e.g. 'step_1'")
    agent: Literal["retriever", "analyzer", "writer"] = Field(
        description="Which agent handles this step"
    )
    instruction: str = Field(
        description="Natural-language instruction for the agent"
    )
    depends_on: list[str] = Field(
        default_factory=list,
        description="List of step IDs that must complete before this step runs"
    )


class TaskDecomposition(BaseModel):
    """
    Validated output from the Orchestrator's decomposition call.

    The LLM returns a JSON array of steps, which is parsed into this model.
    If parsing fails, the Orchestrator retries once before raising an error.
    """
    steps: list[Step] = Field(
        description="Ordered list of decomposed steps"
    )


class AgentResult(BaseModel):
    """
    Result produced by an agent after executing a step.

    This is the universal return type for all agents.
    The Orchestrator collects these into a context dict for downstream steps.
    """
    step_id: str = Field(description="ID of the step that produced this result")
    agent: str = Field(description="Name of the agent that ran this step")
    status: StepStatus = Field(description="Outcome of the step execution")
    output: str = Field(
        default="",
        description="The agent's output text (data, analysis, or written content)"
    )
    error: str | None = Field(
        default=None,
        description="Error message if the step failed"
    )
    duration_ms: float = Field(
        default=0.0,
        description="Wall-clock time for this step in milliseconds"
    )


class ErrorLog(BaseModel):
    """
    Structured log entry written to the JSON-lines log file.

    One entry per step execution (success or failure).
    Enables post-hoc debugging and observability.
    """
    timestamp: str = Field(description="ISO 8601 timestamp")
    step_id: str = Field(description="Step that generated this log entry")
    agent: str = Field(description="Agent that handled the step")
    status: str = Field(description="Outcome: success, failed, skipped")
    error: str | None = Field(default=None, description="Error details if any")
    duration_ms: float = Field(default=0.0, description="Execution time in ms")
    retry_attempt: int = Field(default=0, description="Which attempt this was (0 = first try)")
