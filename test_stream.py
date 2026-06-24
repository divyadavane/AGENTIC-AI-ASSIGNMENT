import asyncio
import httpx
import urllib.parse

async def test_stream():
    task = "What are the most recent quarterly earnings results for Nvidia (NVDA)? Give me an executive summary using bold text and bullet points outlining their revenue, net income, and data center growth. Make sure to cite the financial news websites you used."
    url = "http://localhost:8000/api/run"
    payload = {"task": task, "mock": False, "attachments": []}
    
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, json=payload) as response:
            async for line in response.aiter_lines():
                print(repr(line))
                
asyncio.run(test_stream())
