"""
Multi-Agent Debate Backend Server

FastAPI WebSocket server that receives graph configurations from the frontend
and runs AutoGen agents in a debate pattern.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from graph_converter import run_debate

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Multi-Agent Debate API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Multi-Agent Debate API"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for running agent debates.

    Receives a graph configuration and streams debate messages back to the client.

    Expected config format:
    {
        "nodes": [{"id": "uuid", "label": "Agent Name", "systemPrompt": "...", "temperature": 0.8}, ...],
        "edges": [{"from": "uuid", "to": "uuid", "direction": "bidirectional"}, ...],
        "rounds": 3,
        "apiKey": "sk-...",
        "question": "Your debate topic"
    }
    """
    await websocket.accept()
    logger.info("WebSocket connection accepted")

    try:
        # Receive graph configuration
        data = await websocket.receive_text()
        config = json.loads(data)
        logger.info(f"Received config with {len(config.get('nodes', []))} agents")

        # Validate config
        if not config.get("nodes") or len(config["nodes"]) < 2:
            await websocket.send_json({
                "type": "error",
                "error": "At least 2 agents are required"
            })
            return

        if not config.get("apiKey"):
            await websocket.send_json({
                "type": "error",
                "error": "API key is required"
            })
            return

        # Run the debate and stream messages
        async for message in run_debate(config):
            message_type = message.get("type")
            if message_type == "position":
                # Position updates are sent as top-level events
                await websocket.send_json(message)
            else:
                # Default to message events for the log and bubbles
                await websocket.send_json({
                    "type": "message",
                    "data": message
                })
            # Small delay between messages for visual effect
            await asyncio.sleep(0.5)

        # Signal completion
        await websocket.send_json({"type": "complete"})
        logger.info("Debate completed successfully")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON: {e}")
        await websocket.send_json({
            "type": "error",
            "error": "Invalid JSON format"
        })
    except Exception as e:
        logger.error(f"Error during debate: {e}")
        await websocket.send_json({
            "type": "error",
            "error": str(e)
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
