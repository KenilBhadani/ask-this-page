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


class AskRequest(BaseModel):
    question: str
    text: str
    url: str = ""
    title: str = ""


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ask")
def ask(req: AskRequest):
    try:
        context, is_excerpt = rag.get_context(req.text, req.question)
        stream = llm.open_stream(
            req.question, req.title, req.url, context, is_excerpt
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return StreamingResponse(
        llm.iter_tokens(stream),
        media_type="text/plain; charset=utf-8",
    )