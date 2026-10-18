from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Ask this page")

# Allow requests from the extension (fine for local development)
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
    return {
        "answer": (
            f"Backend received your question: '{req.question}'. "
            f"The page has {len(req.text)} characters."
        )
    }