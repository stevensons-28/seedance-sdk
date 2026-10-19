# Seedance Python SDK

[![PyPI](https://img.shields.io/pypi/v/seedance.svg)](https://pypi.org/project/seedance/)
[![Python](https://img.shields.io/pypi/pyversions/seedance.svg)](https://pypi.org/project/seedance/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`seedance` is an unofficial Python client for ByteDance's Seedance video models (Seedance 2.5, Seedance 2.0, Seedance 2.0 Fast and Seedance 2.0 Mini) through the [KreatorFlow Seedance API](https://kreatorflow.ai/seedance-api). Seedance is a ByteDance model; KreatorFlow is an official partner of BytePlus, a ByteDance company.

Create a video from a prompt or an image, wait for it, and save the MP4 in three lines of Python:

```python
from seedance import Seedance

client = Seedance()  # reads KREATORFLOW_API_KEY
client.generate("A paper boat drifting down a rainy street at dusk, low angle", out="boat.mp4")
```

- Python 3.9+, one dependency (`requests`), fully typed (`py.typed`)
- Text to video, image to video (first and last frame), reference images, clips and audio
- Polling that waits out `429` answers using `Retry-After`
- Streaming download, so a large MP4 never sits in memory
- `Idempotency-Key` on every create call, so a resent request never starts a second job
- Webhook signature checks that match the KreatorFlow server exactly
- A `seedance` command for the terminal

## Contents

- [Install](#install)
- [Get an API key](#get-an-api-key)
- [Quickstart](#quickstart)
- [Seedance models and prices](#seedance-models-and-prices)
- [Image to video](#image-to-video)
- [Waiting and polling](#waiting-and-polling)
- [Downloading the video](#downloading-the-video)
- [Webhooks](#webhooks)
- [Errors](#errors)
- [Command line](#command-line)
- [API reference](#api-reference)
- [FAQ](#faq)

## Install

```bash
pip install seedance
```

## Get an API key

1. Sign in to the KreatorFlow developer console and [create an API key](https://developers.kreatorflow.ai/?section=keys) with the `videos:create` and `jobs:read` scopes (add `uploads:create` to send local images).
2. Top up your token balance. There is no subscription: you pay per second of video from prepaid tokens.
3. Put the key in an environment variable on the machine that runs your code:

```bash
export KREATORFLOW_API_KEY=your_api_key
```

Keep the key on your server. Never commit it and never send it to a browser or a mobile app. The step by step guide is [How to get a Seedance API key](https://kreatorflow.ai/guides/how-to-get-a-seedance-api-key).

## Quickstart

```python
from seedance import Seedance, SeedanceError

client = Seedance()

try:
    job = client.create_video(
        "A red fox trotting through fresh snow at sunrise, side tracking shot",
        model="seedance-2.0",   # or "seedance-2.5", "seedance-2.0-fast", "seedance-2.0-mini"
        duration=5,             # seconds
        resolution="720p",      # "480p", "720p", "1080p" or "4k" where the model offers it
        aspect_ratio="16:9",    # "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"
    )
    print(job.id, job.status, f"quoted {job.quoted_token_cost} tokens")

    job = client.wait(job)          # polls until completed, failed, canceled or blocked
    if job.succeeded:
        client.download(job, "fox.mp4")
    else:
        print(job.status, job.error_code, job.error_message)
except SeedanceError as err:
    print(err.status, err.code, err.message)
```

`generate()` does all of that in one call and raises `JobFailedError` if the job does not complete:

```python
job = client.generate("Steam rising from a bowl of ramen, slow push in", model="seedance-2.0-fast", out="ramen.mp4")
```

The full walkthrough, with the same calls written by hand in `requests` and in Node.js, is the [Seedance API in Python and Node.js tutorial](https://kreatorflow.ai/guides/seedance-api-python-node).

## Seedance models and prices

Pass a friendly name or the KreatorFlow model id as `model=`. Any other id from `client.list_models()` works too.

| Model | `model=` | API model id | Lengths (seconds) | Top resolution | 5 s clip at 720p | 5 s clip at 1080p |
| --- | --- | --- | --- | --- | --- | --- |
| Seedance 2.5 | `seedance-2.5` | `kreator-video-seedance-2-5` | 4 to 15, 20, 25, 30 | 4K | $1.05 | $2.25 |
| Seedance 2.0 | `seedance-2.0` (default) | `kreator-video-seedance-2` (also `kreator-video-pro`) | 4, 5, 6, 8, 10, 12, 15 | 4K | $0.55 | $1.20 |
| Seedance 2.0 Fast | `seedance-2.0-fast` | `kreator-video-seedance-2-fast` (also `kreator-video-fast`) | 4, 5, 6, 8, 10 | 1080p | $0.45 | $0.95 |
| Seedance 2.0 Mini | `seedance-2.0-mini` | `kreator-video-seedance-2-mini` (also `kreator-video-mini`) | 4, 5, 6, 8, 10 | 1080p | $0.35 | $0.70 |

Prices are as of 19 October 2026, for one 5-second clip with text or image input, read from the KreatorFlow rate card. One token is $0.05 and top-ups start at $20. Every create call returns the exact quote for your request in `job.quoted_token_cost`. See [Seedance pricing](https://kreatorflow.ai/seedance-pricing) for current prices and the [Seedance API calculator](https://kreatorflow.ai/seedance-calculator) to price any clip.

KreatorFlow is the cheapest Seedance API at 720p and above (Seedance 2.0 and 2.5, against the providers tracked on https://kreatorflow.ai/seedance-api-comparison, checked October 2026). The [Seedance API comparison](https://kreatorflow.ai/seedance-api-comparison) lists every provider's price with its source and date.

Which one to pick:

- **Seedance 2.0**: the model most integrations start with. Strong camera motion, reference-led shots, up to 4K.
- **Seedance 2.5**: the newest Seedance model, single clips of up to 30 seconds with image, video and audio references in one request.
- **Seedance 2.0 Fast**: lower cost for drafts, motion tests and batches. Same request format, so you can draft on Fast and render the keeper on 2.0 by changing one field.
- **Seedance 2.0 Mini**: the lowest price per clip, for high-volume pipelines and previews.

Read more about each model on [Seedance](https://kreatorflow.ai/seedance) and the [Seedance API](https://kreatorflow.ai/seedance-api) page.

## Image to video

`first_frame`, `last_frame` and the reference lists take an https URL, an upload id, or a local file path. Local files are uploaded for you first (`POST /v1/uploads`, a `PUT` of the bytes, then `POST /v1/uploads/complete`).

```python
# Animate a local photo from its first frame
job = client.generate(
    "The camera slowly pushes in as the wind moves her hair",
    first_frame="photo.png",
    aspect_ratio="adaptive",
    resolution="1080p",
    out="photo.mp4",
)

# Land a transition on an exact picture
client.create_video("Day turns to night over the harbor", first_frame="https://example.com/day.jpg", last_frame="https://example.com/night.jpg")

# Keep a product or a look the same with reference images (up to 9 on Seedance 2.x)
client.create_video("The sneaker spins on a concrete plinth, hard side light", reference_images=["sneaker-front.png", "sneaker-side.png"])
```

Frame images (`first_frame`, `last_frame`) and reference images cannot be mixed in one job. Seedance 2.x models also take up to 3 `reference_videos` and 3 `reference_audios`. Upload limits are 50 MB per image, 200 MB per video and 15 MB per audio file. To upload without creating a video, call `client.upload("photo.png")` and pass the returned id later.

## Waiting and polling

A Seedance video usually takes a few minutes, longer for long or high-resolution clips. `wait()` polls `GET /v1/jobs/{id}`:

```python
job = client.wait(
    job,                 # a Job or a job id
    timeout=1800,        # seconds before WaitTimeoutError (the job keeps running)
    poll_interval=10,    # seconds between polls
    on_update=lambda j: print(j.status),
)
```

A job moves through `created`, `queued`, `processing` and ends as `completed`, `failed`, `canceled` or `blocked`. `wait()` returns on any final status and does not raise when the job fails, so check `job.succeeded`, `job.error_code` and `job.error_message`. Tokens held for a job that does not complete go back to your balance.

When the API answers `429 rate_limited`, the client sleeps for the `Retry-After` seconds and sends the call again, up to `max_retries` times (3 by default, set with `Seedance(max_retries=...)`). The limits are 20 video create calls per minute per account, and 600 job polls per minute per account (120 per job). See [Seedance API rate limits](https://kreatorflow.ai/guides/seedance-api-rate-limits).

To submit a batch, create every job first, then wait for them together:

```python
from concurrent.futures import ThreadPoolExecutor

prompts = ["A skateboarder kickflips over a puddle", "A lighthouse in a storm, drone orbit", "Coffee poured in slow motion"]
jobs = [client.create_video(p, model="seedance-2.0-fast") for p in prompts]
with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
    for done in pool.map(client.wait, jobs):
        if done.succeeded:
            client.download(done)
```

## Downloading the video

```python
path = client.download(job, "clip.mp4")   # streams GET /v1/jobs/{id}/output in 1 MB chunks
path = client.download(job, "videos/")    # saves videos/<job id>.mp4
```

The output link needs your API key and does not last forever, so copy finished files to your own storage.

## Webhooks

Instead of polling, pass `webhook_url` and KreatorFlow sends a signed POST when the job reaches its final status:

```python
client.create_video("A hot air balloon rising over fields at dawn", webhook_url="https://your-app.com/kreatorflow/webhook")
```

The event `type` is `job.completed`, `job.failed`, `job.canceled` or `job.blocked`, and the job is in `event["data"]["job"]`. The `X-KreatorFlow-Signature` header looks like `t=<unix time>,v1=<hex>`, where the hex is HMAC-SHA256 of `"<t>.<raw body>"` keyed with the signing secret from the console's Webhooks section. `verify_webhook` checks the signature in constant time, rejects timestamps more than 5 minutes off, and returns the parsed event:

```python
# pip install flask
import os
from flask import Flask, abort, request
from seedance import WebhookVerificationError, verify_webhook

app = Flask(__name__)
SECRET = os.environ["KREATORFLOW_WEBHOOK_SECRET"]
seen = set()  # use your database in production

@app.post("/kreatorflow/webhook")
def kreatorflow_webhook():
    try:
        event = verify_webhook(request.get_data(), request.headers, SECRET)
    except WebhookVerificationError:
        abort(401)
    if event["id"] not in seen:          # handle each event once
        seen.add(event["id"])
        job = event["data"]["job"]
        print(event["type"], job["id"], job["status"])  # queue the download here
    return "ok", 200
```

Pass the raw body exactly as received (before JSON parsing). Reply with a 2xx quickly and do the download in the background. More in [AI video API webhooks](https://kreatorflow.ai/guides/ai-video-api-webhooks).

## Errors

Every API error is JSON with `success: false`, a machine-readable `code` and a readable `error` message. The client raises `SeedanceError` with `status`, `code`, `message` and `data`. Branch on `code`, never on the message text.

| Exception | When |
| --- | --- |
| `SeedanceError` | Base class for every API error |
| `AuthenticationError` | `invalid_api_key`, `scope_missing`, `account_not_active`, or no key set |
| `InsufficientBalanceError` | `insufficient_balance` (HTTP 402): top up, then try again |
| `RateLimitError` | `rate_limited` (HTTP 429) after `max_retries` waits; `retry_after` holds the seconds |
| `JobFailedError` | from `generate()`: the job ended `failed`, `canceled` or `blocked`; the job is on `.job` |
| `WaitTimeoutError` | `wait()` ran out of time; the job is on `.job` and keeps running |
| `WebhookVerificationError` | `verify_webhook()` rejected the request |

Common request errors:

| Code | HTTP | What to do |
| --- | --- | --- |
| `invalid_api_key` | 401 | Check the key and the `Authorization` header |
| `scope_missing` | 403 | Add the scope (`videos:create`, `jobs:read`, `uploads:create`) to the key |
| `model_not_found` | 400 | Use a model id from `client.list_models()` |
| `duration_not_supported` | 400 | Use a length the model lists |
| `aspect_ratio_not_supported` | 400 | Use a ratio the model lists |
| `resolution_not_supported` | 400 | Use a resolution the model lists |
| `reference_combination_not_supported` | 400 | Do not mix frame images with reference images |
| `insufficient_balance` | 402 | Top up your token balance |
| `job_not_found` | 404 | Check the job id and that it belongs to this key's account |
| `output_not_ready` | 409 | Wait until the job is completed before downloading |
| `rate_limited` | 429 | Handled for you: the client waits for `Retry-After` |
| `internal_error` | 500 | Send the same request again with the same `idempotency_key` |

A 4xx request error costs nothing: fix the request, then send it again. The full list is in [Seedance API errors](https://kreatorflow.ai/guides/seedance-api-errors) and the [Seedance API reference](https://kreatorflow.ai/seedance-api/reference).

```python
import uuid
from seedance import InsufficientBalanceError, SeedanceError

key = str(uuid.uuid4())  # keep one key per clip
try:
    job = client.create_video("A neon city at night, drone flythrough", idempotency_key=key)
except InsufficientBalanceError:
    print("Top up at https://developers.kreatorflow.ai")
except SeedanceError as err:
    if err.code == "internal_error":
        job = client.create_video("A neon city at night, drone flythrough", idempotency_key=key)  # safe: same key, same job
    else:
        raise
```

## Command line

Installing the package adds a `seedance` command:

```bash
export KREATORFLOW_API_KEY=your_api_key

seedance "A paper boat drifting down a rainy street at dusk" --out boat.mp4
seedance "Slow push in, soft wind" --image photo.png --model seedance-2.0 --resolution 1080p --aspect-ratio adaptive
seedance "A fox in the snow" --model seedance-2.0-fast --duration 10 --aspect-ratio 9:16 --out fox.mp4
seedance "A lighthouse in a storm" --no-wait     # print the job id and exit
```

Run `seedance --help` for every option. `python -m seedance` works too.

## API reference

```python
Seedance(api_key=None, *, base_url=None, timeout=60.0, download_timeout=300.0, max_retries=3, session=None)
```

| Method | HTTP call | Returns |
| --- | --- | --- |
| `create_video(prompt, *, model="seedance-2.0", duration=5, resolution="720p", aspect_ratio=None, generate_audio=None, seed=None, camera_fixed=None, first_frame=None, last_frame=None, reference_images=None, reference_videos=None, reference_audios=None, webhook_url=None, idempotency_key=None, extra=None)` | `POST /v1/videos` | `Job` |
| `get_job(job)` | `GET /v1/jobs/{id}` | `Job` |
| `wait(job, *, timeout=1800, poll_interval=10, on_update=None)` | polls `GET /v1/jobs/{id}` | `Job` |
| `download(job, path=None)` | `GET /v1/jobs/{id}/output` | `pathlib.Path` |
| `generate(prompt, *, out=None, timeout=1800, poll_interval=10, on_update=None, **create_options)` | create, wait, download | `Job` |
| `upload(path, *, mime_type=None)` | `POST /v1/uploads`, `PUT`, `POST /v1/uploads/complete` | upload id |
| `list_models()` | `GET /v1/models` | list of dicts |

`Job` has `id`, `status`, `model_id`, `resolution`, `output_url`, `error_code`, `error_message`, `warnings`, `created_at`, `completed_at`, `done`, `succeeded`, plus `quoted_token_cost`, `balance_tokens` and `idempotent_replay` on create results. Every field the API sent is on `job.raw`.

`extra={...}` sends any other request field as is. `KREATORFLOW_BASE_URL` overrides the API root.

## FAQ

**Who makes this SDK, and is it from ByteDance?**
KreatorFlow makes it. It is an unofficial, open source client for the KreatorFlow API, which serves ByteDance's Seedance models. Seedance is a ByteDance model; KreatorFlow is an official partner of BytePlus, a ByteDance company.

**Do I need a ByteDance or BytePlus account?**
No. You need a KreatorFlow API key. One key covers Seedance 2.5, 2.0, 2.0 Fast and 2.0 Mini, plus Seedream images and speech on the same API.

**How much does a Seedance video cost?**
You pay per second of video, by model and resolution. A 5-second Seedance 2.0 clip was $0.55 at 720p and $1.20 at 1080p as of 19 October 2026. See [Seedance pricing](https://kreatorflow.ai/seedance-pricing) for current prices.

**How long does a video take?**
Usually a few minutes. Poll with `wait()` or use a webhook. Never hold a browser request open while it renders.

**How do I avoid paying twice if a request times out?**
Send the same `idempotency_key` when you resend the same request. The API returns the job it already created and `job.idempotent_replay` is `True`. The client sets a fresh key on every call where you do not pass one.

**Can I call it from the browser?**
No. The API key is a secret. Call the API from your server and give your users the finished file.

**Is there a Node.js version?**
Yes: [`seedance-sdk` on npm](https://www.npmjs.com/package/seedance-sdk), with the same methods in camelCase.

**Can I use it without the SDK?**
Yes. The API is plain HTTPS and JSON. See the [Seedance API reference](https://kreatorflow.ai/seedance-api/reference) and the [Python and Node.js tutorial](https://kreatorflow.ai/guides/seedance-api-python-node).

## Links

- [Seedance API: models and prices](https://kreatorflow.ai/seedance-api)
- [Seedance API reference](https://kreatorflow.ai/seedance-api/reference)
- [Seedance API in Python and Node.js](https://kreatorflow.ai/guides/seedance-api-python-node)
- [Seedance pricing](https://kreatorflow.ai/seedance-pricing)
- [Seedance API comparison](https://kreatorflow.ai/seedance-api-comparison)
- [Seedance on KreatorFlow](https://kreatorflow.ai/seedance)
- [Create an API key](https://developers.kreatorflow.ai/?section=keys)

## License

MIT. This project is not made or endorsed by ByteDance or BytePlus.
