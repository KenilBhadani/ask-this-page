import hashlib
import logging

import faiss
import numpy as np
from fastembed import TextEmbedding
from langchain_text_splitters import RecursiveCharacterTextSplitter

from . import config

log = logging.getLogger("uvicorn.error")

_embedder = None
_cache = {}

_splitter = RecursiveCharacterTextSplitter(
    chunk_size=config.CHUNK_SIZE,
    chunk_overlap=config.CHUNK_OVERLAP,
)
_plain_splitter = RecursiveCharacterTextSplitter(
    chunk_size=config.CHUNK_SIZE,
    chunk_overlap=0,
)


def _get_embedder():
    global _embedder
    if _embedder is None:
        log.info("Loading embedding model (the first run downloads it)...")
        _embedder = TextEmbedding(model_name=config.EMBED_MODEL)
    return _embedder


def _embed(texts):
    vectors = np.array(list(_get_embedder().embed(texts)), dtype="float32")
    faiss.normalize_L2(vectors)
    return vectors


class PageIndex:
    def __init__(self, text):
        self.chunks = _splitter.split_text(text)
        vectors = _embed(self.chunks)
        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)

    def search(self, question, k):
        k = min(k, len(self.chunks))
        _, ids = self.index.search(_embed([question]), k)
        found = sorted(int(i) for i in ids[0] if i != -1)
        return [self.chunks[i] for i in found]


def _get_index(text):
    key = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if key not in _cache:
        if len(_cache) >= config.MAX_CACHED_PAGES:
            _cache.pop(next(iter(_cache)))
        _cache[key] = PageIndex(text)
        log.info("Indexed page: %d chunks", len(_cache[key].chunks))
    return _cache[key]


def get_context(text, question):
    """Return (chunks, is_excerpt).

    Short pages are split into passages and all are sent.
    Long pages are reduced to the most relevant chunks.
    """
    if len(text) <= config.MAX_PAGE_CHARS:
        return _plain_splitter.split_text(text), False
    index = _get_index(text[: config.MAX_INDEX_CHARS])
    chunks = index.search(question, config.TOP_K)
    log.info("Retrieved %d of %d chunks", len(chunks), len(index.chunks))
    return chunks, True


def make_snippet(chunk, size=80):
    """A short single-line piece of a chunk, used to find it on the page."""
    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    if not lines:
        return ""
    line = next((ln for ln in lines if len(ln) >= 40), max(lines, key=len))
    return line[:size].strip()