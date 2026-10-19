// Client tests with a mocked fetch: no network is used.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  AuthenticationError,
  InsufficientBalanceError,
  JobFailedError,
  RateLimitError,
  Seedance,
  SeedanceError,
  WaitTimeoutError,
  resolveModel,
} from "../dist/index.js";

const JOB_ID = "3f1c0a9e-1b2c-4d3e-8f40-123456789abc";
const job = (status = "queued", extra = {}) => ({ id: JOB_ID, mediaType: "video", modelId: "kreator-video-seedance-2", status, ...extra });
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const ok = (data, status = 200, headers) => json(status, { success: true, data }, headers);
const err = (status, code, error = "nope", headers, data = {}) => json(status, { success: false, code, error, data }, headers);
const created = () => ok({ job: job(), balance_tokens: 389, quoted_token_cost: 11, estimated_token_cost: 11 }, 202);

function setup(responses, options = {}) {
  const calls = [];
  const sleeps = [];
  let clock = 0;
  const queue = [...responses];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init, headers: { ...(init.headers ?? {}) }, json: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (!queue.length) throw new Error(`unexpected request ${init.method} ${url}`);
    return queue.shift();
  };
  const client = new Seedance({
    apiKey: "kf_test",
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...options,
  });
  return { client, calls, sleeps };
}

describe("constructor and models", () => {
  it("reads KREATORFLOW_API_KEY", () => {
    process.env.KREATORFLOW_API_KEY = "kf_env";
    try {
      assert.equal(new Seedance({ fetch: async () => new Response() }).apiKey, "kf_env");
    } finally {
      delete process.env.KREATORFLOW_API_KEY;
    }
  });

  it("throws without a key", () => {
    delete process.env.KREATORFLOW_API_KEY;
    assert.throws(() => new Seedance(), (e) => e instanceof AuthenticationError && e.code === "api_key_missing");
  });

  it("maps friendly model names", () => {
    assert.equal(resolveModel("seedance-2.0"), "kreator-video-seedance-2");
    assert.equal(resolveModel("Seedance-2.5"), "kreator-video-seedance-2-5");
    assert.equal(resolveModel("seedance-2.0-fast"), "kreator-video-seedance-2-fast");
    assert.equal(resolveModel("seedance-2.0-mini"), "kreator-video-seedance-2-mini");
    assert.equal(resolveModel("kreator-video-pro"), "kreator-video-pro");
  });

  it("lists models", async () => {
    const { client, calls } = setup([ok({ object: "list", models: [{ id: "kreator-video-seedance-2" }] })]);
    assert.deepEqual(await client.listModels(), [{ id: "kreator-video-seedance-2" }]);
    assert.equal(calls[0].url, "https://kreatorflow.ai/v1/models");
  });
});

