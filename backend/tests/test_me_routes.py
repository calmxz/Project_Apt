"""F-46: onboarding state is server-persisted on the users row."""


H = {"Authorization": "Bearer test-me-user"}


def test_get_me_defaults(client):
    resp = client.get("/api/me", headers=H)
    assert resp.status_code == 200
    body = resp.json()
    assert body["onboarding_complete"] is False
    assert body["display_name"] is None


def test_get_me_existing_row_does_not_commit(client, monkeypatch):
    # Perf: GET /me sits on the frontend's render-blocking boot path. Once the
    # users row exists the read must not round-trip a COMMIT to the database.
    from sqlalchemy.orm import Session as OrmSession

    client.get("/api/me", headers=H)  # first call may create + commit

    calls = []
    orig = OrmSession.commit

    def counting(self):
        calls.append(1)
        return orig(self)

    monkeypatch.setattr(OrmSession, "commit", counting)
    resp = client.get("/api/me", headers=H)
    assert resp.status_code == 200
    assert calls == []


def test_patch_me_roundtrip(client):
    resp = client.patch(
        "/api/me",
        json={"display_name": "Ada", "feedback_pref": "direct",
              "onboarding_complete": True},
        headers=H,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"display_name": "Ada", "feedback_pref": "direct",
                    "onboarding_complete": True}
    again = client.get("/api/me", headers=H)
    assert again.json()["onboarding_complete"] is True


def test_patch_me_partial_keeps_other_fields(client):
    client.patch("/api/me", json={"display_name": "Ada"}, headers=H)
    client.patch("/api/me", json={"onboarding_complete": True}, headers=H)
    body = client.get("/api/me", headers=H).json()
    assert body["display_name"] == "Ada"
    assert body["onboarding_complete"] is True


def test_patch_me_empty_body_rejected(client):
    resp = client.patch("/api/me", json={}, headers=H)
    assert resp.status_code == 422
