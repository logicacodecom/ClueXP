"""Minimal GitHub REST client for the SDLC gate and post-deploy verification (specs/004).

Standard library only. Token from GITHUB_TOKEN, repository from GITHUB_REPOSITORY.
The PR gate uses read-only calls; only the main-only post-deploy job writes issues.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")


class GitHubError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"GitHub API {status}: {message}")
        self.status = status


def request(method: str, path: str, body: dict | None = None) -> dict | list:
    token = os.environ.get("GITHUB_TOKEN", "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raise GitHubError(exc.code, exc.read().decode("utf-8", "replace")[:300]) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise GitHubError(0, str(exc)) from exc
    return json.loads(raw) if raw else {}


def repo() -> str:
    return os.environ["GITHUB_REPOSITORY"]


def get_pull(number: str | int) -> dict:
    result = request("GET", f"/repos/{repo()}/pulls/{number}")
    assert isinstance(result, dict)
    return result


def compare_status(base: str, head: str) -> str:
    """identical | ahead | behind | diverged (head relative to base)."""
    result = request("GET", f"/repos/{repo()}/compare/{base}...{head}")
    assert isinstance(result, dict)
    return str(result.get("status", "unknown"))


def open_incident(title: str, body: str, label: str = "deploy-incident") -> str:
    """Comment on the open incident for this title, or create one. Returns the issue URL."""
    try:
        request("POST", f"/repos/{repo()}/labels", {"name": label, "color": "b60205"})
    except GitHubError as exc:
        if exc.status != 422:  # 422 = label already exists
            raise
    issues = request("GET", f"/repos/{repo()}/issues?labels={label}&state=open&per_page=100")
    assert isinstance(issues, list)
    for issue in issues:
        if issue.get("title") == title:
            request("POST", f"/repos/{repo()}/issues/{issue['number']}/comments", {"body": body})
            return str(issue["html_url"])
    created = request("POST", f"/repos/{repo()}/issues", {"title": title, "body": body, "labels": [label]})
    assert isinstance(created, dict)
    return str(created["html_url"])
