/**
 * Seedance Node.js SDK: an unofficial client for ByteDance's Seedance video models through the
 * KreatorFlow API. Docs: https://kreatorflow.ai/seedance-api/reference
 */
export { Seedance, DEFAULT_BASE_URL, KEYS_URL } from "./client.js";
export {
  SeedanceError,
  AuthenticationError,
  InsufficientBalanceError,
  RateLimitError,
  JobFailedError,
  WaitTimeoutError,
  WebhookVerificationError,
  type SeedanceErrorOptions,
} from "./errors.js";
export {
  MODEL_ALIASES,
  DEFAULT_MODEL,
  JOB_STATUSES,
  TERMINAL_STATUSES,
  resolveModel,
  type JobStatus,
  type SeedanceModel,
  type SeedanceModelName,
} from "./models.js";
export { verifyWebhook, computeSignature, SIGNATURE_HEADER, type WebhookEvent, type WebhookHeaders, type VerifyWebhookOptions } from "./webhooks.js";
export type {
  Job,
  CreatedJob,
  CreateVideoOptions,
  WaitOptions,
  GenerateOptions,
  MediaInput,
  UploadSource,
  SeedanceModelInfo,
  SeedanceOptions,
  FetchLike,
} from "./types.js";
export { VERSION } from "./version.js";
