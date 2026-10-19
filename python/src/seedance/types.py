"""Typed wrappers around the JSON the KreatorFlow API returns."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .models import TERMINAL_STATUSES


class Job:
    """A video job, as returned by ``POST /v1/videos`` and ``GET /v1/jobs/{id}``.

    The common fields are attributes. Everything the API sent is on :attr:`raw`, and
    ``job["anyField"]`` reads from it too.
    """

    __slots__ = ("raw", "quoted_token_cost", "estimated_token_cost", "balance_tokens", "idempotent_replay")

    def __init__(
        self,
        raw: Dict[str, Any],
        *,
        quoted_token_cost: Optional[float] = None,
        estimated_token_cost: Optional[float] = None,
        balance_tokens: Optional[float] = None,
        idempotent_replay: bool = False,
    ) -> None:
        self.raw: Dict[str, Any] = dict(raw)
        #: Token cost quoted when the job was created (create response only).
        self.quoted_token_cost = quoted_token_cost
        #: Estimated token cost (create response only).
        self.estimated_token_cost = estimated_token_cost
        #: Your token balance right after the create call (create response only).
        self.balance_tokens = balance_tokens
        #: True when the API returned an existing job for the same Idempotency-Key.
        self.idempotent_replay = idempotent_replay

    @property
    def id(self) -> str:
        return str(self.raw.get("id", ""))

    @property
    def status(self) -> str:
        return str(self.raw.get("status", ""))

    @property
    def model_id(self) -> Optional[str]:
        return self.raw.get("modelId")

    @property
    def media_type(self) -> Optional[str]:
        return self.raw.get("mediaType")

    @property
    def prompt(self) -> Optional[str]:
        return self.raw.get("prompt")

    @property
    def resolution(self) -> Optional[str]:
        return self.raw.get("resolution")

    @property
    def output_url(self) -> Optional[str]:
        """The authenticated download link (``/v1/jobs/{id}/output``) once the job is completed."""
        return self.raw.get("providerOutputUrl")

    @property
    def output_expires_at(self) -> Optional[str]:
        return self.raw.get("providerOutputExpiresAt")

    @property
    def error_code(self) -> Optional[str]:
        return self.raw.get("errorCode")

    @property
    def error_message(self) -> Optional[str]:
        return self.raw.get("errorMessage")

    @property
    def warnings(self) -> List[Any]:
        return list(self.raw.get("warnings") or [])

    @property
    def created_at(self) -> Optional[str]:
        return self.raw.get("createdAt")

    @property
    def completed_at(self) -> Optional[str]:
        return self.raw.get("completedAt")

    @property
    def done(self) -> bool:
        """True once the job is in a final status (completed, failed, canceled or blocked)."""
        return self.status in TERMINAL_STATUSES

    @property
    def succeeded(self) -> bool:
        return self.status == "completed"

    def __getitem__(self, key: str) -> Any:
        return self.raw[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)

    def __repr__(self) -> str:
        return f"Job(id={self.id!r}, status={self.status!r}, model_id={self.model_id!r})"
