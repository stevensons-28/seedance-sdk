"""Verify the signed webhooks KreatorFlow sends when a job finishes.

Each webhook is a POST with a JSON body and these headers:

* ``X-KreatorFlow-Event-Id``, ``X-KreatorFlow-Event-Type``, ``X-KreatorFlow-Job-Id``
* ``X-KreatorFlow-Timestamp``: Unix time in seconds
* ``X-KreatorFlow-Signature``: ``t=<unix time>,v1=<hex>``, where ``<hex>`` is
  HMAC-SHA256 of ``"<t>.<raw body>"`` keyed with your webhook signing secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Mapping, Optional, Union

from .errors import WebhookVerificationError

SIGNATURE_HEADER = "X-KreatorFlow-Signature"
DEFAULT_TOLERANCE_SECONDS = 300


def _header(headers: Mapping[str, Any], name: str) -> Optional[str]:
    wanted = name.lower()
    for key, value in headers.items():
        if str(key).lower() == wanted:
            if isinstance(value, (list, tuple)):
                value = value[0] if value else None
            return None if value is None else str(value)
    return None


def _parse_signature(header: str) -> Dict[str, str]:
    parts: Dict[str, str] = {}
    for piece in header.split(","):
        if "=" in piece:
            key, value = piece.split("=", 1)
            parts.setdefault(key.strip(), value.strip())
    return parts


def compute_signature(payload: Union[bytes, str], timestamp: Union[int, str], secret: str) -> str:
    """Return the hex ``v1`` signature for a raw body and timestamp."""
    body = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    message = str(timestamp).encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_webhook(
    payload: Union[bytes, str],
    headers: Mapping[str, Any],
    secret: str,
    *,
    tolerance: Optional[float] = DEFAULT_TOLERANCE_SECONDS,
    now: Optional[float] = None,
) -> Dict[str, Any]:
    """Check a webhook's signature and age, then return the parsed event.

    ``payload`` must be the raw request body exactly as received (bytes or str), before any
    JSON parsing. ``headers`` is any mapping of request headers; names are matched without regard
    to case. ``tolerance`` is the largest accepted gap, in seconds, between the signed timestamp
    and now (``None`` turns the check off).

    Raises :class:`~seedance.errors.WebhookVerificationError` when the check fails.
    The returned event has ``id``, ``type`` (``job.completed``, ``job.failed``,
    ``job.canceled`` or ``job.blocked``), ``created`` and ``data["job"]``.
    """
    if not secret:
        raise WebhookVerificationError("A webhook signing secret is required.", code="webhook_secret_missing")

    header = _header(headers, SIGNATURE_HEADER)
    if not header:
        raise WebhookVerificationError(f"Missing {SIGNATURE_HEADER} header.", code="webhook_signature_missing")

    parts = _parse_signature(header)
    timestamp, signature = parts.get("t"), parts.get("v1")
    if not timestamp or not signature:
        raise WebhookVerificationError(f"Malformed {SIGNATURE_HEADER} header.", code="webhook_signature_malformed")

    try:
        signed_at = int(timestamp)
    except ValueError:
        raise WebhookVerificationError("Webhook timestamp is not a number.", code="webhook_signature_malformed") from None

    expected = compute_signature(payload, timestamp, secret)
    if not hmac.compare_digest(expected, signature):
        raise WebhookVerificationError("Webhook signature does not match.", code="webhook_signature_invalid")

    if tolerance is not None:
        current = time.time() if now is None else now
        if abs(current - signed_at) > tolerance:
            raise WebhookVerificationError("Webhook timestamp is too old or in the future.", code="webhook_timestamp_expired")

    try:
        event = json.loads(payload)
    except ValueError:
        raise WebhookVerificationError("Webhook body is not valid JSON.", code="webhook_body_invalid") from None
    if not isinstance(event, dict):
        raise WebhookVerificationError("Webhook body is not a JSON object.", code="webhook_body_invalid")
    return event
