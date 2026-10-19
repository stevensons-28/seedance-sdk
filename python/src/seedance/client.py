"""The Seedance client for the KreatorFlow video API."""

from __future__ import annotations

import mimetypes
import os
import time
import uuid
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

import requests

from ._version import __version__
from .errors import (
    AuthenticationError,
    InsufficientBalanceError,
    JobFailedError,
    RateLimitError,
    SeedanceError,
    WaitTimeoutError,
)
from .models import DEFAULT_MODEL, resolve_model
from .types import Job

DEFAULT_BASE_URL = "https://kreatorflow.ai/v1"
API_KEY_ENV = "KREATORFLOW_API_KEY"
BASE_URL_ENV = "KREATORFLOW_BASE_URL"
KEYS_URL = "https://developers.kreatorflow.ai/?section=keys"

JobRef = Union[Job, str]
PathLike = Union[str, "os.PathLike[str]"]
MediaInput = Union[str, "os.PathLike[str]"]

# Patched in tests so nothing really sleeps.
_sleep = time.sleep
_monotonic = time.monotonic

_CHUNK = 1 << 20  # 1 MB


def _retry_after_seconds(value: Optional[str], default: float = 5.0) -> float:
    if not value:
        return default
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
    except (TypeError, ValueError):
        return default


def _job_id(job: JobRef) -> str:
    return job.id if isinstance(job, Job) else str(job)


def _media_kind(mime: str) -> str:
    if mime.startswith("video/"):
        return "VIDEO"
    if mime.startswith("audio/"):
        return "AUDIO"
    return "IMAGE"


