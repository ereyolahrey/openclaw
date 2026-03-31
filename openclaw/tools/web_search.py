"""Web-search tool (uses DuckDuckGo Instant Answer API – no key required)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request


_DDG_URL = "https://api.duckduckgo.com/"
_TIMEOUT = 10
_MAX_CHARS = 2048


def web_search(query: str) -> str:
    """Return a short summary for *query* using DuckDuckGo's Instant Answer API.

    Falls back to a plain-text snippet when no abstract is available.
    """
    params = urllib.parse.urlencode(
        {"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"}
    )
    url = f"{_DDG_URL}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT) as resp:  # noqa: S310
            data = json.loads(resp.read().decode())
    except urllib.error.URLError as exc:
        return f"Error: network request failed – {exc}"
    except Exception as exc:  # noqa: BLE001
        return f"Error: {exc}"

    abstract = data.get("AbstractText") or ""
    answer = data.get("Answer") or ""
    related = data.get("RelatedTopics", [])

    if answer:
        return answer[:_MAX_CHARS]
    if abstract:
        return abstract[:_MAX_CHARS]

    # Collect snippets from related topics.
    snippets: list[str] = []
    for item in related:
        if isinstance(item, dict) and item.get("Text"):
            snippets.append(item["Text"])
        if sum(len(s) for s in snippets) >= _MAX_CHARS:
            break

    if snippets:
        return "\n".join(snippets)[:_MAX_CHARS]

    return f"No instant answer found for: {query}"
