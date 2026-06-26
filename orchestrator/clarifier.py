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
4. Write code, scripts, and software programs

If the user's prompt is highly vague, ambiguous, or lacks crucial context (e.g., "Research Apple" - fruit or company?), you must ask a clarifying question.
If the user's prompt is specific enough to run a web search and analysis (e.g., "Research Apple's recent earnings"), you must execute.

CRITICAL: When you decide to execute, the "task" field MUST be a COMPLETE, SELF-CONTAINED description that synthesizes the ENTIRE conversation history into one clear task. Do NOT just use the user's last message — combine the original request with any clarifications they provided.

For example, if the conversation is:
  User: "Write a guide on setting up a Next.js app"
  Assistant: "Would you like it for e-commerce, blog, or general web development?"
  User: "web development"
Then the task MUST be: "Write a comprehensive guide on setting up a Next.js app for general web development"
NOT just "web development" or something unrelated.

Return a JSON object with this exact structure:
{
    "action": "question" | "execute",
    "question": "Your clarifying question here (if action is question)",
    "task": "The COMPLETE, FULLY DETAILED task to execute, synthesizing the entire conversation (if action is execute)"
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
                json_mode=True,
            )

            import re
            text = response.strip()

            json_blocks = re.findall(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
            if json_blocks:
                cleaned = json_blocks[-1].strip()
            else:
                start_idx = text.find('{')
                end_idx = text.rfind('}')
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    cleaned = text[start_idx:end_idx+1].strip()
                else:
                    cleaned = text

            parsed = json.loads(cleaned)
            return ClarifierResult.model_validate(parsed)
            
        except Exception as e:
            # Fallback to execution if LLM fails formatting
            # Synthesize ALL user messages to preserve full context
            user_messages = []
            for msg in chat_history:
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Extract text from multimodal payload
                    content = next((item["text"] for item in content if item.get("type") == "text"), "")
                if msg.get("role") == "user" and content:
                    user_messages.append(content)
            task = " — ".join(user_messages) if user_messages else ""
            return ClarifierResult(action="execute", task=task)
