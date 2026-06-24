"""
Analyzer Agent — processes and reasons over retrieved data.

Takes data from prior steps (via depends_on context) and uses the LLM
to perform analysis: summarization, classification, extraction, comparison.

This agent always calls the LLM — it is the "thinking" agent in the pipeline.
"""

from __future__ import annotations

import time

from agents.base import BaseAgent
from llm.client import LLMClient, LLMClientError
from models.schemas import AgentResult, Step, StepStatus


class AnalyzerAgent(BaseAgent):
    """
    Analyzes data using LLM reasoning.

    Stateless: receives step instruction + context from prior steps,
    calls the LLM, returns structured analysis.
    """

    name = "analyzer"

    SYSTEM_PROMPT = (
        "You are an expert analyst. Your job is to analyze the provided data "
        "and produce a clear, structured analysis. Focus on:\n"
        "- Key findings and main themes\n"
        "- Important details and supporting evidence\n"
        "- Patterns, comparisons, or contradictions in the data\n"
        "- A concise summary of your analysis\n\n"
        "Be thorough but concise. Use bullet points or numbered lists where appropriate."
    )

    async def run(self, step: Step, context: dict[str, AgentResult]) -> AgentResult:
        """
        Execute an analysis step.

        1. Gather outputs from dependency steps
        2. Build a prompt combining the instruction + dependency data
        3. Call the LLM for analysis
        4. Return the structured analysis
        """
        start_time = time.time()

        # Gather context from prior steps
        dep_outputs = self._get_dependency_outputs(step, context)

        # Build the user message
        user_message = self._build_user_message(step.instruction, dep_outputs)

        # Call the LLM
        try:
            client = LLMClient()
            response = await client.call(
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.3,  # Lower temperature for analytical precision
            )

            return self._make_result(
                step, StepStatus.SUCCESS, output=response, start_time=start_time
            )

        except LLMClientError as e:
            return self._make_result(
                step,
                StepStatus.FAILED,
                error=f"Analyzer LLM call failed: {e}",
                start_time=start_time,
            )

    def _build_user_message(self, instruction: str, dep_outputs: str) -> str:
        """Construct the user message for the LLM call."""
        parts = [f"**Task:** {instruction}"]

        if dep_outputs:
            parts.append(f"\n**Available Data:**\n{dep_outputs}")
        else:
            parts.append(
                "\n**Note:** No prior data is available. "
                "Analyze based on your knowledge and the task instruction."
            )

        return "\n".join(parts)
