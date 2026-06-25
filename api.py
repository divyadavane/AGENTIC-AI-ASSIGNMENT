import asyncio
import json
import os
from typing import AsyncGenerator

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from orchestrator.core import Orchestrator, DecompositionError
from orchestrator.clarifier import Clarifier
import config
from main import _enable_mock_llm
from pydantic import BaseModel

app = FastAPI(title="Zyro")

# Allow CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Attachment(BaseModel):
    type: str  # "image" or "text"
    name: str
    content: str  # base64 string or raw text

class RunRequest(BaseModel):
    task: str
    mock: bool = False
    attachments: list[Attachment] = []

class ChatMessage(BaseModel):
    role: str
    content: str

class ClarifyRequest(BaseModel):
    chat_history: list[ChatMessage]
    attachments: list[Attachment] = []


async def pipeline_generator(task: str, mock: bool, attachments: list[Attachment]) -> AsyncGenerator[dict, None]:
    """Generates SSE events for the pipeline execution."""
    
    if mock:
        _enable_mock_llm()
        
    try:
        config.validate_config()
    except ValueError as e:
        yield {
            "event": "error",
            "data": json.dumps({"error": str(e)})
        }
        return

    orch = Orchestrator()
    
    # Store attachments in the pipeline context for agents to read
    orch.context["__attachments__"] = [a.model_dump() for a in attachments]

    # 1. Decomposition Phase
    yield {
        "event": "status",
        "data": json.dumps({"status": "decomposing", "message": "Analyzing and decomposing task..."})
    }
    
    try:
        steps = await orch.decompose(task)
    except Exception as e:
        yield {
            "event": "error",
            "data": json.dumps({"error": f"Decomposition failed: {e}"})
        }
        return

    # Yield the decomposition result
    yield {
        "event": "decomposition",
        "data": json.dumps([s.model_dump() for s in steps])
    }
    
    # 2. Execution Phase
    yield {
        "event": "status",
        "data": json.dumps({"status": "executing", "message": "Executing agent pipeline..."})
    }
    
    event_queue = asyncio.Queue()
    orch.context["__event_queue__"] = event_queue
    
    async def run_pipeline_task():
        try:
            async for result in orch.execute_pipeline(steps):
                await event_queue.put({"type": "result", "data": result})
        except Exception as e:
            await event_queue.put({"type": "error", "data": e})
        finally:
            await event_queue.put({"type": "done", "data": None})
            
    asyncio.create_task(run_pipeline_task())
    
    final_output = ""
    while True:
        event = await event_queue.get()
        if event["type"] == "token":
            yield {
                "event": "token",
                "data": json.dumps({"token": event["data"]})
            }
        elif event["type"] == "result":
            result = event["data"]
            if result.agent in ["writer", "coder"] and result.output:
                if final_output:
                    final_output += "\n\n" + result.output
                else:
                    final_output = result.output
            yield {
                "event": "step_result",
                "data": result.model_dump_json()
            }
        elif event["type"] == "error":
            yield {
                "event": "error",
                "data": json.dumps({"error": f"Pipeline error: {event['data']}"})
            }
            break
        elif event["type"] == "done":
            break

    # Save to history
    try:
        orch.save_history(task, final_output)
    except Exception as e:
        print(f"Failed to save history: {e}")

    # 3. Finished
    yield {
        "event": "status",
        "data": json.dumps({"status": "finished", "message": "Task completed successfully."})
    }


@app.get("/api/history")
async def get_history():
    """Retrieve the pipeline execution history."""
    history_file = os.path.join(config.LOG_DIR, "history.json")
    if not os.path.exists(history_file):
        return []
    try:
        with open(history_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading history: {e}")


@app.delete("/api/history/{item_id}")
async def delete_history(item_id: str):
    """Delete a specific item from the history."""
    history_file = os.path.join(config.LOG_DIR, "history.json")
    if not os.path.exists(history_file):
        raise HTTPException(status_code=404, detail="History not found")
    
    try:
        with open(history_file, "r", encoding="utf-8") as f:
            history = json.load(f)
            
        new_history = [item for item in history if item.get("id") != item_id]
        
        with open(history_file, "w", encoding="utf-8") as f:
            json.dump(new_history, f, indent=2, ensure_ascii=False)
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting history: {e}")


@app.post("/api/run")
async def run_pipeline(req: RunRequest):
    """Start the pipeline and stream results via SSE."""
    if not req.task.strip() and not req.attachments:
        raise HTTPException(status_code=400, detail="Task and attachments cannot both be empty")
        
    return EventSourceResponse(pipeline_generator(req.task, req.mock, req.attachments))


@app.post("/api/clarify")
async def clarify_task(req: ClarifyRequest):
    """Determine if task needs clarification or execution."""
    if not req.chat_history and not req.attachments:
        raise HTTPException(status_code=400, detail="Chat history cannot be empty")
        
    clarifier = Clarifier()
    history = [{"role": msg.role, "content": msg.content} for msg in req.chat_history]
    
    # Inject attachments into the last message for the Clarifier to see
    if req.attachments and history:
        text_content = history[-1]["content"] + "\n\n[Attached Files]:\n"
        image_items = []
        for att in req.attachments:
            if att.type == "text":
                text_content += f"- {att.name}:\n{att.content}\n"
            elif att.type == "image":
                text_content += f"- {att.name} (Image attached)\n"
                url = att.content if att.content.startswith("data:") else f"data:image/jpeg;base64,{att.content}"
                image_items.append({
                    "type": "image_url",
                    "image_url": {"url": url}
                })
        
        if image_items:
            history[-1]["content"] = [{"type": "text", "text": text_content}] + image_items
        else:
            history[-1]["content"] = text_content

    result = await clarifier.evaluate(history)
    
    # If not a question, append attachments text to the final task string so the decomposer can see them
    if result.action == "execute" and req.attachments:
        attachment_text = "\n\n[Attached Files]:\n"
        for att in req.attachments:
            if att.type == "text":
                attachment_text += f"- {att.name}:\n{att.content}\n"
            else:
                attachment_text += f"- {att.name} (Image attached)\n"
        result.task += attachment_text

    return result.model_dump()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
