def test_no_subject_routes(client):
    for r in [
        client.get("/api/subjects"),
        client.post("/api/subjects", json={}),
        client.get("/api/subjects/x"),
    ]:
        assert r.status_code == 404
