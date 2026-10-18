from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import llm

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
        answer = llm.answer(req.question, req.title, req.url, req.text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"answer": answer}