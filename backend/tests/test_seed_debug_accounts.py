from pathlib import Path

import httpx
import pytest

from scripts.seed_debug_accounts import create_account, parse_accounts, run
import scripts.seed_debug_accounts as seed


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


def test_run_returns_2_when_env_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(seed.settings, "supabase_url", "", raising=False)
    monkeypatch.setattr(seed.settings, "supabase_secret_key", "", raising=False)
    accounts = tmp_path / "accounts.txt"
    accounts.write_text("a@b.c,pw\n", encoding="utf-8")
    assert run(accounts) == 2


def test_run_returns_2_when_file_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(seed.settings, "supabase_url", "https://x.supabase.co", raising=False)
    monkeypatch.setattr(seed.settings, "supabase_secret_key", "k", raising=False)
    missing = tmp_path / "nope.txt"
    assert run(missing) == 2
