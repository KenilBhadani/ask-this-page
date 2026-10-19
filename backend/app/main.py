import json
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import llm, rag

app = FastAPI(title="Ask this page")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    question: str
    text: str
    url: str = ""
    title: str = ""
    mode: Literal["ask", "summary"] = "ask"
    history: list[Turn] = []


def stream_with_sources(sources, tokens):
    # First line: the passages as JSON. Everything after it: the answer text.
    yield json.dumps(sources) + "\n"
    yield from tokens


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ask")
def ask(req: AskRequest):
    recent = req.history[-6:]
    history = [{"role": t.role, "content": t.content[:2000]} for t in recent]
    last_question = next(
        (t.content for t in reversed(recent) if t.role == "user"), ""
    )
    search_query = f"{last_question} {req.question}".strip()

    try:
        chunks, is_excerpt = rag.get_context(
            req.text, search_query, overview=(req.mode == "summary")
        )
        stream = llm.open_stream(
            req.question, req.title, req.url, chunks, is_excerpt, history
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    sources = [{"id": i, "text": chunk} for i, chunk in enumerate(chunks, start=1)]
    return StreamingResponse(
        stream_with_sources(sources, llm.iter_tokens(stream)),
        media_type="text/plain; charset=utf-8",
    )