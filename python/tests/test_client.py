"""Client tests with a fake HTTP session: no network is used."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest import mock

import seedance
from seedance import (
    AuthenticationError,
    InsufficientBalanceError,
    JobFailedError,
    RateLimitError,
    Seedance,
    SeedanceError,
    WaitTimeoutError,
)
from seedance import client as client_module
from seedance.cli import main as cli_main

JOB_ID = "3f1c0a9e-1b2c-4d3e-8f40-123456789abc"


class FakeResponse:
    def __init__(self, status: int = 200, body: Any = None, headers: Optional[Dict[str, str]] = None, content: bytes = b"") -> None:
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.content = content
        self.reason = "OK" if status < 400 else "Error"
        self.closed = False

    def json(self) -> Any:
        if self._body is None:
            raise ValueError("no json")
        return self._body

    def iter_content(self, chunk_size: int = 1):
        stream = io.BytesIO(self.content)
        while True:
            chunk = stream.read(chunk_size)
            if not chunk:
                return
            yield chunk

    def close(self) -> None:
        self.closed = True


class FakeSession:
    def __init__(self, responses: List[FakeResponse]) -> None:
        self.responses = list(responses)
        self.calls: List[Dict[str, Any]] = []

    def request(self, method: str, url: str, **kwargs: Any) -> FakeResponse:
        data = kwargs.get("data")
        if hasattr(data, "read"):
            kwargs["data"] = data.read()
        self.calls.append({"method": method, "url": url, **kwargs})
        if not self.responses:
            raise AssertionError(f"unexpected request {method} {url}")
        return self.responses.pop(0)

    def close(self) -> None:
        pass


def job(status: str = "queued", **extra: Any) -> Dict[str, Any]:
    return {"id": JOB_ID, "mediaType": "video", "modelId": "kreator-video-seedance-2", "status": status, **extra}


def ok(data: Dict[str, Any], status: int = 200, headers: Optional[Dict[str, str]] = None) -> FakeResponse:
    return FakeResponse(status, {"success": True, "data": data}, headers)


def err(status: int, code: str, message: str = "nope", headers: Optional[Dict[str, str]] = None, data: Optional[Dict[str, Any]] = None) -> FakeResponse:
    return FakeResponse(status, {"success": False, "code": code, "error": message, "data": data or {}}, headers)


def created(status: str = "queued") -> FakeResponse:
    return ok({"job": job(status), "balance_tokens": 389, "quoted_token_cost": 11, "estimated_token_cost": 11}, 202)


class NoSleep(unittest.TestCase):
    def setUp(self) -> None:
        self.sleeps: List[float] = []
        self.clock = [0.0]

        def fake_sleep(seconds: float) -> None:
            self.sleeps.append(seconds)
            self.clock[0] += seconds

        for patch in (
            mock.patch.object(client_module, "_sleep", fake_sleep),
            mock.patch.object(client_module, "_monotonic", lambda: self.clock[0]),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def make(self, responses: List[FakeResponse], **kwargs: Any):
        session = FakeSession(responses)
        return Seedance(api_key="kf_test", session=session, **kwargs), session


class ConstructorTests(unittest.TestCase):
    def test_reads_env_key(self) -> None:
        with mock.patch.dict(os.environ, {"KREATORFLOW_API_KEY": "kf_env"}):
            self.assertEqual(Seedance().api_key, "kf_env")

    def test_missing_key_raises(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(AuthenticationError) as ctx:
                Seedance()
        self.assertEqual(ctx.exception.code, "api_key_missing")

    def test_model_aliases(self) -> None:
        self.assertEqual(seedance.resolve_model("seedance-2.0"), "kreator-video-seedance-2")
        self.assertEqual(seedance.resolve_model("Seedance-2.5"), "kreator-video-seedance-2-5")
        self.assertEqual(seedance.resolve_model("seedance-2.0-fast"), "kreator-video-seedance-2-fast")
        self.assertEqual(seedance.resolve_model("seedance-2.0-mini"), "kreator-video-seedance-2-mini")
        self.assertEqual(seedance.resolve_model("kreator-video-pro"), "kreator-video-pro")


class CreateTests(NoSleep):
    def test_create_video_request(self) -> None:
        client, session = self.make([created()])
        result = client.create_video("a paper boat", model="seedance-2.5", aspect_ratio="9:16", seed=7, webhook_url="https://example.com/hook")
        call = session.calls[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(call["url"], "https://kreatorflow.ai/v1/videos")
        self.assertEqual(call["headers"]["Authorization"], "Bearer kf_test")
        self.assertTrue(call["headers"]["Idempotency-Key"])
        self.assertEqual(
            call["json"],
            {
                "model": "kreator-video-seedance-2-5",
                "prompt": "a paper boat",
                "duration": 5,
                "resolution": "720p",
                "aspect_ratio": "9:16",
                "seed": 7,
                "webhook_url": "https://example.com/hook",
            },
        )
        self.assertEqual(result.id, JOB_ID)
        self.assertEqual(result.status, "queued")
        self.assertEqual(result.quoted_token_cost, 11)
        self.assertEqual(result.balance_tokens, 389)
        self.assertFalse(result.idempotent_replay)

    def test_idempotency_key_is_sent_and_replay_flag_read(self) -> None:
        client, session = self.make([ok({"job": job(), "quoted_token_cost": 11, "idempotent_replay": True})])
        result = client.create_video("x", idempotency_key="order-42")
        self.assertEqual(session.calls[0]["headers"]["Idempotency-Key"], "order-42")
        self.assertTrue(result.idempotent_replay)

    def test_image_urls_and_upload_ids(self) -> None:
        client, session = self.make([created()])
        client.create_video(
            "x",
            first_frame="https://example.com/a.png",
            last_frame="tos:kreatorflow/uploads/w/1-a.png",
            reference_videos=["https://example.com/v.mp4"],
        )
        body = session.calls[0]["json"]
        self.assertEqual(body["first_frame_url"], "https://example.com/a.png")
        self.assertEqual(body["last_frame_upload_id"], "tos:kreatorflow/uploads/w/1-a.png")
        self.assertEqual(body["reference_video_urls"], ["https://example.com/v.mp4"])

    def test_reference_images(self) -> None:
        client, session = self.make([created()])
        client.create_video("x", reference_images=["https://example.com/1.png", "https://example.com/2.png"])
        self.assertEqual(session.calls[0]["json"]["reference_image_urls"], ["https://example.com/1.png", "https://example.com/2.png"])

    def test_missing_local_image_raises(self) -> None:
        client, session = self.make([])
        with self.assertRaises(FileNotFoundError):
            client.create_video("x", first_frame="does-not-exist.png")
        self.assertEqual(session.calls, [])

    def test_local_image_is_uploaded_first(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            image = Path(folder) / "photo.png"
            image.write_bytes(b"\x89PNG fake")
            client, session = self.make(
                [
                    ok({"upload_id": "tos:k/u/1.png", "direct_upload_url": "https://storage.example/put", "direct_upload_headers": {"Content-Type": "image/png"}}),
                    FakeResponse(200),
                    ok({"upload_id": "tos:k/u/1.png", "status": "ready"}),
                    created(),
                ]
            )
            client.create_video("x", first_frame=str(image))
        upload, put, complete, create = session.calls
        self.assertEqual(upload["url"], "https://kreatorflow.ai/v1/uploads")
        self.assertEqual(upload["json"], {"file_name": "photo.png", "mime_type": "image/png", "file_size": 9, "upload_type": "IMAGE"})
        self.assertEqual(put["method"], "PUT")
        self.assertEqual(put["url"], "https://storage.example/put")
        self.assertEqual(put["headers"], {"Content-Type": "image/png"})
        self.assertEqual(put["data"], b"\x89PNG fake")
        self.assertEqual(complete["url"], "https://kreatorflow.ai/v1/uploads/complete")
        self.assertEqual(complete["json"], {"upload_id": "tos:k/u/1.png"})
        self.assertEqual(create["json"]["first_frame_upload_id"], "tos:k/u/1.png")


class ErrorTests(NoSleep):
    def test_error_shape(self) -> None:
        client, _ = self.make([err(400, "duration_not_supported", "Duration must be one of: 4, 5 seconds.", data={"x": 1})])
        with self.assertRaises(SeedanceError) as ctx:
            client.create_video("x", duration=3)
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(ctx.exception.code, "duration_not_supported")
        self.assertEqual(ctx.exception.message, "Duration must be one of: 4, 5 seconds.")
        self.assertEqual(ctx.exception.data, {"x": 1})

    def test_typed_errors(self) -> None:
        client, _ = self.make([err(402, "insufficient_balance"), err(401, "invalid_api_key"), err(403, "scope_missing")])
        with self.assertRaises(InsufficientBalanceError):
            client.create_video("x")
        with self.assertRaises(AuthenticationError):
            client.get_job(JOB_ID)
        with self.assertRaises(AuthenticationError):
            client.get_job(JOB_ID)

    def test_non_json_error(self) -> None:
        client, _ = self.make([FakeResponse(502, None)])
        with self.assertRaises(SeedanceError) as ctx:
            client.get_job(JOB_ID)
        self.assertEqual(ctx.exception.code, "http_error")
        self.assertEqual(ctx.exception.status, 502)

    def test_429_waits_retry_after_then_succeeds(self) -> None:
        client, session = self.make([err(429, "rate_limited", headers={"Retry-After": "7"}), ok({"job": job("processing")})])
        result = client.get_job(JOB_ID)
        self.assertEqual(result.status, "processing")
        self.assertEqual(self.sleeps, [7.0])
        self.assertEqual(len(session.calls), 2)

    def test_429_gives_up_after_max_retries(self) -> None:
        limited = [err(429, "rate_limited", headers={"Retry-After": "2"}) for _ in range(3)]
        client, _ = self.make(limited, max_retries=2)
        with self.assertRaises(RateLimitError) as ctx:
            client.get_job(JOB_ID)
        self.assertEqual(ctx.exception.retry_after, 2.0)
        self.assertEqual(self.sleeps, [2.0, 2.0])


class WaitTests(NoSleep):
    def test_wait_polls_until_final(self) -> None:
        output = f"https://kreatorflow.ai/v1/jobs/{JOB_ID}/output"
        client, session = self.make([ok({"job": job("processing")}), ok({"job": job("completed", providerOutputUrl=output)})])
        seen: List[str] = []
        done = client.wait(seedance.Job(job("queued")), poll_interval=3, on_update=lambda j: seen.append(j.status))
        self.assertTrue(done.succeeded)
        self.assertEqual(done.output_url, output)
        self.assertEqual(seen, ["processing", "completed"])
        self.assertEqual(self.sleeps, [3, 3])
        self.assertEqual(session.calls[0]["url"], f"https://kreatorflow.ai/v1/jobs/{JOB_ID}")

    def test_wait_accepts_an_id(self) -> None:
        client, _ = self.make([ok({"job": job("failed", errorCode="generation_failed", errorMessage="Try a different prompt.")})])
        done = client.wait(JOB_ID)
        self.assertEqual(done.status, "failed")
        self.assertEqual(done.error_code, "generation_failed")

    def test_wait_timeout(self) -> None:
        client, _ = self.make([ok({"job": job("processing")}) for _ in range(5)])
        with self.assertRaises(WaitTimeoutError) as ctx:
            client.wait(seedance.Job(job("queued")), timeout=25, poll_interval=10)
        self.assertEqual(ctx.exception.job.status, "processing")
        self.assertIsInstance(ctx.exception, TimeoutError)

    def test_generate_raises_on_failed_job(self) -> None:
        client, _ = self.make([created(), ok({"job": job("blocked", errorCode="generation_rejected", errorMessage="Change the prompt.")})])
        with self.assertRaises(JobFailedError) as ctx:
            client.generate("x")
        self.assertEqual(ctx.exception.code, "generation_rejected")
        self.assertEqual(ctx.exception.job.status, "blocked")


class DownloadTests(NoSleep):
    def test_download_streams_to_file(self) -> None:
        payload = os.urandom(3 * 1024 * 1024 + 17)
        client, session = self.make([FakeResponse(200, None, {"Content-Type": "video/mp4"}, payload)])
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "clip.mp4"
            path = client.download(JOB_ID, target)
            self.assertEqual(path, target)
            self.assertEqual(target.read_bytes(), payload)
            self.assertFalse((Path(folder) / "clip.mp4.part").exists())
        call = session.calls[0]
        self.assertEqual(call["url"], f"https://kreatorflow.ai/v1/jobs/{JOB_ID}/output")
        self.assertTrue(call["stream"])
        self.assertEqual(call["headers"]["Authorization"], "Bearer kf_test")

    def test_download_into_folder(self) -> None:
        client, _ = self.make([FakeResponse(200, None, {}, b"mp4")])
        with tempfile.TemporaryDirectory() as folder:
            path = client.download(seedance.Job(job("completed")), folder)
            self.assertEqual(path.name, f"{JOB_ID}.mp4")

    def test_download_not_ready(self) -> None:
        client, _ = self.make([err(409, "output_not_ready", "Output is not available for this KreatorFlow job.")])
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(SeedanceError) as ctx:
                client.download(JOB_ID, Path(folder) / "x.mp4")
        self.assertEqual(ctx.exception.code, "output_not_ready")

    def test_generate_with_out(self) -> None:
        client, session = self.make([created(), ok({"job": job("completed")}), FakeResponse(200, None, {}, b"video-bytes")])
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "out.mp4"
            done = client.generate("x", out=target, model="seedance-2.0-fast", poll_interval=1)
            self.assertTrue(done.succeeded)
            self.assertEqual(target.read_bytes(), b"video-bytes")
        self.assertEqual(session.calls[0]["json"]["model"], "kreator-video-seedance-2-fast")


class ModelsTests(NoSleep):
    def test_list_models(self) -> None:
        client, session = self.make([ok({"object": "list", "models": [{"id": "kreator-video-seedance-2"}]})])
        self.assertEqual(client.list_models(), [{"id": "kreator-video-seedance-2"}])
        self.assertEqual(session.calls[0]["url"], "https://kreatorflow.ai/v1/models")


class CliTests(NoSleep):
    def test_cli_end_to_end(self) -> None:
        session = FakeSession([created(), ok({"job": job("completed")}), FakeResponse(200, None, {}, b"mp4")])
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {"KREATORFLOW_API_KEY": "kf_env"}), mock.patch.object(
            client_module.requests, "Session", lambda: session
        ), mock.patch("sys.stdout", new_callable=io.StringIO) as out, mock.patch("sys.stderr", new_callable=io.StringIO):
            target = Path(folder) / "clip.mp4"
            code = cli_main(["a paper boat", "--model", "seedance-2.0-mini", "--out", str(target), "--aspect-ratio", "9:16"])
            self.assertEqual(code, 0)
            self.assertEqual(target.read_bytes(), b"mp4")
            self.assertIn("clip.mp4", out.getvalue())
        body = session.calls[0]["json"]
        self.assertEqual(body["model"], "kreator-video-seedance-2-mini")
        self.assertEqual(body["aspect_ratio"], "9:16")

    def test_cli_reports_api_error(self) -> None:
        session = FakeSession([err(402, "insufficient_balance", "Add developer tokens before submitting generation jobs.")])
        with mock.patch.dict(os.environ, {"KREATORFLOW_API_KEY": "kf_env"}), mock.patch.object(
            client_module.requests, "Session", lambda: session
        ), mock.patch("sys.stderr", new_callable=io.StringIO) as errors:
            code = cli_main(["x"])
        self.assertEqual(code, 1)
        self.assertIn("insufficient_balance", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
