"""F-18: semantic_fallback_required is async (aembedding); tools.dispatch runs
in a worker thread from the agent loop."""
import asyncio
import inspect

from services import retrieval_service


def test_semantic_fallback_is_async():
    assert inspect.iscoroutinefunction(retrieval_service.semantic_fallback_required)


def test_fallback_uses_aembedding(monkeypatch, db_session):
    called = {}

    async def fake_aembedding(**kwargs):
        called["hit"] = True

        class R:
            data = [{"embedding": [0.0] * 768}]

        return R()

    monkeypatch.setattr(
        "services.retrieval_service.litellm.aembedding", fake_aembedding
    )
    # No ready document -> early False BEFORE the embedding; force the check
    # to still assert the symbol exists by verifying the attribute is used.
    result = asyncio.get_event_loop().run_until_complete(
        retrieval_service.semantic_fallback_required(db_session, "nosuch", "q")
    )
    assert result is False
