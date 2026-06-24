import json
from pydantic import BaseModel
from llm.client import LLMClient
import config

class ClarifierResult(BaseModel):
    action: str  # "question" or "execute"
    question: str | None = None
    task: str | None = None

class Clarifier:
    """
    Evaluates a user's task or ongoing chat history.
    Decides whether to ask a clarifying question or execute the pipeline.
    """

    SYSTEM_PROMPT = """You are the Orchestrator for an Agentic AI System. Your job is to determine if you have enough information to run a complex research/analysis/writing pipeline for the user.

Your available agents can:
1. Search the web and Wikipedia
2. Analyze and process text
3. Write final comprehensive reports

If the user's prompt is highly vague, ambiguous, or lacks crucial context (e.g., "Research Apple" - fruit or company?), you must ask a clarifying question.
If the user's prompt is specific enough to run a web search and analysis (e.g., "Research Apple's recent earnings"), you must execute.

Return a JSON object with this exact structure:
{
    "action": "question" | "execute",
    "question": "Your clarifying question here (if action is question)",
    "task": "The fully detailed task to execute (if action is execute)"
}"""

    def __init__(self):
        self.llm_client = LLMClient()

    async def evaluate(self, chat_history: list[dict[str, str]]) -> ClarifierResult:
        messages = [{"role": "system", "content": self.SYSTEM_PROMPT}]
        # Combine user's chat history into the LLM context
        for msg in chat_history:
            role = "user" if msg["role"] == "user" else "assistant"
            messages.append({"role": role, "content": msg["content"]})

        try:
            response = await self.llm_client.call(
                messages=messages,
                temperature=0.2,
                max_tokens=500,
            )

            # Clean JSON block if wrapped
            cleaned = response.strip()
            if cleaned.startswith("```"):
                first_newline = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
                cleaned = cleaned[first_newline + 1:]
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]

            parsed = json.loads(cleaned.strip())
            return ClarifierResult.model_validate(parsed)
            
        except Exception as e:
            # Fallback to execution if LLM fails formatting
            task = chat_history[-1]["content"] if chat_history else ""
            return ClarifierResult(action="execute", task=task)
