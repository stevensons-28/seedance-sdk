import type { Job } from "./types.js";

export interface SeedanceErrorOptions {
  status?: number;
  code?: string;
  data?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * An error answer from the KreatorFlow API. Every API error is JSON with `success: false`,
 * a machine-readable `code` and a readable `error`. Branch on `code`, never on the message.
 */
export class SeedanceError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly data: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(message: string, options: SeedanceErrorOptions = {}) {
    super(options.status ? `${options.status} ${options.code}: ${message}` : message);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.data = options.data ?? {};
    this.headers = options.headers ?? {};
  }
}

/** The API key is missing, invalid, or lacks a scope. */
export class AuthenticationError extends SeedanceError {}

/** Too few tokens for this job (`insufficient_balance`, HTTP 402). */
export class InsufficientBalanceError extends SeedanceError {}

/** Too many requests (HTTP 429). `retryAfter` is the wait the API asked for, in seconds. */
export class RateLimitError extends SeedanceError {
  readonly retryAfter?: number;
  constructor(message: string, options: SeedanceErrorOptions & { retryAfter?: number } = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** A job ended as failed, canceled or blocked. The job is on `job`. */
export class JobFailedError extends SeedanceError {
  readonly job: Job;
  constructor(job: Job) {
    super(job.errorMessage ?? `Job ${job.id} ended with status ${job.status}.`, { code: job.errorCode ?? job.status });
    this.job = job;
  }
}

/** `wait()` gave up before the job reached a final status. The job keeps running. */
export class WaitTimeoutError extends SeedanceError {
  readonly job: Job;
  constructor(job: Job, timeoutMs: number) {
    super(`Job ${job.id} is still ${job.status} after ${Math.round(timeoutMs / 1000)} seconds.`, { code: "wait_timeout" });
    this.job = job;
  }
}

/** A webhook failed signature or timestamp checks. Answer it with HTTP 401 or 400. */
export class WebhookVerificationError extends SeedanceError {}
