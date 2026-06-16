import httpx
import pytest

from scripts.seed_debug_accounts import create_account, parse_accounts


def _client(handler):
    transport = httpx.MockTransport(handler)
    return httpx.Client(
        base_url="https://example.supabase.co",
        transport=transport,
        headers={"apikey": "k", "Authorization": "Bearer k"},
    )


def test_parse_accounts_skips_comments_and_blanks():
    text = "\n".join(
        [
            "# debug accounts",
            "",
            "alice@example.com,Passw0rd123",
            "  bob@example.com , Hunter2pw  ",
            "# trailing comment",
        ]
    )
    assert parse_accounts(text) == [
        ("alice@example.com", "Passw0rd123"),
        ("bob@example.com", "Hunter2pw"),
    ]


def test_create_account_created_on_2xx():
    def handler(request):
        assert request.url.path == "/auth/v1/admin/users"
        import json

        body = json.loads(request.content)
        assert body == {
            "email": "alice@example.com",
            "password": "Passw0rd123",
            "email_confirm": True,
        }
        return httpx.Response(200, json={"id": "u-1"})

    with _client(handler) as client:
        assert create_account(client, "alice@example.com", "Passw0rd123") == "created"


def test_create_account_exists_on_duplicate():
    def handler(request):
        return httpx.Response(
            422, json={"msg": "A user with this email address has already been registered"}
        )

    with _client(handler) as client:
        assert create_account(client, "alice@example.com", "Passw0rd123") == "exists"


def test_create_account_raises_on_other_error():
    def handler(request):
        return httpx.Response(500, json={"msg": "boom"})

    with _client(handler) as client:
        with pytest.raises(RuntimeError):
            create_account(client, "alice@example.com", "Passw0rd123")
