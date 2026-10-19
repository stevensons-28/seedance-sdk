# Seedance Node.js SDK

[![npm](https://img.shields.io/npm/v/seedance-sdk.svg)](https://www.npmjs.com/package/seedance-sdk)
[![types](https://img.shields.io/npm/types/seedance-sdk.svg)](https://www.npmjs.com/package/seedance-sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`seedance-sdk` is an unofficial Node.js and TypeScript client for ByteDance's Seedance video models (Seedance 2.5, Seedance 2.0, Seedance 2.0 Fast and Seedance 2.0 Mini) through the [KreatorFlow Seedance API](https://kreatorflow.ai/seedance-api). Seedance is a ByteDance model; KreatorFlow is an official partner of BytePlus, a ByteDance company.

Create a video from a prompt or an image, wait for it, and save the MP4:

```ts
import { Seedance } from "seedance-sdk";

const seedance = new Seedance(); // reads KREATORFLOW_API_KEY
await seedance.generate("A paper boat drifting down a rainy street at dusk, low angle", { out: "boat.mp4" });
```

- Zero runtime dependencies: built-in `fetch`, `node:crypto` and streams (Node 18+)
- ESM and CommonJS builds with full TypeScript types
- Text to video, image to video (first and last frame), reference images, clips and audio
- Polling that waits out `429` answers using `Retry-After`
- Streaming download, so a large MP4 never sits in memory
- `Idempotency-Key` on every create call, so a resent request never starts a second job
- Webhook signature checks that match the KreatorFlow server exactly
- An `npx seedance-sdk` command for the terminal

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
npm install seedance-sdk
```

Works with `import` and `require`:

```js
import { Seedance } from "seedance-sdk";        // ESM / TypeScript
const { Seedance } = require("seedance-sdk");   // CommonJS
```

## Get an API key

1. Sign in to the KreatorFlow developer console and [create an API key](https://developers.kreatorflow.ai/?section=keys) with the `videos:create` and `jobs:read` scopes (add `uploads:create` to send local images).
2. Top up your token balance. There is no subscription: you pay per second of video from prepaid tokens.
3. Put the key in an environment variable on your server:

```bash
export KREATORFLOW_API_KEY=your_api_key
```

Keep the key on your server. Never commit it and never ship it to a browser or a mobile app. The step by step guide is [How to get a Seedance API key](https://kreatorflow.ai/guides/how-to-get-a-seedance-api-key).

## Quickstart

```ts
import { Seedance, SeedanceError } from "seedance-sdk";

const seedance = new Seedance();

try {
  const job = await seedance.createVideo("A red fox trotting through fresh snow at sunrise, side tracking shot", {
    model: "seedance-2.0",   // or "seedance-2.5", "seedance-2.0-fast", "seedance-2.0-mini"
    duration: 5,             // seconds
    resolution: "720p",      // "480p", "720p", "1080p" or "4k" where the model offers it
    aspectRatio: "16:9",     // "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"
  });
  console.log(job.id, job.status, `quoted ${job.quotedTokenCost} tokens`);

  const done = await seedance.wait(job); // polls until completed, failed, canceled or blocked
  if (done.status === "completed") await seedance.download(done, "fox.mp4");
  else console.error(done.status, done.errorCode, done.errorMessage);
} catch (error) {
  if (error instanceof SeedanceError) console.error(error.status, error.code, error.message);
  else throw error;
}
```

`generate()` does all of that in one call and throws `JobFailedError` if the job does not complete:

```ts
await seedance.generate("Steam rising from a bowl of ramen, slow push in", { model: "seedance-2.0-fast", out: "ramen.mp4" });
```

The full walkthrough, with the same calls written by hand with `fetch` and in Python, is the [Seedance API in Python and Node.js tutorial](https://kreatorflow.ai/guides/seedance-api-python-node).

## Seedance models and prices

Pass a friendly name or the KreatorFlow model id as `model`. Any other id from `seedance.listModels()` works too.

| Model | `model` | API model id | Lengths (seconds) | Top resolution | 5 s clip at 720p | 5 s clip at 1080p |
| --- | --- | --- | --- | --- | --- | --- |
| Seedance 2.5 | `seedance-2.5` | `kreator-video-seedance-2-5` | 4 to 15, 20, 25, 30 | 4K | $1.05 | $2.25 |
| Seedance 2.0 | `seedance-2.0` (default) | `kreator-video-seedance-2` (also `kreator-video-pro`) | 4, 5, 6, 8, 10, 12, 15 | 4K | $0.55 | $1.20 |
| Seedance 2.0 Fast | `seedance-2.0-fast` | `kreator-video-seedance-2-fast` (also `kreator-video-fast`) | 4, 5, 6, 8, 10 | 1080p | $0.45 | $0.95 |
| Seedance 2.0 Mini | `seedance-2.0-mini` | `kreator-video-seedance-2-mini` (also `kreator-video-mini`) | 4, 5, 6, 8, 10 | 1080p | $0.35 | $0.70 |

Prices are as of 19 October 2026, for one 5-second clip with text or image input, read from the KreatorFlow rate card. One token is $0.05 and top-ups start at $20. Every create call returns the exact quote for your request in `job.quotedTokenCost`. See [Seedance pricing](https://kreatorflow.ai/seedance-pricing) for current prices and the [Seedance API calculator](https://kreatorflow.ai/seedance-calculator) to price any clip.

KreatorFlow is the cheapest Seedance API at 720p and above (Seedance 2.0 and 2.5, against the providers tracked on https://kreatorflow.ai/seedance-api-comparison, checked October 2026). The [Seedance API comparison](https://kreatorflow.ai/seedance-api-comparison) lists every provider's price with its source and date.

Which one to pick:

- **Seedance 2.0**: the model most integrations start with. Strong camera motion, reference-led shots, up to 4K.
- **Seedance 2.5**: the newest Seedance model, single clips of up to 30 seconds with image, video and audio references in one request.
- **Seedance 2.0 Fast**: lower cost for drafts, motion tests and batches. Same request format, so you can draft on Fast and render the keeper on 2.0 by changing one field.
- **Seedance 2.0 Mini**: the lowest price per clip, for high-volume pipelines and previews.

Read more about each model on [Seedance](https://kreatorflow.ai/seedance) and the [Seedance API](https://kreatorflow.ai/seedance-api) page.

## Image to video

`firstFrame`, `lastFrame` and the reference lists take an https URL, an upload id, a local file path, or `{ data, fileName }` bytes. Local files and bytes are uploaded for you first (`POST /v1/uploads`, a `PUT` of the bytes, then `POST /v1/uploads/complete`).

```ts
// Animate a local photo from its first frame
await seedance.generate("The camera slowly pushes in as the wind moves her hair", {
  firstFrame: "photo.png",
  aspectRatio: "adaptive",
  resolution: "1080p",
  out: "photo.mp4",
});

// Land a transition on an exact picture
await seedance.createVideo("Day turns to night over the harbor", {
  firstFrame: "https://example.com/day.jpg",
  lastFrame: "https://example.com/night.jpg",
});

// Keep a product or a look the same with reference images (up to 9 on Seedance 2.x)
await seedance.createVideo("The sneaker spins on a concrete plinth, hard side light", {
  referenceImages: ["sneaker-front.png", "sneaker-side.png"],
});

// Bytes you already hold, for example from a form upload
await seedance.createVideo("Slow orbit around the product", {
  firstFrame: { data: buffer, fileName: "product.jpg", mimeType: "image/jpeg" },
});
```

Frame images (`firstFrame`, `lastFrame`) and reference images cannot be mixed in one job. Seedance 2.x models also take up to 3 `referenceVideos` and 3 `referenceAudios`. Upload limits are 50 MB per image, 200 MB per video and 15 MB per audio file. To upload without creating a video, call `await seedance.upload("photo.png")` and pass the returned id later.

## Waiting and polling

A Seedance video usually takes a few minutes, longer for long or high-resolution clips. `wait()` polls `GET /v1/jobs/{id}`:

```ts
const done = await seedance.wait(job, {   // a job or a job id
  timeoutMs: 30 * 60_000,                 // then WaitTimeoutError (the job keeps running)
  pollIntervalMs: 10_000,
  onUpdate: (j) => console.log(j.status),
  signal: AbortSignal.timeout(60 * 60_000),
});
```

A job moves through `created`, `queued`, `processing` and ends as `completed`, `failed`, `canceled` or `blocked`. `wait()` returns on any final status and does not throw when the job fails, so check `status`, `errorCode` and `errorMessage`. Tokens held for a job that does not complete go back to your balance.

When the API answers `429 rate_limited`, the client sleeps for the `Retry-After` seconds and sends the call again, up to `maxRetries` times (3 by default, set with `new Seedance({ maxRetries })`). The limits are 20 video create calls per minute per account, and 600 job polls per minute per account (120 per job). See [Seedance API rate limits](https://kreatorflow.ai/guides/seedance-api-rate-limits).

To render a batch, create every job first, then wait for them together:

```ts
const prompts = ["A skateboarder kickflips over a puddle", "A lighthouse in a storm, drone orbit", "Coffee poured in slow motion"];
const jobs = await Promise.all(prompts.map((p) => seedance.createVideo(p, { model: "seedance-2.0-fast" })));
for (const done of await Promise.all(jobs.map((j) => seedance.wait(j)))) {
  if (done.status === "completed") await seedance.download(done);
}
```

## Downloading the video

```ts
await seedance.download(job, "clip.mp4"); // streams GET /v1/jobs/{id}/output to disk
await seedance.download(job, "videos");   // saves videos/<job id>.mp4
```

The output link needs your API key and does not last forever, so copy finished files to your own storage.

## Webhooks

Instead of polling, pass `webhookUrl` and KreatorFlow sends a signed POST when the job reaches its final status:

```ts
await seedance.createVideo("A hot air balloon rising over fields at dawn", { webhookUrl: "https://your-app.com/kreatorflow/webhook" });
```

The event `type` is `job.completed`, `job.failed`, `job.canceled` or `job.blocked`, and the job is in `event.data.job`. The `X-KreatorFlow-Signature` header looks like `t=<unix time>,v1=<hex>`, where the hex is HMAC-SHA256 of `"<t>.<raw body>"` keyed with the signing secret from the console's Webhooks section. `verifyWebhook` checks the signature in constant time, rejects timestamps more than 5 minutes off, and returns the typed event.

With Express (read the raw body, not parsed JSON):

```ts
import express from "express";
import { verifyWebhook, WebhookVerificationError } from "seedance-sdk";

const app = express();
const seen = new Set<string>(); // use your database in production

app.post("/kreatorflow/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.KREATORFLOW_WEBHOOK_SECRET!);
    if (!seen.has(event.id)) {
      seen.add(event.id);
      console.log(event.type, event.data.job.id, event.data.job.status); // queue the download here
    }
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.sendStatus(401);
    throw error;
  }
});
```

In a Next.js route handler or any `Request`-based framework:

```ts
export async function POST(request: Request) {
  const event = verifyWebhook(await request.text(), request.headers, process.env.KREATORFLOW_WEBHOOK_SECRET!);
  // ...
  return new Response("ok");
}
```

Reply with a 2xx quickly and do the download in the background. More in [AI video API webhooks](https://kreatorflow.ai/guides/ai-video-api-webhooks).

## Errors

Every API error is JSON with `success: false`, a machine-readable `code` and a readable `error` message. The client throws `SeedanceError` with `status`, `code`, `message` and `data`. Branch on `code`, never on the message text.

| Error class | When |
| --- | --- |
| `SeedanceError` | Base class for every API error |
| `AuthenticationError` | `invalid_api_key`, `scope_missing`, `account_not_active`, or no key set |
| `InsufficientBalanceError` | `insufficient_balance` (HTTP 402): top up, then try again |
| `RateLimitError` | `rate_limited` (HTTP 429) after `maxRetries` waits; `retryAfter` holds the seconds |
| `JobFailedError` | from `generate()`: the job ended `failed`, `canceled` or `blocked`; the job is on `.job` |
| `WaitTimeoutError` | `wait()` ran out of time; the job is on `.job` and keeps running |
| `WebhookVerificationError` | `verifyWebhook()` rejected the request |

Common request errors:

| Code | HTTP | What to do |
| --- | --- | --- |
| `invalid_api_key` | 401 | Check the key and the `Authorization` header |
| `scope_missing` | 403 | Add the scope (`videos:create`, `jobs:read`, `uploads:create`) to the key |
| `model_not_found` | 400 | Use a model id from `listModels()` |
| `duration_not_supported` | 400 | Use a length the model lists |
| `aspect_ratio_not_supported` | 400 | Use a ratio the model lists |
| `resolution_not_supported` | 400 | Use a resolution the model lists |
| `reference_combination_not_supported` | 400 | Do not mix frame images with reference images |
| `insufficient_balance` | 402 | Top up your token balance |
| `job_not_found` | 404 | Check the job id and that it belongs to this key's account |
| `output_not_ready` | 409 | Wait until the job is completed before downloading |
| `rate_limited` | 429 | Handled for you: the client waits for `Retry-After` |
| `internal_error` | 500 | Send the same request again with the same `idempotencyKey` |

A 4xx request error costs nothing: fix the request, then send it again. The full list is in [Seedance API errors](https://kreatorflow.ai/guides/seedance-api-errors) and the [Seedance API reference](https://kreatorflow.ai/seedance-api/reference).

```ts
import { randomUUID } from "node:crypto";
import { InsufficientBalanceError, SeedanceError } from "seedance-sdk";

const idempotencyKey = randomUUID(); // keep one key per clip
try {
  await seedance.createVideo("A neon city at night, drone flythrough", { idempotencyKey });
} catch (error) {
  if (error instanceof InsufficientBalanceError) console.error("Top up at https://developers.kreatorflow.ai");
  else if (error instanceof SeedanceError && error.code === "internal_error") {
    await seedance.createVideo("A neon city at night, drone flythrough", { idempotencyKey }); // safe: same key, same job
  } else throw error;
}
```

## Command line

```bash
export KREATORFLOW_API_KEY=your_api_key

npx seedance-sdk "A paper boat drifting down a rainy street at dusk" --out boat.mp4
npx seedance-sdk "Slow push in, soft wind" --image photo.png --model seedance-2.0 --resolution 1080p --aspect-ratio adaptive
npx seedance-sdk "A fox in the snow" --model seedance-2.0-fast --duration 10 --aspect-ratio 9:16 --out fox.mp4
npx seedance-sdk "A lighthouse in a storm" --no-wait     # print the job id and exit
```

Run `npx seedance-sdk --help` for every option.

## API reference

```ts
new Seedance({ apiKey?, baseUrl?, timeoutMs = 60_000, downloadTimeoutMs = 300_000, maxRetries = 3, fetch? })
```

| Method | HTTP call | Returns |
| --- | --- | --- |
| `createVideo(prompt, { model, duration, resolution, aspectRatio, generateAudio, seed, cameraFixed, firstFrame, lastFrame, referenceImages, referenceVideos, referenceAudios, webhookUrl, idempotencyKey, extra })` | `POST /v1/videos` | `CreatedJob` |
| `getJob(job)` | `GET /v1/jobs/{id}` | `Job` |
| `wait(job, { timeoutMs, pollIntervalMs, onUpdate, signal })` | polls `GET /v1/jobs/{id}` | `Job` |
| `download(job, path?)` | `GET /v1/jobs/{id}/output` | file path |
| `generate(prompt, { ...createOptions, ...waitOptions, out })` | create, wait, download | `Job` |
| `upload(pathOrBytes, { mimeType })` | `POST /v1/uploads`, `PUT`, `POST /v1/uploads/complete` | upload id |
| `listModels()` | `GET /v1/models` | `SeedanceModelInfo[]` |
| `verifyWebhook(payload, headers, secret, { tolerance, now })` | none | `WebhookEvent` |

A `Job` keeps the API's own field names: `id`, `status`, `modelId`, `resolution`, `providerOutputUrl`, `errorCode`, `errorMessage`, `warnings`, `createdAt`, `completedAt`. `CreatedJob` adds `quotedTokenCost`, `balanceTokens` and `idempotentReplay`.

`extra: {...}` sends any other request field as is. `KREATORFLOW_BASE_URL` overrides the API root.

## FAQ

**Who makes this SDK, and is it from ByteDance?**
KreatorFlow makes it. It is an unofficial, open source client for the KreatorFlow API, which serves ByteDance's Seedance models. Seedance is a ByteDance model; KreatorFlow is an official partner of BytePlus, a ByteDance company.

**Do I need a ByteDance or BytePlus account?**
No. You need a KreatorFlow API key. One key covers Seedance 2.5, 2.0, 2.0 Fast and 2.0 Mini, plus Seedream images and speech on the same API.

**How much does a Seedance video cost?**
You pay per second of video, by model and resolution. A 5-second Seedance 2.0 clip was $0.55 at 720p and $1.20 at 1080p as of 19 October 2026. See [Seedance pricing](https://kreatorflow.ai/seedance-pricing) for current prices.

**Which Node.js version do I need?**
Node 18.17 or later, which has `fetch`, web streams and `crypto.randomUUID` built in. The package has no runtime dependencies.

**Does it work in the browser or on the edge?**
Call it from your server. The API key is a secret, and `download` and local file uploads use Node's file system. `verifyWebhook` uses `node:crypto`, which Node-compatible serverless runtimes provide.

**How do I avoid paying twice if a request times out?**
Send the same `idempotencyKey` when you resend the same request. The API returns the job it already created and `idempotentReplay` is `true`. The client sets a fresh key on every call where you do not pass one.

**Is there a Python version?**
Yes: [`seedance` on PyPI](https://pypi.org/project/seedance/), with the same methods in snake_case.

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
