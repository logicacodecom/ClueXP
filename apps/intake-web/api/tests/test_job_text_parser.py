from __future__ import annotations

import time

from api.job_text_parser import MAX_INPUT_LENGTH, parse_job_text as parse


def test_workiz_style_input_maps_known_fields_and_notes_only_leftovers():
    result = parse(
        "New job # 246303 Name: Joe Walker (8338600270 #7996) "
        "N 21st St, Tampa, Florida 33605 Car Lockout Confirm: "
        "https://app.workiz.com/index.php?page=confirm_job&token=5X2XDK "
        "Description: 2009 dodge charger"
    )

    assert result["externalJobId"]["value"] == "246303"
    assert result["secondaryReference"]["value"] == "7996"
    assert result["customer"]["name"]["value"] == "Joe Walker"
    assert result["customer"]["phone"]["value"] == "+18338600270"
    assert result["location"]["addressLine1"]["value"] == "N 21st St"
    assert result["location"]["state"]["value"] == "FL"
    assert result["service"]["category"]["value"] == "vehicle"
    assert result["service"]["type"]["value"] == "locked_out"
    assert result["vehicle"]["year"]["value"] == 2009
    assert result["vehicle"]["make"]["value"] == "Dodge"
    assert result["vehicle"]["model"]["value"] == "Charger"
    assert result["detectedSource"] == "workiz"
    assert result["location"]["isComplete"] is False
    assert any(w["code"] == "missing_street_number" for w in result["warnings"])


def test_complete_address_is_marked_complete():
    result = parse(
        "Job 246303\nJoe Walker\n8338600270\n"
        "1234 N 21st St, Tampa, FL 33605\nCar Lockout\n2009 Dodge Charger"
    )

    assert result["location"]["addressLine1"]["value"] == "1234 N 21st St"
    assert result["location"]["isComplete"] is True


def test_trailing_directional_and_multiline_description():
    """Real Workiz shape that parsed to an empty location and a null description:
    the directional trails the suffix ("Ave N") and the description spans lines."""
    result = parse(
        "New job # 245244 Name: Dana Reyes (8338600270 #3535) "
        "1200 43rd Ave N, St. Petersburg, Florida 33709 House Lockout Confirm: "
        "https://app.workiz.com/index.php?page=confirm_job&token=93USXA "
        "Description: $70 flat \n--\ndog locked inside"
    )

    assert result["location"]["addressLine1"]["value"] == "1200 43rd Ave N"
    assert result["location"]["city"]["value"] == "St. Petersburg"
    assert result["location"]["state"]["value"] == "FL"
    assert result["location"]["postalCode"]["value"] == "33709"
    assert result["location"]["isComplete"] is True
    assert result["description"]["value"] == "$70 flat\n--\ndog locked inside"
    assert result["service"]["category"]["value"] == "home"
    assert not any(w["field"].startswith("location") for w in result["warnings"])


def test_unlabelled_name_wrapped_in_punctuation():
    """No "Name:" label, and the closing paren used to defeat the anchored
    fallback that reads the name preceding the phone number."""
    result = parse(
        "(Kelonshay Watson)\n(4454474307 #238)\n"
        "13090 Gandy Blvd N, St. Petersburg, Florida 33702\n________\n"
        " Car Lockout \n2012 Mazda 3 \n$60-$80"
    )

    assert result["customer"]["name"]["value"] == "Kelonshay Watson"
    assert result["customer"]["phone"]["value"] == "+14454474307"
    assert result["location"]["addressLine1"]["value"] == "13090 Gandy Blvd N"
    assert result["location"]["isComplete"] is True
    assert result["service"]["category"]["value"] == "vehicle"
    assert result["vehicle"]["model"]["value"] == "3"


def test_city_directional_is_not_claimed_by_the_street():
    result = parse("123 Main St, W Palm Beach, FL 33401 House Lockout")

    assert result["location"]["addressLine1"]["value"] == "123 Main St"
    assert result["location"]["city"]["value"] == "W Palm Beach"


def test_missing_address_warns_instead_of_failing_silently():
    result = parse("Job 4321 Dana Reyes 8338600270 House Lockout")

    assert result["location"] == {"isComplete": False}
    assert any(w["code"] == "address_not_found" for w in result["warnings"])


def test_unsafe_url_is_rejected():
    result = parse("Confirm: javascript:alert(1)")

    assert "externalUrl" not in result
    assert any(w["code"] == "unsafe_url_rejected" for w in result["warnings"])


def test_unknown_service_warns_instead_of_guessing():
    result = parse("Joe Walker 8338600270\n1234 N 21st St Tampa FL 33605\nNeeds help with lock")

    assert "type" not in result["service"]
    assert any(w["code"] == "unknown_service" for w in result["warnings"])


def test_max_length_input_cannot_stall_the_event_loop():
    """The address regex once backtracked for 32s on input this shape, blocking
    every other request on the worker. Bound is generous -- it only has to fail
    if the quantifiers go unbounded again."""
    near_miss = (("a " * (MAX_INPUT_LENGTH // 2)) + "St Tampa FL 3360")[:MAX_INPUT_LENGTH]

    started = time.perf_counter()
    parse(near_miss)

    assert time.perf_counter() - started < 5.0


def test_parse_endpoint_requires_a_session():
    from api.main import app
    from starlette.testclient import TestClient

    response = TestClient(app).post("/provider/jobs/parse-text", json={"text": "Job 1234"})

    assert response.status_code == 401


def test_parse_endpoint_is_side_effect_free(monkeypatch):
    from api.auth import create_access_token
    from api.main import app, store
    from starlette.testclient import TestClient

    calls = {"saved": 0}

    async def session(_user_id: str):
        return {
            "user": {"id": "user-parser", "display_name": "Parser Tester", "email": None, "phone": None},
            "roles": ["dispatcher"],
            "active_organization_id": "org-parser",
            "organization_name": "Parser Org",
            "technician": None,
        }

    async def save(*_args, **_kwargs):
        calls["saved"] += 1

    monkeypatch.setattr(store, "get_user_session", session)
    monkeypatch.setattr(store, "save", save)
    token = create_access_token({"sub": "user-parser", "roles": ["dispatcher"], "org": "org-parser"})

    response = TestClient(app).post(
        "/provider/jobs/parse-text",
        json={"text": "Job 246303 Joe Walker 8338600270 1234 N 21st St Tampa FL 33605 Car Lockout"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["success"] is True
    assert response.json()["result"]["externalJobId"]["value"] == "246303"
    assert calls["saved"] == 0
