import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rename, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import {
  AuthenticationError,
  InsufficientBalanceError,
  JobFailedError,
  RateLimitError,
  SeedanceError,
  WaitTimeoutError,
  type SeedanceErrorOptions,
} from "./errors.js";
import { DEFAULT_MODEL, TERMINAL_STATUSES, resolveModel } from "./models.js";
import type {
  CreateVideoOptions,
  CreatedJob,
  FetchLike,
  GenerateOptions,
  Job,
  MediaInput,
  SeedanceModelInfo,
  SeedanceOptions,
  UploadSource,
  WaitOptions,
} from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://kreatorflow.ai/v1";
export const KEYS_URL = "https://developers.kreatorflow.ai/?section=keys";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

type JobRef = Job | string;

interface InternalOptions extends SeedanceOptions {
  /** For tests: replaces setTimeout-based sleeping. */
  sleep?: (ms: number) => Promise<void>;
  /** For tests: replaces Date.now. */
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(value: string | null, fallbackSeconds = 5): number {
  if (!value) return fallbackSeconds * 1000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallbackSeconds * 1000;
}

function mediaKind(mime: string): "IMAGE" | "VIDEO" | "AUDIO" {
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "IMAGE";
}

function jobId(job: JobRef): string {
  return typeof job === "string" ? job : job.id;
}

function isUploadSource(value: unknown): value is UploadSource {
  return typeof value === "object" && value !== null && !(value instanceof URL) && "data" in value && "fileName" in value;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A small client for ByteDance's Seedance video models through the KreatorFlow API.
 *
 * ```ts
 * const seedance = new Seedance(); // reads KREATORFLOW_API_KEY
 * await seedance.generate("A paper boat drifting down a rainy street at dusk", { out: "boat.mp4" });
 * ```
 */
export class Seedance {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly downloadTimeoutMs: number;
  readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(options: SeedanceOptions = {}) {
    const opts = options as InternalOptions;
    const env = typeof process !== "undefined" ? process.env : {};
    const key = opts.apiKey ?? env.KREATORFLOW_API_KEY;
    if (!key) {
      throw new AuthenticationError(`No API key. Pass { apiKey } or set KREATORFLOW_API_KEY. Create a key at ${KEYS_URL}`, {
        code: "api_key_missing",
      });
    }
    const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new SeedanceError("No fetch available. Use Node 18 or later, or pass { fetch }.", { code: "fetch_missing" });
    this.apiKey = key;
    this.baseUrl = (opts.baseUrl ?? env.KREATORFLOW_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.downloadTimeoutMs = opts.downloadTimeoutMs ?? 300_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 3);
    this.fetchImpl = fetchImpl;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------------ HTTP

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": `seedance-sdk-node/${VERSION}`,
      ...extra,
    };
  }

  private async send(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
      if (response.status !== 429 || attempt >= this.maxRetries) return response;
      const wait = retryAfterMs(response.headers.get("Retry-After"));
      await response.body?.cancel().catch(() => undefined);
      await this.sleep(wait);
    }
  }

