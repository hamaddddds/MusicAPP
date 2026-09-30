"""Run with python -m unittest discover -s tests."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "Backend"))
from app.main import app


class BetterLyricsProxyTests(unittest.TestCase):
    def request(self, handler, query="title=Test&artist=Artist&duration=243"):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch("app.main.httpx.AsyncClient", return_value=client):
            return TestClient(app).get("/lyrics/better?" + query)

    def test_fixed_upstream_and_metadata(self):
        def handler(request):
            self.assertEqual(request.url.host, "api.betterlyrics.org")
            self.assertEqual(dict(request.url.params), {"s": "Test", "a": "Artist", "d": "243"})
            return httpx.Response(200, json={"ttml": "<tt/>", "score": .98, "unexpected": "discard"})
        result = self.request(handler)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {"ttml": "<tt/>", "score": .98})

    def test_missing_duration_is_optional(self):
        def handler(request):
            self.assertNotIn("d", request.url.params)
            return httpx.Response(200, json={"ttml": "<tt/>"})
        self.assertEqual(self.request(handler, "title=Test&artist=Artist").status_code, 200)

    def test_provider_errors_are_preserved_for_fallback(self):
        for status in [401, 404, 429, 503]:
            with self.subTest(status=status):
                result = self.request(lambda _: httpx.Response(status))
                self.assertEqual(result.status_code, status)

    def test_malformed_payload_and_timeout(self):
        for payload in [[], {"ttml": None}, {"lyrics": "invalid"}]:
            self.assertEqual(self.request(lambda _: httpx.Response(200, json=payload)).status_code, 502)
        self.assertEqual(self.request(lambda _: httpx.Response(200, text="not json")).status_code, 502)
        def timeout(_):
            raise httpx.ReadTimeout("timeout")
        self.assertEqual(self.request(timeout).status_code, 502)

    def test_invalid_query_is_rejected(self):
        client = TestClient(app)
        for query in ["title=&artist=A", "title=T", "title=T&artist=A&duration=-1", "title=T&artist=A&duration=999999"]:
            self.assertEqual(client.get("/lyrics/better?" + query).status_code, 422)


if __name__ == "__main__":
    unittest.main()
