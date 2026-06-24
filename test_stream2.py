import asyncio
from llm.client import LLMClient

async def main():
    client = LLMClient()
    print("Testing stream:")
    messages = [{"role": "user", "content": "Say hello world"}]
    async for token in client.call_stream(messages):
        print(token, end="", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