  private static async toError(response: Response): Promise<SeedanceError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const code = (record?.code as string | undefined) ?? "http_error";
    const message =
      (record?.error as string | undefined) ?? (record?.message as string | undefined) ?? `HTTP ${response.status} ${response.statusText}`.trim();
    const data = record?.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const options: SeedanceErrorOptions = { status: response.status, code, data, headers };
    if (response.status === 429) {
      return new RateLimitError(message, { ...options, retryAfter: retryAfterMs(response.headers.get("Retry-After")) / 1000 });
    }
    if (response.status === 402 || code === "insufficient_balance") return new InsufficientBalanceError(message, options);
    if (response.status === 401 || code === "invalid_api_key" || code === "scope_missing" || code === "account_not_active") {
      return new AuthenticationError(message, options);
    }
    return new SeedanceError(message, options);
  }

  private async json<T = Record<string, unknown>>(path: string, init: RequestInit): Promise<T> {
    const response = await this.send(path, init);
    if (!response.ok) throw await Seedance.toError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new SeedanceError("The API answer was not JSON.", { status: response.status, code: "invalid_response" });
    }
    const record = body as { success?: boolean; data?: unknown; code?: string; error?: string };
    if (!record || record.success !== true) {
      throw new SeedanceError(record?.error ?? "Request failed.", { status: response.status, code: record?.code ?? "http_error" });
    }
    return (record.data ?? {}) as T;
  }

  // ---------------------------------------------------------------- models

  /** GET /v1/models: every model id your key can use, with its durations, ratios and resolutions. */
  async listModels(): Promise<SeedanceModelInfo[]> {
    const data = await this.json<{ models?: SeedanceModelInfo[] }>("/models", { method: "GET", headers: this.headers() });
    return data.models ?? [];
  }

  // --------------------------------------------------------------- uploads

  /**
   * Upload a local file (path) or bytes and return the upload id. Runs POST /v1/uploads,
   * a PUT of the bytes to direct_upload_url, then POST /v1/uploads/complete. Needs uploads:create.
   */
  async upload(source: string | UploadSource, options: { mimeType?: string } = {}): Promise<string> {
    let bytes: Uint8Array;
    let fileName: string;
    let mime: string | undefined = options.mimeType;
    if (typeof source === "string") {
      bytes = await readFile(source);
      fileName = basename(source);
    } else {
      const { data } = source;
      bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(await data.arrayBuffer());
      fileName = source.fileName;
      mime ??= source.mimeType ?? (typeof Blob !== "undefined" && data instanceof Blob && data.type ? data.type : undefined);
    }
    mime ??= MIME_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream";

    const created = await this.json<{
      upload_id?: string;
      uploadId?: string;
      direct_upload_url?: string;
      direct_upload_headers?: Record<string, string>;
    }>("/uploads", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ file_name: fileName, mime_type: mime, file_size: bytes.byteLength, upload_type: mediaKind(mime) }),
    });
    const uploadId = created.upload_id ?? created.uploadId;
    if (!uploadId || !created.direct_upload_url) {
      throw new SeedanceError("The upload answer had no upload id or upload URL.", { code: "upload_invalid_response" });
    }
    // The direct URL is pre-signed: send exactly the headers it came with, and no API key.
    const put = await this.fetchImpl(created.direct_upload_url, {
      method: "PUT",
      headers: created.direct_upload_headers ?? { "Content-Type": mime },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(this.downloadTimeoutMs),
    });
    if (!put.ok) {
      throw new SeedanceError(`Uploading the file failed with HTTP ${put.status}.`, { status: put.status, code: "upload_put_failed" });
    }
    const done = await this.json<{ upload_id?: string }>("/uploads/complete", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ upload_id: uploadId }),
    });
    return done.upload_id ?? uploadId;
  }

  /** Resolve a media input to { url } or { uploadId }, uploading local files first. */
  private async media(value: MediaInput | undefined): Promise<{ url?: string; uploadId?: string }> {
    if (value === undefined || value === null) return {};
    if (value instanceof URL) return { url: value.toString() };
    if (isUploadSource(value)) return { uploadId: await this.upload(value) };
    const text = String(value);
    if (/^https?:\/\//i.test(text)) return { url: text };
    if (text.startsWith("tos:")) return { uploadId: text };
    if (await isFile(text)) return { uploadId: await this.upload(text) };
    if (MIME_TYPES[extname(text).toLowerCase()]) {
      const error = new Error(`No such file: ${text}`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return { uploadId: text };
  }

  // ---------------------------------------------------------------- videos

  /** POST /v1/videos: start a Seedance video job and return it right away (HTTP 202). */
  async createVideo(prompt: string, options: CreateVideoOptions = {}): Promise<CreatedJob> {
    const body: Record<string, unknown> = {
      model: resolveModel(options.model ?? DEFAULT_MODEL),
      prompt,
      duration: options.duration ?? 5,
    };
    const resolution = options.resolution === undefined ? "720p" : options.resolution;
    if (resolution !== null) body.resolution = resolution;
    if (options.aspectRatio !== undefined) body.aspect_ratio = options.aspectRatio;
    if (options.generateAudio !== undefined) body.generate_audio = options.generateAudio;
    if (options.seed !== undefined) body.seed = options.seed;
    if (options.cameraFixed !== undefined) body.camera_fixed = options.cameraFixed;
    if (options.webhookUrl) body.webhook_url = options.webhookUrl;

    for (const [role, value] of [
      ["first_frame", options.firstFrame],
      ["last_frame", options.lastFrame],
    ] as const) {
      const resolved = await this.media(value);
      if (resolved.url) body[`${role}_url`] = resolved.url;
      if (resolved.uploadId) body[`${role}_upload_id`] = resolved.uploadId;
    }
    for (const [kind, values] of [
      ["image", options.referenceImages],
      ["video", options.referenceVideos],
      ["audio", options.referenceAudios],
    ] as const) {
      const urls: string[] = [];
      const ids: string[] = [];
      for (const value of values ?? []) {
        const resolved = await this.media(value);
        if (resolved.url) urls.push(resolved.url);
        if (resolved.uploadId) ids.push(resolved.uploadId);
      }
      if (urls.length) body[`reference_${kind}_urls`] = urls;
      if (ids.length) body[`reference_${kind}_upload_ids`] = ids;
    }
    Object.assign(body, options.extra ?? {});

    const data = await this.json<{
      job?: Job;
      quoted_token_cost?: number;
      estimated_token_cost?: number;
      balance_tokens?: number;
      idempotent_replay?: boolean;
    }>("/videos", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", "Idempotency-Key": options.idempotencyKey ?? randomUUID() }),
      body: JSON.stringify(body),
    });
    return {
      ...(data.job ?? ({} as Job)),
      quotedTokenCost: data.quoted_token_cost,
      estimatedTokenCost: data.estimated_token_cost,
      balanceTokens: data.balance_tokens,
      idempotentReplay: Boolean(data.idempotent_replay),
    } as CreatedJob;
  }

  /** GET /v1/jobs/{id}: the job's current status. Needs jobs:read. */
  async getJob(job: JobRef): Promise<Job> {
    const data = await this.json<{ job?: Job }>(`/jobs/${encodeURIComponent(jobId(job))}`, { method: "GET", headers: this.headers() });
    return data.job as Job;
  }

  /**
   * Poll a job until it reaches a final status (completed, failed, canceled or blocked) and return it.
   * Waits out 429 answers using Retry-After. Throws WaitTimeoutError after timeoutMs (the job keeps
   * running). Does not throw when the job fails: check job.status.
   */
  async wait(job: JobRef, options: WaitOptions = {}): Promise<Job> {
    const timeoutMs = options.timeoutMs ?? 30 * 60_000;
    const interval = options.pollIntervalMs ?? 10_000;
    let current = typeof job === "string" || !job.status ? await this.getJob(job) : job;
    const deadline = this.now() + timeoutMs;
    while (!TERMINAL_STATUSES.has(current.status)) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error("Aborted");
      if (this.now() >= deadline) throw new WaitTimeoutError(current, timeoutMs);
      await this.sleep(interval);
      current = await this.getJob(current.id);
      options.onUpdate?.(current);
    }
    return current;
  }

  /**
   * GET /v1/jobs/{id}/output: stream the finished file to `path` and return the path.
   * Defaults to "<job id>.mp4"; when `path` is a folder the file is saved there as "<job id>.mp4".
   */
  async download(job: JobRef, path?: string): Promise<string> {
    const id = jobId(job);
    let target = path ?? `${id}.mp4`;
    if (await isDirectory(target)) target = join(target, `${id}.mp4`);
    const response = await this.send(
      `/jobs/${encodeURIComponent(id)}/output`,
      { method: "GET", headers: this.headers({ Accept: "*/*" }) },
      this.downloadTimeoutMs,
    );
    if (!response.ok) throw await Seedance.toError(response);
    if (!response.body) throw new SeedanceError("The download had no body.", { status: response.status, code: "output_unavailable" });
    const partial = `${target}.part`;
    await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), createWriteStream(partial));
    await rename(partial, target);
    return target;
  }

  /** Create a video, wait for it, and (with `out`) save it. Throws JobFailedError if it does not complete. */
  async generate(prompt: string, options: GenerateOptions = {}): Promise<Job> {
    const { out, timeoutMs, pollIntervalMs, onUpdate, signal, ...create } = options;
    const created = await this.createVideo(prompt, create);
    onUpdate?.(created);
    const job = await this.wait(created, { timeoutMs, pollIntervalMs, onUpdate, signal });
    if (job.status !== "completed") throw new JobFailedError(job);
    if (out) await this.download(job, out);
    return job;
  }
}
