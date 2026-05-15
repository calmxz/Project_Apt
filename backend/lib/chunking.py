"""Token-bounded chunking with page tracking (Spec §3.1, §4.2).

500 tokens per chunk with 50-token overlap (tiktoken cl100k_base). Each chunk
records the page number of its first token.
"""

from dataclasses import dataclass

import tiktoken


_ENCODING = tiktoken.get_encoding("cl100k_base")


@dataclass
class Chunk:
    text: str
    page: int
    chunk_idx: int


def _flat_tokens_with_pages(text_by_page: list[tuple[int, str]]) -> tuple[list[int], list[int]]:
    tokens: list[int] = []
    page_of_token: list[int] = []
    for page, text in text_by_page:
        page_tokens = _ENCODING.encode(text)
        tokens.extend(page_tokens)
        page_of_token.extend([page] * len(page_tokens))
    return tokens, page_of_token


def chunk_text(
    text_by_page: list[tuple[int, str]],
    chunk_tokens: int = 500,
    overlap_tokens: int = 50,
) -> list[Chunk]:
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    if overlap_tokens < 0 or overlap_tokens >= chunk_tokens:
        raise ValueError("overlap_tokens must be in [0, chunk_tokens)")

    tokens, page_of_token = _flat_tokens_with_pages(text_by_page)
    if not tokens:
        return []

    stride = chunk_tokens - overlap_tokens
    chunks: list[Chunk] = []
    start = 0
    idx = 0
    while start < len(tokens):
        end = min(start + chunk_tokens, len(tokens))
        slice_tokens = tokens[start:end]
        text = _ENCODING.decode(slice_tokens)
        chunks.append(Chunk(text=text, page=page_of_token[start], chunk_idx=idx))
        idx += 1
        if end == len(tokens):
            break
        start += stride
    return chunks
