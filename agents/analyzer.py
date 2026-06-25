"""
Analyzer Agent — processes and reasons over retrieved data.

Takes data from prior steps (via depends_on context) and uses the LLM
to perform analysis: summarization, classification, extraction, comparison.

This agent always calls the LLM — it is the "thinking" agent in the pipeline.
"""

from __future__ import annotations

import time
from typing import Any

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
        "CRITICAL RULES FOR ACCURACY:\n"
        "1. DO NOT hallucinate or invent information. If the data is not present in the 'Available Data', state that it is unknown.\n"
        "2. Ground your analysis strictly in the provided data.\n"
        "3. Be thorough but concise. Use bullet points or numbered lists where appropriate.\n"
        "4. If the task requires writing code, algorithms, or scripts, write them in the specific programming language requested by the prompt, using proper markdown."
    )

    async def run(self, step: Step, context: dict[str, Any]) -> AgentResult:
        """
        Execute an analysis step.

        1. Gather outputs from dependency steps
        2. Build a prompt combining the instruction + dependency data
        3. Inject any attached images into the multimodal payload
        4. Call the LLM for analysis
        """
        start_time = time.time()

        # Gather context from prior steps
        dep_outputs = self._get_dependency_outputs(step, context)

        # Build the text part of the user message
        user_text = self._build_user_message(step.instruction, dep_outputs)

        # Check for attachments in the global pipeline context
        attachments = context.get("__attachments__", [])
        
        if attachments:
            # Format as a list of dicts for multimodal vision model
            user_content = [{"type": "text", "text": user_text}]
            for att in attachments:
                if isinstance(att, dict) and att.get("type") == "image":
                    user_content.append({
                        "type": "image_url",
                        "image_url": {"url": att.get("content")}
                    })
        else:
            # Fall back to standard string if no attachments
            user_content = user_text

        # Call the LLM
        try:
            client = LLMClient()
            response = await client.call(
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
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