class Seedance:
    """A small client for ByteDance's Seedance video models through the KreatorFlow API.

    >>> from seedance import Seedance
    >>> client = Seedance()  # reads KREATORFLOW_API_KEY
    >>> job = client.generate("A paper boat drifting down a rainy street at dusk", out="boat.mp4")

    :param api_key: your KreatorFlow API key. Defaults to the ``KREATORFLOW_API_KEY`` environment variable.
    :param base_url: API root, ``https://kreatorflow.ai/v1`` by default.
    :param timeout: seconds to wait for each HTTP request (downloads use ``download_timeout``).
    :param max_retries: how many times to wait out a 429 answer (using ``Retry-After``) before raising.
    :param session: an optional ``requests.Session`` to reuse connections or add proxies.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        download_timeout: float = 300.0,
        max_retries: int = 3,
        session: Optional[requests.Session] = None,
    ) -> None:
        key = api_key if api_key is not None else os.environ.get(API_KEY_ENV)
        if not key:
            raise AuthenticationError(
                f"No API key. Pass api_key=... or set {API_KEY_ENV}. Create a key at {KEYS_URL}",
                code="api_key_missing",
            )
        self.api_key = key
        self.base_url = (base_url or os.environ.get(BASE_URL_ENV) or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self.download_timeout = download_timeout
        self.max_retries = max(0, int(max_retries))
        self._session = session or requests.Session()

    # ------------------------------------------------------------------ HTTP

    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "User-Agent": f"seedance-python/{__version__}",
        }
        if extra:
            headers.update(extra)
        return headers

    def _send(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        attempt = 0
        while True:
            response = self._session.request(method, url, **kwargs)
            if response.status_code != 429 or attempt >= self.max_retries:
                return response
            wait = _retry_after_seconds(response.headers.get("Retry-After"))
            response.close()
            attempt += 1
            _sleep(wait)

    @staticmethod
    def _error(response: requests.Response) -> SeedanceError:
        try:
            body = response.json()
        except ValueError:
            body = None
        if isinstance(body, dict):
            code = body.get("code") or "http_error"
            message = body.get("error") or body.get("message") or response.reason or "Request failed."
            data = body.get("data") if isinstance(body.get("data"), dict) else {}
        else:
            code, message, data = "http_error", f"HTTP {response.status_code} {response.reason or ''}".strip(), {}
        headers = dict(response.headers)
        kwargs: Dict[str, Any] = {"status": response.status_code, "code": code, "data": data, "headers": headers}
        if response.status_code == 429:
            return RateLimitError(message, retry_after=_retry_after_seconds(response.headers.get("Retry-After")), **kwargs)
        if response.status_code == 402 or code == "insufficient_balance":
            return InsufficientBalanceError(message, **kwargs)
        if code in ("invalid_api_key", "scope_missing", "account_not_active") or response.status_code == 401:
            return AuthenticationError(message, **kwargs)
        return SeedanceError(message, **kwargs)

    def _json(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        kwargs.setdefault("timeout", self.timeout)
        response = self._send(method, path, **kwargs)
        try:
            body = response.json()
        except ValueError:
            body = None
        if response.status_code >= 400 or not isinstance(body, dict) or not body.get("success"):
            raise self._error(response)
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    # ---------------------------------------------------------------- models

    def list_models(self) -> List[Dict[str, Any]]:
        """``GET /v1/models``: every model id your key can use, with its durations, ratios and resolutions."""
        data = self._json("GET", "/models", headers=self._headers())
        return list(data.get("models") or [])

    # --------------------------------------------------------------- uploads

    def upload(self, path: PathLike, *, mime_type: Optional[str] = None) -> str:
        """Upload a local image, video or audio file and return its upload id.

        Runs the three steps of the upload flow: ``POST /v1/uploads``, a ``PUT`` of the bytes to
        the returned ``direct_upload_url``, then ``POST /v1/uploads/complete``. Needs the
        ``uploads:create`` scope.
        """
        file_path = Path(path)
        mime = mime_type or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        size = file_path.stat().st_size
        created = self._json(
            "POST",
            "/uploads",
            headers=self._headers(),
            json={"file_name": file_path.name, "mime_type": mime, "file_size": size, "upload_type": _media_kind(mime)},
        )
        upload_id = created.get("upload_id") or created.get("uploadId")
        target = created.get("direct_upload_url")
        if not upload_id or not target:
            raise SeedanceError("The upload answer had no upload id or upload URL.", code="upload_invalid_response")
        # The direct URL is pre-signed: send exactly the headers it came with, and no API key.
        put_headers = dict(created.get("direct_upload_headers") or {"Content-Type": mime})
        with open(file_path, "rb") as handle:
            put = self._session.request("PUT", target, data=handle, headers=put_headers, timeout=self.download_timeout)
        if put.status_code >= 400:
            raise SeedanceError(f"Uploading the file failed with HTTP {put.status_code}.", status=put.status_code, code="upload_put_failed")
        done = self._json("POST", "/uploads/complete", headers=self._headers(), json={"upload_id": upload_id})
        return str(done.get("upload_id") or upload_id)

    def _media(self, value: Optional[MediaInput]) -> Tuple[Optional[str], Optional[str]]:
        """Return ``(url, upload_id)`` for a URL, an upload id, or a local file (uploaded first)."""
        if value is None:
            return None, None
        text = os.fspath(value)
        if text.startswith(("https://", "http://")):
            return text, None
        if text.startswith("tos:"):
            return None, text
        if os.path.isfile(text):
            return None, self.upload(text)
        if mimetypes.guess_type(text)[0]:
            raise FileNotFoundError(f"No such file: {text}")
        return None, text

    def _media_list(self, values: Optional[Iterable[MediaInput]]) -> Tuple[List[str], List[str]]:
        urls: List[str] = []
        ids: List[str] = []
        for value in values or []:
            url, upload_id = self._media(value)
            if url:
                urls.append(url)
            if upload_id:
                ids.append(upload_id)
        return urls, ids

    # ---------------------------------------------------------------- videos

    def create_video(
        self,
        prompt: str,
        *,
        model: str = DEFAULT_MODEL,
        duration: int = 5,
        resolution: Optional[str] = "720p",
        aspect_ratio: Optional[str] = None,
        generate_audio: Optional[bool] = None,
        seed: Optional[int] = None,
        camera_fixed: Optional[bool] = None,
        first_frame: Optional[MediaInput] = None,
        last_frame: Optional[MediaInput] = None,
        reference_images: Optional[Sequence[MediaInput]] = None,
        reference_videos: Optional[Sequence[MediaInput]] = None,
        reference_audios: Optional[Sequence[MediaInput]] = None,
        webhook_url: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> Job:
        """``POST /v1/videos``: start a Seedance video job and return it right away (HTTP 202).

        :param prompt: what should happen in the clip.
        :param model: ``"seedance-2.0"`` (default), ``"seedance-2.5"``, ``"seedance-2.0-fast"``,
            ``"seedance-2.0-mini"``, or any KreatorFlow model id such as ``"kreator-video-pro"``.
        :param duration: length in seconds. Each model accepts a fixed list (see :meth:`list_models`).
        :param resolution: ``"480p"``, ``"720p"``, ``"1080p"`` or ``"4k"`` where the model offers it.
        :param aspect_ratio: for example ``"16:9"``, ``"9:16"``, ``"1:1"`` or ``"adaptive"``.
            Leave it out to use the model's default.
        :param first_frame: image for the first frame: an https URL, an upload id, or a local file path
            (uploaded for you). ``last_frame`` works the same way.
        :param reference_images: images that guide the look (URLs, upload ids or local paths). Frames
            and reference images cannot be mixed in one job.
        :param webhook_url: https URL that receives a signed POST when the job finishes.
        :param idempotency_key: sent as the ``Idempotency-Key`` header. A new UUID is used when you
            leave it out. Reuse the same key when you resend the same request and the API returns
            the job it already created instead of starting a second one.
        :param extra: any other request fields, sent as is.
        """
        body: Dict[str, Any] = {"model": resolve_model(model), "prompt": prompt, "duration": duration}
        if resolution is not None:
            body["resolution"] = resolution
        if aspect_ratio is not None:
            body["aspect_ratio"] = aspect_ratio
        if generate_audio is not None:
            body["generate_audio"] = generate_audio
        if seed is not None:
            body["seed"] = seed
        if camera_fixed is not None:
            body["camera_fixed"] = camera_fixed
        if webhook_url:
            body["webhook_url"] = webhook_url

        for role, value in (("first_frame", first_frame), ("last_frame", last_frame)):
            url, upload_id = self._media(value)
            if url:
                body[f"{role}_url"] = url
            if upload_id:
                body[f"{role}_upload_id"] = upload_id
        for kind, values in (("image", reference_images), ("video", reference_videos), ("audio", reference_audios)):
            urls, ids = self._media_list(values)
            if urls:
                body[f"reference_{kind}_urls"] = urls
            if ids:
                body[f"reference_{kind}_upload_ids"] = ids
        if extra:
            body.update(extra)

        key = idempotency_key or str(uuid.uuid4())
        data = self._json(
            "POST",
            "/videos",
            headers=self._headers({"Content-Type": "application/json", "Idempotency-Key": key}),
            json=body,
        )
        return Job(
            data.get("job") or {},
            quoted_token_cost=data.get("quoted_token_cost"),
            estimated_token_cost=data.get("estimated_token_cost"),
            balance_tokens=data.get("balance_tokens"),
            idempotent_replay=bool(data.get("idempotent_replay")),
        )

    def get_job(self, job: JobRef) -> Job:
        """``GET /v1/jobs/{id}``: the job's current status. Needs the ``jobs:read`` scope."""
        data = self._json("GET", f"/jobs/{_job_id(job)}", headers=self._headers())
        return Job(data.get("job") or {})

    def wait(
        self,
        job: JobRef,
        *,
        timeout: float = 1800.0,
        poll_interval: float = 10.0,
        on_update: Optional[Callable[[Job], None]] = None,
    ) -> Job:
        """Poll a job until it reaches a final status and return it.

        Polls every ``poll_interval`` seconds and waits out 429 answers using ``Retry-After``.
        Raises :class:`~seedance.errors.WaitTimeoutError` after ``timeout`` seconds (the job keeps
        running and you can wait again). Does not raise when the job fails: check ``job.succeeded``.
        """
        current = job if isinstance(job, Job) and job.status else self.get_job(job)
        deadline = _monotonic() + timeout
        while not current.done:
            if _monotonic() >= deadline:
                raise WaitTimeoutError(current, timeout)
            _sleep(poll_interval)
            current = self.get_job(current.id)
            if on_update:
                on_update(current)
        return current

    def download(self, job: JobRef, path: Optional[PathLike] = None) -> Path:
        """``GET /v1/jobs/{id}/output``: stream the finished file to ``path`` and return the path.

        ``path`` defaults to ``<job id>.mp4`` in the current folder. When it is a folder, the file is
        saved there as ``<job id>.mp4``.
        """
        job_id = _job_id(job)
        target = Path(path) if path is not None else Path(f"{job_id}.mp4")
        if target.is_dir():
            target = target / f"{job_id}.mp4"
        response = self._send(
            "GET",
            f"/jobs/{job_id}/output",
            headers=self._headers({"Accept": "*/*"}),
            stream=True,
            timeout=self.download_timeout,
        )
        try:
            if response.status_code >= 400:
                raise self._error(response)
            partial = target.with_name(target.name + ".part")
            with open(partial, "wb") as out:
                for chunk in response.iter_content(chunk_size=_CHUNK):
                    if chunk:
                        out.write(chunk)
            os.replace(partial, target)
        finally:
            response.close()
        return target

    def generate(
        self,
        prompt: str,
        *,
        out: Optional[PathLike] = None,
        timeout: float = 1800.0,
        poll_interval: float = 10.0,
        on_update: Optional[Callable[[Job], None]] = None,
        **options: Any,
    ) -> Job:
        """Create a video, wait for it, and (with ``out=``) save it. Returns the completed job.

        Takes every option of :meth:`create_video`. Raises :class:`~seedance.errors.JobFailedError`
        when the job ends as failed, canceled or blocked.
        """
        job = self.create_video(prompt, **options)
        if on_update:
            on_update(job)
        job = self.wait(job, timeout=timeout, poll_interval=poll_interval, on_update=on_update)
        if not job.succeeded:
            raise JobFailedError(job)
        if out is not None:
            self.download(job, out)
        return job

    # ----------------------------------------------------------------- misc

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "Seedance":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
