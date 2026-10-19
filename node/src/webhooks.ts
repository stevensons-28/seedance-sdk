import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { Job } from "./types.js";

/**
 * KreatorFlow signs each webhook with X-KreatorFlow-Signature: "t=<unix seconds>,v1=<hex>",
 * where <hex> is HMAC-SHA256 of "<t>.<raw body>" keyed with your webhook signing secret.
 * The other headers are X-KreatorFlow-Event-Id, -Event-Type, -Job-Id and -Timestamp.
 */
export const SIGNATURE_HEADER = "x-kreatorflow-signature";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface WebhookEvent {
  object: "kreatorflow.developer_webhook_event" | (string & {});
  id: string;
  type: "job.completed" | "job.failed" | "job.canceled" | "job.blocked" | (string & {});
  created: string;
  data: { job: Job };
}

export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

export interface VerifyWebhookOptions {
  /** Largest accepted gap in seconds between the signed time and now (default 300). null turns it off. */
  tolerance?: number | null;
  /** Current time in seconds, for tests. */
  now?: number;
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function toBuffer(payload: string | Uint8Array | ArrayBuffer): Buffer {
  if (typeof payload === "string") return Buffer.from(payload, "utf8");
  return Buffer.from(payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload);
}

/** The hex v1 signature for a raw body and timestamp. */
export function computeSignature(payload: string | Uint8Array | ArrayBuffer, timestamp: number | string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(toBuffer(payload)).digest("hex");
}

/**
 * Check a webhook's signature and age, then return the parsed event. `payload` must be the raw
 * body exactly as received, before JSON parsing. Throws WebhookVerificationError on failure.
 */
export function verifyWebhook(
  payload: string | Uint8Array | ArrayBuffer,
  headers: WebhookHeaders,
  secret: string,
  options: VerifyWebhookOptions = {},
): WebhookEvent {
  if (!secret) throw new WebhookVerificationError("A webhook signing secret is required.", { code: "webhook_secret_missing" });

  const header = readHeader(headers, SIGNATURE_HEADER);
  if (!header) throw new WebhookVerificationError("Missing X-KreatorFlow-Signature header.", { code: "webhook_signature_missing" });

  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at > 0) {
      const key = piece.slice(0, at).trim();
      if (!(key in parts)) parts[key] = piece.slice(at + 1).trim();
    }
  }
  const { t, v1 } = parts;
  if (!t || !v1) throw new WebhookVerificationError("Malformed X-KreatorFlow-Signature header.", { code: "webhook_signature_malformed" });
  if (!/^\d+$/.test(t)) throw new WebhookVerificationError("Webhook timestamp is not a number.", { code: "webhook_signature_malformed" });

  const expected = Buffer.from(computeSignature(payload, t, secret), "utf8");
  const given = Buffer.from(v1, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new WebhookVerificationError("Webhook signature does not match.", { code: "webhook_signature_invalid" });
  }

  const tolerance = options.tolerance === undefined ? DEFAULT_TOLERANCE_SECONDS : options.tolerance;
  if (tolerance !== null) {
    const now = options.now ?? Date.now() / 1000;
    if (Math.abs(now - Number(t)) > tolerance) {
      throw new WebhookVerificationError("Webhook timestamp is too old or in the future.", { code: "webhook_timestamp_expired" });
    }
  }

  let event: unknown;
  try {
    event = JSON.parse(toBuffer(payload).toString("utf8"));
  } catch {
    throw new WebhookVerificationError("Webhook body is not valid JSON.", { code: "webhook_body_invalid" });
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new WebhookVerificationError("Webhook body is not a JSON object.", { code: "webhook_body_invalid" });
  }
  return event as WebhookEvent;
}