describe("createVideo", () => {
  it("sends the right request", async () => {
    const { client, calls } = setup([created()]);
    const result = await client.createVideo("a paper boat", { model: "seedance-2.5", aspectRatio: "9:16", seed: 7, webhookUrl: "https://example.com/hook" });
    const call = calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.url, "https://kreatorflow.ai/v1/videos");
    assert.equal(call.headers.Authorization, "Bearer kf_test");
    assert.match(call.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
    assert.deepEqual(call.json, {
      model: "kreator-video-seedance-2-5",
      prompt: "a paper boat",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "9:16",
      seed: 7,
      webhook_url: "https://example.com/hook",
    });
    assert.equal(result.id, JOB_ID);
    assert.equal(result.status, "queued");
    assert.equal(result.quotedTokenCost, 11);
    assert.equal(result.balanceTokens, 389);
    assert.equal(result.idempotentReplay, false);
  });

  it("sends a given Idempotency-Key and reads the replay flag", async () => {
    const { client, calls } = setup([ok({ job: job(), idempotent_replay: true })]);
    const result = await client.createVideo("x", { idempotencyKey: "order-42" });
    assert.equal(calls[0].headers["Idempotency-Key"], "order-42");
    assert.equal(result.idempotentReplay, true);
  });

  it("passes image URLs and upload ids", async () => {
    const { client, calls } = setup([created()]);
    await client.createVideo("x", {
      firstFrame: "https://example.com/a.png",
      lastFrame: "tos:kreatorflow/uploads/w/1-a.png",
      referenceVideos: [new URL("https://example.com/v.mp4")],
    });
    assert.equal(calls[0].json.first_frame_url, "https://example.com/a.png");
    assert.equal(calls[0].json.last_frame_upload_id, "tos:kreatorflow/uploads/w/1-a.png");
    assert.deepEqual(calls[0].json.reference_video_urls, ["https://example.com/v.mp4"]);
  });

  it("passes reference images", async () => {
    const { client, calls } = setup([created()]);
    await client.createVideo("x", { referenceImages: ["https://example.com/1.png", "https://example.com/2.png"] });
    assert.deepEqual(calls[0].json.reference_image_urls, ["https://example.com/1.png", "https://example.com/2.png"]);
  });

  it("throws ENOENT for a missing local image before any request", async () => {
    const { client, calls } = setup([]);
    await assert.rejects(client.createVideo("x", { firstFrame: "does-not-exist.png" }), (e) => e.code === "ENOENT");
    assert.equal(calls.length, 0);
  });

  it("uploads a local image first", async () => {
    const folder = await mkdtemp(join(tmpdir(), "seedance-"));
    const image = join(folder, "photo.png");
    await writeFile(image, Buffer.from("\x89PNG fake", "latin1"));
    const { client, calls } = setup([
      ok({ upload_id: "tos:k/u/1.png", direct_upload_url: "https://storage.example/put", direct_upload_headers: { "Content-Type": "image/png" } }),
      new Response(null, { status: 200 }),
      ok({ upload_id: "tos:k/u/1.png", status: "ready" }),
      created(),
    ]);
    await client.createVideo("x", { firstFrame: image });
    const [upload, put, complete, create] = calls;
    assert.equal(upload.url, "https://kreatorflow.ai/v1/uploads");
    assert.deepEqual(upload.json, { file_name: "photo.png", mime_type: "image/png", file_size: 9, upload_type: "IMAGE" });
    assert.equal(put.method, "PUT");
    assert.equal(put.url, "https://storage.example/put");
    assert.deepEqual(put.headers, { "Content-Type": "image/png" });
    assert.equal(Buffer.from(put.body).toString("latin1"), "\x89PNG fake");
    assert.equal(complete.url, "https://kreatorflow.ai/v1/uploads/complete");
    assert.deepEqual(complete.json, { upload_id: "tos:k/u/1.png" });
    assert.equal(create.json.first_frame_upload_id, "tos:k/u/1.png");
  });
});

describe("errors", () => {
  it("exposes status, code, message and data", async () => {
    const { client } = setup([err(400, "duration_not_supported", "Duration must be one of: 4, 5 seconds.", {}, { x: 1 })]);
    await assert.rejects(client.createVideo("x", { duration: 3 }), (e) => {
      assert.ok(e instanceof SeedanceError);
      assert.equal(e.status, 400);
      assert.equal(e.code, "duration_not_supported");
      assert.match(e.message, /Duration must be one of/);
      assert.deepEqual(e.data, { x: 1 });
      return true;
    });
  });

  it("uses typed errors", async () => {
    const { client } = setup([err(402, "insufficient_balance"), err(401, "invalid_api_key"), err(403, "scope_missing")]);
    await assert.rejects(client.createVideo("x"), InsufficientBalanceError);
    await assert.rejects(client.getJob(JOB_ID), AuthenticationError);
    await assert.rejects(client.getJob(JOB_ID), AuthenticationError);
  });

  it("handles a non-JSON error", async () => {
    const { client } = setup([new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })]);
    await assert.rejects(client.getJob(JOB_ID), (e) => e.code === "http_error" && e.status === 502);
  });

  it("waits Retry-After on 429, then succeeds", async () => {
    const { client, calls, sleeps } = setup([err(429, "rate_limited", "slow down", { "Retry-After": "7" }), ok({ job: job("processing") })]);
    const result = await client.getJob(JOB_ID);
    assert.equal(result.status, "processing");
    assert.deepEqual(sleeps, [7000]);
    assert.equal(calls.length, 2);
  });

  it("gives up after maxRetries", async () => {
    const limited = [1, 2, 3].map(() => err(429, "rate_limited", "slow down", { "Retry-After": "2" }));
    const { client, sleeps } = setup(limited, { maxRetries: 2 });
    await assert.rejects(client.getJob(JOB_ID), (e) => e instanceof RateLimitError && e.retryAfter === 2);
    assert.deepEqual(sleeps, [2000, 2000]);
  });
});

