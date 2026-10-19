// Webhook tests. The signing below mirrors the KreatorFlow server exactly:
// createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"), sent as "t=<ts>,v1=<hex>".
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { WebhookVerificationError, computeSignature, verifyWebhook } from "../dist/index.js";

const SECRET = "whsec_test_secret";
const NOW = 1_760_000_000;
const EVENT = {
  object: "kreatorflow.developer_webhook_event",
  id: "evt_3f1c0a9e1b2c4d3e8f40123456789abc_completed",
  type: "job.completed",
  created: "2026-10-19T10:00:00.000Z",
  data: { job: { id: "3f1c0a9e-1b2c-4d3e-8f40-123456789abc", status: "completed" } },
};

function signed(event = EVENT, secret = SECRET, timestamp = NOW) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-kreatorflow-event-id": event.id,
      "x-kreatorflow-event-type": event.type,
      "x-kreatorflow-job-id": event.data.job.id,
      "x-kreatorflow-timestamp": String(timestamp),
      "x-kreatorflow-signature": `t=${timestamp},v1=${signature}`,
    },
  };
}

describe("verifyWebhook", () => {
  it("accepts a valid signature and returns the event", () => {
    const { body, headers } = signed();
    const event = verifyWebhook(body, headers, SECRET, { now: NOW + 10 });
    assert.equal(event.type, "job.completed");
    assert.equal(event.data.job.status, "completed");
  });

  it("accepts a Buffer body and a Headers object with mixed case", () => {
    const { body, headers } = signed();
    const h = new Headers({ "X-KreatorFlow-Signature": headers["x-kreatorflow-signature"] });
    assert.equal(verifyWebhook(Buffer.from(body), h, SECRET, { now: NOW }).id, EVENT.id);
    assert.equal(verifyWebhook(body, { "X-KreatorFlow-Signature": headers["x-kreatorflow-signature"] }, SECRET, { now: NOW }).id, EVENT.id);
  });

  it("computeSignature matches the server", () => {
    const { body, headers } = signed();
    assert.ok(headers["x-kreatorflow-signature"].endsWith(`v1=${computeSignature(body, NOW, SECRET)}`));
  });

  it("rejects a tampered body", () => {
    const { body, headers } = signed();
    assert.throws(() => verifyWebhook(body.replace("completed", "failed"), headers, SECRET, { now: NOW }), (e) => e instanceof WebhookVerificationError && e.code === "webhook_signature_invalid");
  });

  it("rejects the wrong secret", () => {
    const { body, headers } = signed(EVENT, "other");
    assert.throws(() => verifyWebhook(body, headers, SECRET, { now: NOW }), WebhookVerificationError);
  });

  it("rejects an old timestamp unless tolerance is off", () => {
    const { body, headers } = signed();
    assert.throws(() => verifyWebhook(body, headers, SECRET, { now: NOW + 301 }), (e) => e.code === "webhook_timestamp_expired");
    assert.equal(verifyWebhook(body, headers, SECRET, { now: NOW + 301, tolerance: null }).id, EVENT.id);
  });

  it("rejects missing or malformed headers", () => {
    const { body } = signed();
    assert.throws(() => verifyWebhook(body, {}, SECRET, { now: NOW }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(body, { "x-kreatorflow-signature": "garbage" }, SECRET, { now: NOW }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(body, { "x-kreatorflow-signature": "t=abc,v1=00" }, SECRET, { now: NOW }), WebhookVerificationError);
    assert.throws(() => verifyWebhook(body, { "x-kreatorflow-signature": `t=${NOW},v1=short` }, SECRET, { now: NOW }), WebhookVerificationError);
  });
});
