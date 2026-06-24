"""
Orchestrator — the brain of the Agentic AI System.

Responsibilities:
  1. Accept a complex user task as input
  2. Call the LLM to decompose it into discrete, ordered steps (our own logic)
  3. Validate the decomposition with Pydantic
  4. Group steps into dependency waves for parallel execution
  5. Dispatch each step to the correct specialized agent
  6. Stream partial outputs to the user as each step completes
  7. Handle failures: retry with backoff → fallback → skip → abort

This is the central coordination point. Agents are stateless workers;
all state lives here in the pipeline context dict.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from typing import AsyncGenerator

from agents.analyzer import AnalyzerAgent
from agents.base import BaseAgent
from agents.retriever import RetrieverAgent
from agents.writer import WriterAgent
from llm.client import LLMClient, LLMClientError
from models.schemas import (
    AgentResult,
    ErrorLog,
    Step,
    StepStatus,
    TaskDecomposition,
)
from orchestrator.batching import compute_waves, format_wave_plan, BatchingError
import config


class DecompositionError(Exception):
    """Raised when task decomposition fails irrecoverably."""
    pass


class Orchestrator:
    """
    Central orchestrator for the agentic pipeline.

    Usage:
        orch = Orchestrator()
        async for result in orch.run("Research electric vehicles and write a summary"):
            print(result)  # Streamed AgentResult for each completed step
    """

    # System prompt for the decomposition LLM call
    DECOMPOSITION_PROMPT = """You are a task decomposition engine. Given a complex user task, break it down into discrete, ordered steps that can be executed by specialized agents.

Available agents:
- "retriever": Fetches external information (web search, data retrieval). Use for gathering facts, searching for information, finding data.
- "analyzer": Processes and reasons over data (summarization, classification, extraction, comparison). Use for thinking about and structuring information.
- "writer": Produces final formatted output (reports, articles, summaries, structured responses). Use for creating the deliverable.

