"""Seedance Python SDK: an unofficial client for ByteDance's Seedance video models through the KreatorFlow API.

Docs: https://kreatorflow.ai/seedance-api/reference
"""

from ._version import __version__
from .client import DEFAULT_BASE_URL, Seedance
from .errors import (
    AuthenticationError,
    InsufficientBalanceError,
    JobFailedError,
    RateLimitError,
    SeedanceError,
    WaitTimeoutError,
    WebhookVerificationError,
)
from .models import JOB_STATUSES, MODEL_ALIASES, TERMINAL_STATUSES, resolve_model
from .types import Job
from .webhooks import compute_signature, verify_webhook

__all__ = [
    "__version__",
    "DEFAULT_BASE_URL",
    "Seedance",
    "Job",
    "SeedanceError",
    "AuthenticationError",
    "InsufficientBalanceError",
    "RateLimitError",
    "JobFailedError",
    "WaitTimeoutError",
    "WebhookVerificationError",
    "MODEL_ALIASES",
    "JOB_STATUSES",
    "TERMINAL_STATUSES",
    "resolve_model",
    "verify_webhook",
    "compute_signature",
]
