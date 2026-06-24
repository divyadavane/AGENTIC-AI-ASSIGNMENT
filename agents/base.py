"""
Abstract base class for all agents in the Agentic AI System.

Each agent is stateless — it receives its full input context on every call.
State lives only in the Orchestrator's pipeline context dict.

This design makes agents:
  - Easy to test (mock the context dict)
  - Safe to parallelize (no shared mutable state)
  - Simple to extend (subclass and implement `run`)
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod

from models.schemas import AgentResult, Step, StepStatus


class BaseAgent(ABC):
    """
    Abstract base for specialized agents.

    Every agent must implement the `run` method, which:
      1. Receives a Step (what to do) and a context dict (results from prior steps)
      2. Performs its work (fetch data, call LLM, etc.)
      3. Returns an AgentResult with status, output, and timing info
    """

    # Human-readable name for logging and display
    name: str = "base"

    @abstractmethod
    async def run(self, step: Step, context: dict[str, AgentResult]) -> AgentResult:
        """
        Execute a single step.

        Args:
            step: The decomposed step to execute.
            context: Dict mapping step_id → AgentResult for all completed prior steps.
                     Use this to access outputs from steps listed in step.depends_on.

        Returns:
            AgentResult with the step's outcome.
        """
        ...

    def _get_dependency_outputs(self, step: Step, context: dict[str, AgentResult]) -> str:
        """
        Gather output text from all steps this step depends on.

        Returns a concatenated string of all dependency outputs,
        separated by section headers for clarity.
        """
        parts: list[str] = []
        for dep_id in step.depends_on:
            result = context.get(dep_id)
            if result and result.status == StepStatus.SUCCESS and result.output:
                parts.append(f"--- Output from {dep_id} ---\n{result.output}")
            elif result and result.status == StepStatus.FAILED:
                parts.append(f"--- {dep_id} FAILED (no data available) ---")
        return "\n\n".join(parts) if parts else ""

    def _make_result(
        self,
        step: Step,
        status: StepStatus,
        output: str = "",
        error: str | None = None,
        start_time: float = 0.0,
    ) -> AgentResult:
        """Helper to construct an AgentResult with timing."""
        duration = (time.time() - start_time) * 1000 if start_time else 0.0
        return AgentResult(
            step_id=step.id,
            agent=self.name,
            status=status,
            output=output,
            error=error,
            duration_ms=round(duration, 2),
        )