Rules:
1. Each step must have: id (string like "step_1"), agent (one of the three above), instruction (clear natural language), depends_on (list of step IDs that must complete first)
2. Start with retriever steps to gather data, then analyzer steps to process it, then writer steps to produce output
3. Steps with no dependencies can run in parallel
4. Keep the total number of steps between 3 and 8
5. Make instructions specific and actionable

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{"steps": [{"id": "step_1", "agent": "retriever", "instruction": "...", "depends_on": []}, ...]}"""

    def __init__(self):
        """Initialize the orchestrator with agent registry and LLM client."""
        self.llm_client = LLMClient()

        # Agent registry — maps agent names to instances
        self.agents: dict[str, BaseAgent] = {
            "retriever": RetrieverAgent(),
            "analyzer": AnalyzerAgent(),
            "writer": WriterAgent(),
        }

        # Pipeline state: step_id → AgentResult
        self.context: dict[str, AgentResult] = {}

        # Structured log entries
        self.log_entries: list[ErrorLog] = []

    # ─── Task Decomposition ──────────────────────────────────────────

    async def decompose(self, task: str) -> list[Step]:
        """
        Decompose a complex task into discrete steps via LLM call.

        Strategy:
          1. Call LLM with decomposition system prompt
          2. Parse JSON response
          3. Validate with Pydantic TaskDecomposition model
          4. On failure: retry ONCE, then raise DecompositionError (hard abort)

        Args:
            task: The user's complex task description.

        Returns:
            Validated list of Step objects.

        Raises:
            DecompositionError: If decomposition fails after retry.
        """
        messages = [
            {"role": "system", "content": self.DECOMPOSITION_PROMPT},
            {"role": "user", "content": task},
        ]

        last_error: str = ""

        for attempt in range(config.MAX_RETRIES + 1):
            try:
                response = await self.llm_client.call(
                    messages=messages,
                    temperature=0.2,  # Low temperature for structured output
                    max_tokens=2048,
                )

                # Clean the response — some LLMs wrap JSON in markdown code blocks
                cleaned = self._clean_json_response(response)

                # Parse and validate
                parsed = json.loads(cleaned)
                decomposition = TaskDecomposition.model_validate(parsed)

                if not decomposition.steps:
                    raise ValueError("Decomposition returned zero steps")

                return decomposition.steps

            except (json.JSONDecodeError, ValueError) as e:
                last_error = f"JSON parse/validation error (attempt {attempt + 1}): {e}"
                if attempt < config.MAX_RETRIES:
                    await asyncio.sleep(config.RETRY_DELAY)
                    continue

            except LLMClientError as e:
                last_error = f"LLM call failed (attempt {attempt + 1}): {e}"
                if attempt < config.MAX_RETRIES:
                    await asyncio.sleep(config.RETRY_DELAY)
                    continue

        # All attempts exhausted — hard abort
        raise DecompositionError(
            f"Task decomposition failed after {config.MAX_RETRIES + 1} attempts. "
            f"Last error: {last_error}"
        )

    def _clean_json_response(self, response: str) -> str:
        """
        Strip markdown code fences and whitespace from LLM JSON responses.

        Some models wrap JSON in ```json ... ``` blocks. This handles that.
        """
        text = response.strip()

        # Remove markdown code block wrapper
        if text.startswith("```"):
            # Find the end of the opening fence line
            first_newline = text.index("\n") if "\n" in text else len(text)
            text = text[first_newline + 1:]

            # Remove closing fence
            if text.endswith("```"):
                text = text[:-3]

        return text.strip()

    # ─── Pipeline Execution ──────────────────────────────────────────

    async def execute_pipeline(
        self, steps: list[Step]
    ) -> AsyncGenerator[AgentResult, None]:
        """
        Execute decomposed steps as an async pipeline with streaming.

        1. Group steps into dependency waves (manual batching)
        2. For each wave: run steps in parallel via asyncio.gather()
        3. For each step: dispatch to agent, handle failures, yield result
        4. Stream AgentResult objects to the caller as they complete

        This is an async generator — use `async for result in ...` to consume.

        Args:
            steps: Validated list of Step objects from decomposition.

        Yields:
            AgentResult for each completed (or failed) step.
        """
        # Compute dependency waves for parallel execution
        try:
            waves = compute_waves(steps)
        except BatchingError as e:
            # Batching failure — yield error and abort
            yield AgentResult(
                step_id="batching",
                agent="orchestrator",
                status=StepStatus.FAILED,
                error=f"Batching failed: {e}",
            )
            return

        # Execute wave by wave
        for wave_idx, wave in enumerate(waves):
            # Run all steps in this wave concurrently
            tasks = [
                self._execute_step_with_retry(step)
                for step in wave
            ]
            results = await asyncio.gather(*tasks)

            # Process results: update context, yield to caller
            for result in results:
                self.context[result.step_id] = result

                # Log this step's outcome
                self._log_step(result)

                # Yield the result to the caller (streaming)
                yield result

    async def _execute_step_with_retry(self, step: Step) -> AgentResult:
        """
        Execute a single step with retry logic.

        Retry policy:
          - On failure: retry once after RETRY_DELAY seconds
          - If retry also fails: return FAILED result with error info
          - On success: return SUCCESS result immediately

        This implements exponential backoff for the retry delay.
        """
        agent = self.agents.get(step.agent)
        if not agent:
            return AgentResult(
                step_id=step.id,
                agent=step.agent,
                status=StepStatus.FAILED,
                error=f"Unknown agent type: {step.agent}",
            )

        last_error: str = ""

        for attempt in range(config.MAX_RETRIES + 1):
            try:
                result = await agent.run(step, self.context)

                # If the agent itself reports failure, treat as retriable
                if result.status == StepStatus.FAILED and attempt < config.MAX_RETRIES:
                    last_error = result.error or "Agent reported failure"
                    delay = config.RETRY_DELAY * (config.RETRY_BACKOFF_FACTOR ** attempt)
                    await asyncio.sleep(delay)
                    continue

                return result

            except Exception as e:
                last_error = f"Unhandled exception in {step.agent}: {type(e).__name__}: {e}"
                if attempt < config.MAX_RETRIES:
                    delay = config.RETRY_DELAY * (config.RETRY_BACKOFF_FACTOR ** attempt)
                    await asyncio.sleep(delay)
                    continue

        # All retries exhausted
        return AgentResult(
            step_id=step.id,
            agent=step.agent,
            status=StepStatus.FAILED,
            error=f"Failed after {config.MAX_RETRIES + 1} attempts. Last error: {last_error}",
        )

    # ─── Top-Level Run ────────────────────────────────────────────────

    async def run(self, task: str) -> AsyncGenerator[AgentResult, None]:
        """
        Full pipeline: decompose → batch → execute → stream.

        This is the main entry point for the orchestrator.

        Args:
            task: The user's complex task description.

        Yields:
            AgentResult for each step as it completes.

        Raises:
            DecompositionError: If task decomposition fails (hard abort).
        """
        # Reset state for new run
        self.context = {}
        self.log_entries = []

        # Step 1: Decompose the task
        steps = await self.decompose(task)

        # Step 2: Execute the pipeline, streaming results
        async for result in self.execute_pipeline(steps):
            yield result

        # Step 3: Write logs to file
        self._flush_logs()

    # ─── Logging ──────────────────────────────────────────────────────

    def _log_step(self, result: AgentResult, retry_attempt: int = 0) -> None:
        """Record a structured log entry for a step execution."""
        entry = ErrorLog(
            timestamp=datetime.now(timezone.utc).isoformat(),
            step_id=result.step_id,
            agent=result.agent,
            status=result.status.value,
            error=result.error,
            duration_ms=result.duration_ms,
            retry_attempt=retry_attempt,
        )
        self.log_entries.append(entry)

    def _flush_logs(self) -> None:
        """Write all log entries to a JSON-lines file."""
        os.makedirs(config.LOG_DIR, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = os.path.join(config.LOG_DIR, f"run_{timestamp}.jsonl")

        with open(log_file, "w", encoding="utf-8") as f:
            for entry in self.log_entries:
                f.write(entry.model_dump_json() + "\n")

    def get_decomposition_steps(self) -> list[Step] | None:
        """Return the last decomposition steps (for display purposes)."""
        # This is populated after decompose() runs; stored for UI display
        return getattr(self, "_last_steps", None)
