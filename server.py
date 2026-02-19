"""
Minimal FastAPI server + relay bridge.
Run this in the Claude Code Web sandbox to expose HTTP endpoints externally.
Usage:
    pip install fastapi uvicorn httpx
    RELAY_TOKEN=cc-relay-xxx python server.py
"""

import asyncio
import json
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request

RELAY_URL = os.environ.get("RELAY_URL", "https://cc-relay.daniel-90c.workers.dev")
RELAY_TOKEN = os.environ["RELAY_TOKEN"]
LOCAL_PORT = 8000


# --- Bridge: polls relay, forwards to local FastAPI ---


async def bridge_loop() -> None:
    """Poll the relay for pending requests and forward them to the local server."""
    async with httpx.AsyncClient() as relay, httpx.AsyncClient() as local:
        while True:
            try:
                resp = await relay.get(
                    f"{RELAY_URL}/proxy/_poll",
                    headers={"x-token": RELAY_TOKEN},
                    timeout=10,
                )
                data: dict[str, Any] = resp.json()
                for req in data.get("requests", []):
                    req: dict[str, Any]
                    try:
                        local_resp = await local.request(
                            method=str(req["method"]),
                            url=f"http://127.0.0.1:{LOCAL_PORT}{req['path']}",
                            content=req.get("body"),
                            headers={"Content-Type": "application/json"},
                            timeout=30,
                        )
                        _ = await relay.post(
                            f"{RELAY_URL}/proxy/_respond",
                            headers={"x-token": RELAY_TOKEN},
                            json={
                                "id": req["id"],
                                "status": local_resp.status_code,
                                "body": local_resp.text,
                                "content_type": local_resp.headers.get(
                                    "content-type", "application/json"
                                ),
                            },
                            timeout=10,
                        )
                    except Exception as e:
                        _ = await relay.post(
                            f"{RELAY_URL}/proxy/_respond",
                            headers={"x-token": RELAY_TOKEN},
                            json={
                                "id": req["id"],
                                "status": 502,
                                "body": json.dumps({"error": str(e)}),
                                "content_type": "application/json",
                            },
                            timeout=10,
                        )
            except Exception:
                pass  # relay unreachable, retry
            await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    _ = asyncio.create_task(bridge_loop())
    yield


app = FastAPI(lifespan=lifespan)


# --- Your endpoints go here ---


@app.get("/hello")
async def hello() -> dict[str, str]:
    return {"message": "Hello from Claude Code sandbox!"}


@app.post("/echo")
async def echo(request: Request) -> dict[str, Any]:
    body: Any = await request.json()
    return {"echo": body}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=LOCAL_PORT)
