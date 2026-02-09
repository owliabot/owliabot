/**
 * Tests for API Key Management (Phase 3.1)
 */

import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("API Key Management", () => {
  // Helper to create a server
  async function setup() {
    const resources = createMockResources();
    const server = await startGatewayHttp({ config: testConfig, ...resources });
    return server;
  }

  describe("Admin routes", () => {
    it("POST /admin/api-keys creates a key", async () => {
      const server = await setup();
      const res = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "test-key", scope: { tools: "read", system: false, mcp: false } }),
      });
      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.id).toMatch(/^ak_/);
      expect(json.data.key).toMatch(/^owk_/);
      expect(json.data.key).toHaveLength(4 + 32); // owk_ + 32 hex
      expect(json.data.scope.tools).toBe("read");
      await server.stop();
    });

    it("GET /admin/api-keys lists keys without hash", async () => {
      const server = await setup();
      // Create a key
      await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "list-test" }),
      });
      const res = await fetch(server.baseUrl + "/admin/api-keys", {
        headers: { "X-Gateway-Token": "gw" },
      });
      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.keys.length).toBeGreaterThanOrEqual(1);
      const key = json.data.keys.find((k: any) => k.name === "list-test");
      expect(key).toBeDefined();
      expect(key.id).toMatch(/^ak_/);
      // Should NOT contain key_hash
      expect((key as any).key_hash).toBeUndefined();
      expect((key as any).keyHash).toBeUndefined();
      await server.stop();
    });

    it("DELETE /admin/api-keys/:id revokes a key", async () => {
      const server = await setup();
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "revoke-test" }),
      });
      const { data } = (await createRes.json()) as any;

      const delRes = await fetch(server.baseUrl + `/admin/api-keys/${data.id}`, {
        method: "DELETE",
        headers: { "X-Gateway-Token": "gw" },
      });
      expect(delRes.status).toBe(200);

      // Revoking again should 404
      const delRes2 = await fetch(server.baseUrl + `/admin/api-keys/${data.id}`, {
        method: "DELETE",
        headers: { "X-Gateway-Token": "gw" },
      });
      expect(delRes2.status).toBe(404);
      await server.stop();
    });

    it("admin routes require gateway token", async () => {
      const server = await setup();
      const res1 = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "no-auth" }),
      });
      expect(res1.status).toBe(401);

      const res2 = await fetch(server.baseUrl + "/admin/api-keys");
      expect(res2.status).toBe(401);

      const res3 = await fetch(server.baseUrl + "/admin/api-keys/fake", {
        method: "DELETE",
      });
      expect(res3.status).toBe(401);
      await server.stop();
    });
  });

  describe("API key auth on device routes", () => {
    it("can use API key on /command/tool", async () => {
      const server = await setup();
      // Create key with read scope
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "tool-test", scope: { tools: "read", system: false, mcp: false } }),
      });
      const { data } = (await createRes.json()) as any;

      // Use API key to call /command/tool
      const toolRes = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${data.key}`,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
          },
        }),
      });
      const toolJson: any = await toolRes.json();
      expect(toolRes.status).toBe(200);
      expect(toolJson.ok).toBe(true);
      expect(toolJson.data.results[0].success).toBe(true);
      await server.stop();
    });

    it("revoked key returns 401", async () => {
      const server = await setup();
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "revoke-auth-test" }),
      });
      const { data } = (await createRes.json()) as any;

      // Revoke
      await fetch(server.baseUrl + `/admin/api-keys/${data.id}`, {
        method: "DELETE",
        headers: { "X-Gateway-Token": "gw" },
      });

      // Try using revoked key
      const toolRes = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${data.key}`,
        },
        body: JSON.stringify({
          payload: { toolCalls: [{ id: "1", name: "test_read", arguments: {} }] },
        }),
      });
      expect(toolRes.status).toBe(401);
      await server.stop();
    });

    it("expired key returns 401", async () => {
      const server = await setup();
      // Create key that already expired
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          name: "expired-test",
          expiresAt: Date.now() - 1000, // already expired
        }),
      });
      const { data } = (await createRes.json()) as any;

      const toolRes = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${data.key}`,
        },
        body: JSON.stringify({
          payload: { toolCalls: [{ id: "1", name: "test_read", arguments: {} }] },
        }),
      });
      expect(toolRes.status).toBe(401);
      await server.stop();
    });

    it("scope enforcement: read key cannot call write tools", async () => {
      const server = await setup();
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          name: "read-only",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });
      const { data } = (await createRes.json()) as any;

      // Try calling a write tool
      const toolRes = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${data.key}`,
        },
        body: JSON.stringify({
          payload: {
            toolCalls: [{ id: "1", name: "edit_file", arguments: { path: "x", content: "y" } }],
          },
        }),
      });
      expect(toolRes.status).toBe(403);
      await server.stop();
    });

    it("API key works on /events/poll", async () => {
      const server = await setup();
      const createRes = await fetch(server.baseUrl + "/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ name: "poll-test" }),
      });
      const { data } = (await createRes.json()) as any;

      const pollRes = await fetch(server.baseUrl + "/events/poll", {
        headers: { "Authorization": `Bearer ${data.key}` },
      });
      expect(pollRes.status).toBe(200);
      const json: any = await pollRes.json();
      expect(json.ok).toBe(true);
      await server.stop();
    });

    it("invalid API key returns 401", async () => {
      const server = await setup();
      const toolRes = await fetch(server.baseUrl + "/command/tool", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": "Bearer owk_0000000000000000000000000000dead",
        },
        body: JSON.stringify({
          payload: { toolCalls: [{ id: "1", name: "test_read", arguments: {} }] },
        }),
      });
      expect(toolRes.status).toBe(401);
      await server.stop();
    });
  });
});