describe("wait and generate", () => {
  it("polls until a final status", async () => {
    const output = `https://kreatorflow.ai/v1/jobs/${JOB_ID}/output`;
    const { client, calls, sleeps } = setup([ok({ job: job("processing") }), ok({ job: job("completed", { providerOutputUrl: output }) })]);
    const seen = [];
    const done = await client.wait(job("queued"), { pollIntervalMs: 3000, onUpdate: (j) => seen.push(j.status) });
    assert.equal(done.status, "completed");
    assert.equal(done.providerOutputUrl, output);
    assert.deepEqual(seen, ["processing", "completed"]);
    assert.deepEqual(sleeps, [3000, 3000]);
    assert.equal(calls[0].url, `https://kreatorflow.ai/v1/jobs/${JOB_ID}`);
  });

  it("accepts a job id and returns failed jobs without throwing", async () => {
    const { client } = setup([ok({ job: job("failed", { errorCode: "generation_failed", errorMessage: "Try a different prompt." }) })]);
    const done = await client.wait(JOB_ID);
    assert.equal(done.status, "failed");
    assert.equal(done.errorCode, "generation_failed");
  });

  it("throws WaitTimeoutError", async () => {
    const { client } = setup([1, 2, 3, 4, 5].map(() => ok({ job: job("processing") })));
    await assert.rejects(client.wait(job("queued"), { timeoutMs: 25_000, pollIntervalMs: 10_000 }), (e) => e instanceof WaitTimeoutError && e.job.status === "processing");
  });

  it("generate throws JobFailedError on a blocked job", async () => {
    const { client } = setup([created(), ok({ job: job("blocked", { errorCode: "generation_rejected", errorMessage: "Change the prompt." }) })]);
    await assert.rejects(client.generate("x"), (e) => e instanceof JobFailedError && e.code === "generation_rejected" && e.job.status === "blocked");
  });

  it("generate with out saves the file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "seedance-"));
    const target = join(folder, "out.mp4");
    const { client, calls } = setup([created(), ok({ job: job("completed") }), new Response("video-bytes", { status: 200, headers: { "Content-Type": "video/mp4" } })]);
    const done = await client.generate("x", { out: target, model: "seedance-2.0-fast", pollIntervalMs: 1 });
    assert.equal(done.status, "completed");
    assert.equal(await readFile(target, "utf8"), "video-bytes");
    assert.equal(calls[0].json.model, "kreator-video-seedance-2-fast");
  });
});

describe("download", () => {
  it("streams the output to a file", async () => {
    const folder = await mkdtemp(join(tmpdir(), "seedance-"));
    const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    const { client, calls } = setup([new Response(payload, { status: 200, headers: { "Content-Type": "video/mp4" } })]);
    const target = join(folder, "clip.mp4");
    assert.equal(await client.download(JOB_ID, target), target);
    assert.ok((await readFile(target)).equals(payload));
    await assert.rejects(stat(`${target}.part`));
    assert.equal(calls[0].url, `https://kreatorflow.ai/v1/jobs/${JOB_ID}/output`);
    assert.equal(calls[0].headers.Authorization, "Bearer kf_test");
  });

  it("saves into a folder as <job id>.mp4", async () => {
    const folder = await mkdtemp(join(tmpdir(), "seedance-"));
    const { client } = setup([new Response("mp4", { status: 200 })]);
    assert.equal(await client.download(job("completed"), folder), join(folder, `${JOB_ID}.mp4`));
  });

  it("throws output_not_ready", async () => {
    const { client } = setup([err(409, "output_not_ready", "Output is not available for this KreatorFlow job.")]);
    await assert.rejects(client.download(JOB_ID, join(tmpdir(), "never.mp4")), (e) => e.code === "output_not_ready" && e.status === 409);
  });
});
