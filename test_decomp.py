import asyncio
from llm.client import LLMClient

async def test():
    client = LLMClient()
    prompt = """You are a task decomposition engine. Given a complex user task, break it down into discrete, ordered steps that can be executed by specialized agents.

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

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": "What are the most recent quarterly earnings results for Nvidia (NVDA)? Give me an executive summary using bold text and bullet points outlining their revenue, net income, and data center growth. Make sure to cite the financial news websites you used."}
    ]
    
    resp = await client.call(messages=messages, temperature=0.2, max_tokens=2048)
    print("---RAW RESP---")
    print(resp)
    print("---END---")

asyncio.run(test())
