"""Native bearer refresh token tests (InMemory store via TestClient).

Covers: login without want_refresh_token is unaffected (web/BFF path); opting in
issues a refresh token; refresh rotates (new access + new refresh, old refresh
consumed); reusing an already-rotated refresh token is detected and revokes the
whole chain (401 on the next attempt too); logout revokes; invalid/empty tokens
are rejected.

Run from apps/intake-web:  pytest api/tests/test_auth_refresh.py
"""
from __future__ import annotations

from starlette.testclient import TestClient

from api.main import app


DEMO_TECH = {"identifier": "jordan@cluexp.example", "password": "123456"}


def test_login_without_opt_in_has_no_refresh_token():
    client = TestClient(app)
    resp = client.post("/auth/login", json=DEMO_TECH)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body.get("refresh_token") is None


def test_login_with_opt_in_issues_refresh_token():
    client = TestClient(app)
    resp = client.post("/auth/login", json={**DEMO_TECH, "want_refresh_token": True})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert isinstance(body["refresh_token"], str) and len(body["refresh_token"]) > 20


def test_refresh_rotates_and_old_token_stops_working():
    client = TestClient(app)
    login = client.post("/auth/login", json={**DEMO_TECH, "want_refresh_token": True}).json()
    old_refresh = login["refresh_token"]

    first = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert first.status_code == 200, first.text
    rotated = first.json()
    assert rotated["access_token"]
    assert rotated["refresh_token"] and rotated["refresh_token"] != old_refresh
    # session/account data still comes back correctly
    assert rotated["session"]["user"]["email"] == "jordan@cluexp.example"

    # the OLD refresh token is now consumed and cannot be reused
    replay = client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401


def test_reuse_of_rotated_token_revokes_the_whole_chain():
    client = TestClient(app)
    login = client.post("/auth/login", json={**DEMO_TECH, "want_refresh_token": True}).json()
    gen1 = login["refresh_token"]
    gen2 = client.post("/auth/refresh", json={"refresh_token": gen1}).json()["refresh_token"]

    # replay the now-stale gen1 -> reuse detected, 401
    replay = client.post("/auth/refresh", json={"refresh_token": gen1})
    assert replay.status_code == 401

    # gen2 (the legitimate current token) is also revoked as a defensive measure
    legit_now_dead = client.post("/auth/refresh", json={"refresh_token": gen2})
    assert legit_now_dead.status_code == 401


def test_new_access_token_from_refresh_works_for_authenticated_calls():
    client = TestClient(app)
    login = client.post("/auth/login", json={**DEMO_TECH, "want_refresh_token": True}).json()
    rotated = client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]}).json()
    me = client.get("/auth/me", headers={"authorization": f"Bearer {rotated['access_token']}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "jordan@cluexp.example"


def test_logout_revokes_refresh_token():
    client = TestClient(app)
    login = client.post("/auth/login", json={**DEMO_TECH, "want_refresh_token": True}).json()
    token = login["refresh_token"]

    out = client.post("/auth/logout", json={"refresh_token": token})
    assert out.status_code == 200
    assert out.json()["revoked"] is True

    after = client.post("/auth/refresh", json={"refresh_token": token})
    assert after.status_code == 401

    # revoking again (already revoked) reports revoked: False, not an error
    again = client.post("/auth/logout", json={"refresh_token": token})
    assert again.status_code == 200
    assert again.json()["revoked"] is False


def test_invalid_and_empty_refresh_tokens_are_rejected():
    client = TestClient(app)
    bad = client.post("/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert bad.status_code == 401
    empty = client.post("/auth/refresh", json={"refresh_token": ""})
    assert empty.status_code == 401
