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


def _spread(chunks, k):
    """Pick k chunks spread evenly from start to end of the page."""
    if len(chunks) <= k:
        return chunks
    step = (len(chunks) - 1) / (k - 1)
    return [chunks[round(i * step)] for i in range(k)]


def get_context(text, question, overview=False):
    """Return (chunks, is_excerpt).

    Short pages are split into passages and all are sent.
    Long pages are reduced to excerpts: the chunks most relevant to the
    question, or, for an overview, chunks spread across the whole page.
    """
    if len(text) <= config.MAX_PAGE_CHARS:
        return _plain_splitter.split_text(text), False

    if overview:
        chunks = _splitter.split_text(text[: config.MAX_INDEX_CHARS])
        picked = _spread(chunks, config.SUMMARY_CHUNKS)
        log.info("Overview: %d of %d chunks", len(picked), len(chunks))
        return picked, True

    index = _get_index(text[: config.MAX_INDEX_CHARS])
    chunks = index.search(question, config.TOP_K)
    log.info("Retrieved %d of %d chunks", len(chunks), len(index.chunks))
    return chunks, True