"""
Coder Agent — produces executable code.

Takes analysis and requirements from prior steps and calls the LLM (with streaming)
to produce clean, functional, and well-documented code.
"""

from __future__ import annotations

import time
from typing import Any

from agents.base import BaseAgent
from llm.client import LLMClient, LLMClientError
from models.schemas import AgentResult, Step, StepStatus


class CoderAgent(BaseAgent):
    """
    Produces code using the LLM.

    Stateless: receives step instruction + context from prior steps,
    calls the LLM with streaming, returns code blocks and explanations.
    """

    name = "coder"

    SYSTEM_PROMPT = (
        "You are an expert, senior software engineer. Your job is to write clean, "
        "efficient, and well-documented code based on the provided task and data. "
        "Guidelines:\n"
        "- Write functional, production-ready code in the specific programming language requested by the prompt\n"
        "- Always enclose code in proper markdown code blocks with the language specified (e.g., ```python)\n"
        "- Add brief, clear comments explaining complex logic\n"
        "- Follow best practices for the chosen language/framework\n"
        "- Prioritize security, performance, and readability\n"
        "- If the task involves a UI, assume modern frameworks like React or Next.js unless specified otherwise\n"
        "- ALWAYS provide a clear, step-by-step explanation of how the code works alongside the code blocks."
    )

    async def run(self, step: Step, context: dict[str, Any]) -> AgentResult:
        """
        Execute a coding step.
        """
        start_time = time.time()

        # Gather context from prior steps
        dep_outputs = self._get_dependency_outputs(step, context)

        # Build the user message
        user_text = self._build_user_message(step.instruction, dep_outputs)

        # Check for attachments in the global pipeline context
        attachments = context.get("__attachments__", [])
        
        if attachments:
            user_content = [{"type": "text", "text": user_text}]
            for att in attachments:
                if isinstance(att, dict) and att.get("type") == "image":
                    user_content.append({
                        "type": "image_url",
                        "image_url": {"url": att.get("content")}
                    })
        else:
            user_content = user_text

        messages = [
            {"role": "system", "content": self.SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        event_queue = context.get("__event_queue__")

        try:
            client = LLMClient()
            output_parts: list[str] = []

            async for token in client.call_stream(
                messages=messages,
                temperature=0.2,  # Low temperature for code generation to reduce hallucination
            ):
                output_parts.append(token)
                if event_queue is not None:
                    try:
                        event_queue.put_nowait({"type": "token", "data": token})
                    except Exception:
                        pass

            full_output = "".join(output_parts)

            if full_output.strip():
                return self._make_result(
                    step, StepStatus.SUCCESS, output=full_output, start_time=start_time
                )

        except LLMClientError:
            pass  # Fall through

        try:
            client = LLMClient()
            full_output = await client.call(
                messages=messages,
                temperature=0.2,
            )

            if not full_output.strip():
                return self._make_result(
                    step,
                    StepStatus.FAILED,
                    error="Coder produced empty output",
                    start_time=start_time,
                )

            if event_queue is not None:
                try:
                    event_queue.put_nowait({"type": "token", "data": full_output})
                except Exception:
                    pass

            return self._make_result(
                step, StepStatus.SUCCESS, output=full_output, start_time=start_time
            )

        except LLMClientError as e:
            return self._make_result(
                step,
                StepStatus.FAILED,
                error=f"Coder LLM call failed: {e}",
                start_time=start_time,
            )

    def _build_user_message(self, instruction: str, dep_outputs: str) -> str:
        """Construct the user message for the LLM call."""
        parts = [f"**Coding Task:** {instruction}"]

        if dep_outputs:
            parts.append(f"\n**Context/Requirements:**\n{dep_outputs}")

        return "\n".join(parts)
