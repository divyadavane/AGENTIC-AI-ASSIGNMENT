import asyncio
import httpx
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GROQ_API_KEY")

async def get_models():
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"}
        )
        data = response.json()
        for model in data.get("data", []):
            print(f"- {model['id']}")
            
asyncio.run(get_models())
