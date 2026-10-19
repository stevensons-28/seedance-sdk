import type { JobStatus, SeedanceModel } from "./models.js";

/** A video job, as returned by POST /v1/videos and GET /v1/jobs/{id}. Field names are the API's own. */
export interface Job {
  id: string;
  status: JobStatus | (string & {});
  mediaType?: string;
  modelId?: string;
  prompt?: string | null;
  resolution?: string;
  /** The authenticated download link (/v1/jobs/{id}/output) once the job is completed. */
  providerOutputUrl?: string | null;
  providerOutputExpiresAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  warnings?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  [field: string]: unknown;
}

/** What createVideo returns: the job plus the quote and balance from the create answer. */
export interface CreatedJob extends Job {
  /** Token cost quoted for this job. */
  quotedTokenCost?: number;
  estimatedTokenCost?: number;
  /** Token balance right after the call. */
  balanceTokens?: number;
  /** True when the API returned an existing job for the same Idempotency-Key. */
  idempotentReplay: boolean;
}

/** An https URL, an upload id, a local file path (uploaded for you), or bytes to upload. */
export type MediaInput = string | URL | UploadSource;

export interface UploadSource {
  data: Uint8Array | ArrayBuffer | Blob;
  fileName: string;
  mimeType?: string;
}

export interface CreateVideoOptions {
  /** "seedance-2.0" (default), "seedance-2.5", "seedance-2.0-fast", "seedance-2.0-mini", or any KreatorFlow model id. */
  model?: SeedanceModel;
  /** Length in seconds (default 5). Each model accepts a fixed list. */
  duration?: number;
  /** "480p", "720p" (default), "1080p" or "4k" where the model offers it. Pass null to use the model default. */
  resolution?: string | null;
  /** For example "16:9", "9:16", "1:1" or "adaptive". Leave out for the model default. */
  aspectRatio?: string;
  generateAudio?: boolean;
  seed?: number;
  cameraFixed?: boolean;
  /** First frame image. */
  firstFrame?: MediaInput;
  /** Last frame image. */
  lastFrame?: MediaInput;
  /** Images that guide the look. Cannot be mixed with frame images in one job. */
  referenceImages?: MediaInput[];
  referenceVideos?: MediaInput[];
  referenceAudios?: MediaInput[];
  /** https URL that receives a signed POST when the job finishes. */
  webhookUrl?: string;
  /** Sent as the Idempotency-Key header. A new UUID is used when left out. Reuse it when you resend the same request. */
  idempotencyKey?: string;
  /** Any other request fields, sent as is. */
  extra?: Record<string, unknown>;
}

export interface WaitOptions {
  /** Milliseconds before WaitTimeoutError (default 30 minutes). */
  timeoutMs?: number;
  /** Milliseconds between polls (default 10 seconds). */
  pollIntervalMs?: number;
  onUpdate?: (job: Job) => void;
  signal?: AbortSignal;
}

export interface GenerateOptions extends CreateVideoOptions, WaitOptions {
  /** Save the finished video here. */
  out?: string;
}

export interface SeedanceModelInfo {
  id: string;
  name?: string;
  mediaType?: string;
  actualModelName?: string;
  limits?: {
    durations?: number[];
    aspectRatios?: string[];
    resolutions?: string[];
    maxImageReferences?: number;
    maxVideoReferences?: number;
    maxAudioReferences?: number;
  };
  [field: string]: unknown;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SeedanceOptions {
  /** Defaults to process.env.KREATORFLOW_API_KEY. */
  apiKey?: string;
  /** API root, https://kreatorflow.ai/v1 by default (or KREATORFLOW_BASE_URL). */
  baseUrl?: string;
  /** Milliseconds per request (default 60 s). Downloads use downloadTimeoutMs. */
  timeoutMs?: number;
  downloadTimeoutMs?: number;
  /** How many times to wait out a 429 answer using Retry-After (default 3). */
  maxRetries?: number;
  /** A custom fetch (default: the global fetch of Node 18+). */
  fetch?: FetchLike;
}
