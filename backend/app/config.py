import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# Pages up to this size are sent to the model whole
MAX_PAGE_CHARS = 12000
# Safety cap on how much of a huge page gets indexed
MAX_INDEX_CHARS = 300000

# Retrieval settings for long pages
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
TOP_K = 6
MAX_CACHED_PAGES = 20
SUMMARY_CHUNKS = 8