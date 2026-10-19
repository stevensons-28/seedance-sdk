"""Webhook verification tests. The signing below mirrors the KreatorFlow server exactly:
HMAC-SHA256 of "<unix seconds>.<raw JSON body>", hex, sent as "t=<unix seconds>,v1=<hex>"."""

from __future__ import annotations

import hashlib
import hmac
import json
import unittest

from seedance import WebhookVerificationError, compute_signature, verify_webhook

SECRET = "whsec_test_secret"
NOW = 1_760_000_000


def signed(event: dict, secret: str = SECRET, timestamp: int = NOW):
    body = json.dumps(event)
    signature = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-KreatorFlow-Event-Id": event["id"],
        "X-KreatorFlow-Event-Type": event["type"],
        "X-KreatorFlow-Job-Id": event["data"]["job"]["id"],
        "X-KreatorFlow-Timestamp": str(timestamp),
        "X-KreatorFlow-Signature": f"t={timestamp},v1={signature}",
    }
    return body, headers


EVENT = {
    "object": "kreatorflow.developer_webhook_event",
    "id": "evt_3f1c0a9e1b2c4d3e8f40123456789abc_completed",
    "type": "job.completed",
    "created": "2026-10-19T10:00:00.000Z",
    "data": {"job": {"id": "3f1c0a9e-1b2c-4d3e-8f40-123456789abc", "status": "completed"}},
}


class WebhookTests(unittest.TestCase):
    def test_valid_signature(self) -> None:
        body, headers = signed(EVENT)
        event = verify_webhook(body, headers, SECRET, now=NOW + 10)
        self.assertEqual(event["type"], "job.completed")
        self.assertEqual(event["data"]["job"]["status"], "completed")

    def test_bytes_body_and_lowercase_headers(self) -> None:
        body, headers = signed(EVENT)
        lower = {k.lower(): v for k, v in headers.items()}
        self.assertEqual(verify_webhook(body.encode(), lower, SECRET, now=NOW)["id"], EVENT["id"])

    def test_compute_signature_matches(self) -> None:
        body, headers = signed(EVENT)
        self.assertIn(f"v1={compute_signature(body, NOW, SECRET)}", headers["X-KreatorFlow-Signature"])

    def test_tampered_body(self) -> None:
        body, headers = signed(EVENT)
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(body.replace("completed", "failed"), headers, SECRET, now=NOW)
        self.assertEqual(ctx.exception.code, "webhook_signature_invalid")

    def test_wrong_secret(self) -> None:
        body, headers = signed(EVENT, secret="other")
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body, headers, SECRET, now=NOW)

    def test_old_timestamp(self) -> None:
        body, headers = signed(EVENT)
        with self.assertRaises(WebhookVerificationError) as ctx:
            verify_webhook(body, headers, SECRET, now=NOW + 301)
        self.assertEqual(ctx.exception.code, "webhook_timestamp_expired")
        self.assertEqual(verify_webhook(body, headers, SECRET, now=NOW + 301, tolerance=None)["id"], EVENT["id"])

    def test_missing_or_malformed_header(self) -> None:
        body, _ = signed(EVENT)
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body, {}, SECRET, now=NOW)
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body, {"X-KreatorFlow-Signature": "garbage"}, SECRET, now=NOW)
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body, {"X-KreatorFlow-Signature": "t=abc,v1=00"}, SECRET, now=NOW)


if __name__ == "__main__":
    unittest.main()
