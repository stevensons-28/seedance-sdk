// The CommonJS build loads with require() and exposes the same API.
const assert = require("node:assert/strict");
const { test } = require("node:test");

test("require('seedance-sdk') works", () => {
  const sdk = require("../dist/index.cjs");
  assert.equal(typeof sdk.Seedance, "function");
  assert.equal(typeof sdk.verifyWebhook, "function");
  assert.equal(sdk.resolveModel("seedance-2.0"), "kreator-video-seedance-2");
  const client = new sdk.Seedance({ apiKey: "kf_test", fetch: async () => new Response() });
  assert.equal(client.baseUrl, "https://kreatorflow.ai/v1");
});
