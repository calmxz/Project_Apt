"""TDD: lib.chunking — token-bounded chunks with page tracking + overlap."""

from lib.chunking import chunk_text


def test_single_short_page_yields_one_chunk():
    chunks = chunk_text([(1, "A short sentence about joins.")])
    assert len(chunks) == 1
    assert chunks[0].page == 1
    assert chunks[0].chunk_idx == 0
    assert "joins" in chunks[0].text


def test_multi_chunk_respects_overlap():
    long_text = " ".join(["alpha"] * 1500)
    chunks = chunk_text([(1, long_text)], chunk_tokens=500, overlap_tokens=50)
    assert len(chunks) > 1
    # Sequential chunk_idx
    assert [c.chunk_idx for c in chunks] == list(range(len(chunks)))
    # Each chunk has alpha tokens; overlap means consecutive chunks share content
    first_tokens = chunks[0].text.split()
    second_tokens = chunks[1].text.split()
    assert any(t in second_tokens for t in first_tokens[-30:])


def test_page_assignment_is_first_tokens_page():
    a = "word " * 400
    b = "term " * 400
    chunks = chunk_text([(1, a), (2, b)], chunk_tokens=500, overlap_tokens=50)
    # First chunk should start on page 1, later chunks span into page 2
    assert chunks[0].page == 1
    pages = {c.page for c in chunks}
    assert pages == {1, 2}
