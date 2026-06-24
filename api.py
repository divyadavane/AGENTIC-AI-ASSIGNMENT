import asyncio
import json
from typing import AsyncGenerator

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from orchestrator.core import Orchestrator, DecompositionError
import config
from main import _enable_mock_llm

app = FastAPI(title="Agentic AI API")

# Allow CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def pipeline_generator(task: str, mock: bool) -> AsyncGenerator[dict, None]:
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
    
    try:
        async for result in orch.execute_pipeline(steps):
            yield {
                "event": "step_result",
                "data": result.model_dump_json()
            }
    except Exception as e:
        yield {
            "event": "error",
            "data": json.dumps({"error": f"Pipeline error: {e}"})
        }
        return

    # 3. Finished
    yield {
        "event": "status",
        "data": json.dumps({"status": "finished", "message": "Task completed successfully."})
    }


@app.get("/api/run")
async def run_pipeline(
    task: str = Query(..., description="The task to execute"),
    mock: bool = Query(False, description="Use mock LLM to avoid rate limits")
):
    """Start the pipeline and stream results via SSE."""
    if not task.strip():
        raise HTTPException(status_code=400, detail="Task cannot be empty")
        
    return EventSourceResponse(pipeline_generator(task, mock))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
