"""Errors raised by the Seedance client."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:  # pragma: no cover
    from .types import Job


class SeedanceError(Exception):
    """An error answer from the KreatorFlow API.

    Every API error is JSON with ``success: false``, a machine-readable ``code`` and a readable
    ``error`` message. Branch on :attr:`code`, never on the message text.
    """

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(f"{status} {code}: {message}" if status else message)
        self.message = message
        self.status = status
        self.code = code
        self.data: Dict[str, Any] = data or {}
        self.headers: Dict[str, str] = headers or {}


class AuthenticationError(SeedanceError):
    """The API key is missing, invalid, or lacks a scope (``invalid_api_key``, ``scope_missing``)."""


class InsufficientBalanceError(SeedanceError):
    """The account has too few tokens for this job (``insufficient_balance``, HTTP 402)."""


class RateLimitError(SeedanceError):
    """Too many requests (HTTP 429). :attr:`retry_after` is the wait the API asked for, in seconds."""

    def __init__(self, message: str, *, retry_after: Optional[float] = None, **kwargs: Any) -> None:
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class JobFailedError(SeedanceError):
    """A job ended as ``failed``, ``canceled`` or ``blocked``. The job is on :attr:`job`."""

    def __init__(self, job: "Job") -> None:
        super().__init__(
            job.error_message or f"Job {job.id} ended with status {job.status}.",
            code=job.error_code or job.status,
        )
        self.job = job


class WaitTimeoutError(SeedanceError, TimeoutError):
    """:meth:`Seedance.wait` gave up before the job reached a final status. The job keeps running."""

    def __init__(self, job: "Job", timeout: float) -> None:
        super().__init__(f"Job {job.id} is still {job.status} after {timeout:g} seconds.", code="wait_timeout")
        self.job = job


class WebhookVerificationError(SeedanceError):
    """A webhook failed signature or timestamp checks. Answer it with HTTP 401 or 400."""
