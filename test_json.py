import asyncio, json
from orchestrator.core import Orchestrator

async def main():
    orch = Orchestrator()
    task = "Research Event Sourcing"
    messages = [{"role": "system", "content": orch.DECOMPOSITION_PROMPT}, {"role": "user", "content": task}]
    response = await orch.llm_client.call(messages=messages, temperature=0.2, max_tokens=2048, json_mode=True)
    print("RAW REPONSE:")
    print(repr(response))
    cleaned = orch._clean_json_response(response)
    print("CLEANED:")
    print(repr(cleaned))
    parsed = json.loads(cleaned)
    print("PARSED:")
    print(parsed)

asyncio.run(main())
