"""
Writer Agent — produces the final formatted output.

Takes analysis from prior steps and calls the LLM (with streaming)
to produce polished, well-structured content: reports, summaries,
articles, structured responses.

This is the final agent in most pipelines — its output is what the user sees.
"""

from __future__ import annotations

import time

from agents.base import BaseAgent
from llm.client import LLMClient, LLMClientError
from models.schemas import AgentResult, Step, StepStatus


class WriterAgent(BaseAgent):
    """
    Produces final written output using LLM.

    Stateless: receives step instruction + context from prior steps,
    calls the LLM with streaming, returns polished written content.
    """

    name = "writer"

    SYSTEM_PROMPT = (
        "You are an expert writer. Your job is to produce polished, "
        "well-structured content based on the provided analysis and data. "
        "Guidelines:\n"
        "- Write in clear, engaging prose\n"
        "- Use proper structure: introduction, body, conclusion\n"
        "- Include specific details and evidence from the source material\n"
        "- Maintain a professional but accessible tone\n"
        "- Format with markdown where appropriate (headers, lists, bold)\n"
        "- Be comprehensive but avoid unnecessary filler"
    )

    async def run(self, step: Step, context: dict[str, AgentResult]) -> AgentResult:
        """
        Execute a writing step.

        1. Gather outputs from dependency steps (typically analysis)
        2. Build a prompt with the writing instruction + source material
        3. Call the LLM with streaming to produce the final output
        4. Collect all streamed tokens into the final result
        """
        start_time = time.time()

        # Gather context from prior steps
        dep_outputs = self._get_dependency_outputs(step, context)

        # Build the user message
        user_message = self._build_user_message(step.instruction, dep_outputs)

        # Call the LLM with streaming — collect tokens
        try:
            client = LLMClient()
            output_parts: list[str] = []

            async for token in client.call_stream(
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=0.7,  # Higher temperature for creative writing
            ):
                output_parts.append(token)

            full_output = "".join(output_parts)

            if not full_output.strip():
                return self._make_result(
                    step,
                    StepStatus.FAILED,
                    error="Writer produced empty output",
                    start_time=start_time,
                )

            return self._make_result(
                step, StepStatus.SUCCESS, output=full_output, start_time=start_time
            )

        except LLMClientError as e:
            return self._make_result(
                step,
                StepStatus.FAILED,
                error=f"Writer LLM call failed: {e}",
                start_time=start_time,
            )

    def _build_user_message(self, instruction: str, dep_outputs: str) -> str:
        """Construct the user message for the LLM call."""
        parts = [f"**Writing Task:** {instruction}"]

        if dep_outputs:
            parts.append(f"\n**Source Material:**\n{dep_outputs}")
        else:
            parts.append(
                "\n**Note:** No prior analysis or data is available. "
                "Write based on your knowledge and the task instruction."
            )

        return "\n".join(parts)
