import asyncio
from llm.client import LLMClient

async def main():
    client = LLMClient()
    instruction = "Fetch the latest quarterly earnings report for Nvidia (NVDA) from Yahoo Finance."
    optimized_query = await client.call(
        messages=[
            {"role": "system", "content": "You are a search query optimizer. Given a complex instruction, extract the best short search query (3-6 words) to use in a search engine like DuckDuckGo or Wikipedia. Return ONLY the exact search query keywords, with no quotes, punctuation, or extra text."},
            {"role": "user", "content": instruction}
        ],
        temperature=0.1,
        max_tokens=30
    )
    print("Original:", instruction)
    print("Optimized:", optimized_query.strip(' "\''))

asyncio.run(main())
