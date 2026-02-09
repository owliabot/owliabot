/**
 * Tests for admin routes
 *
 * @see docs/plans/gateway-unification.md Phase 2
 */

import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("admin routes", () => {
  describe("/admin/devices", () => {
    it("lists all devices with scope info", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve a device
      await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-list",
          scope: { tools: "write", system: true, mcp: false },
        }),
      });

      // List devices
      const res = await fetch(server.baseUrl + "/admin/devices", {
        headers: { "X-Gateway-Token": "gw" },
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data.devices)).toBe(true);

      const device = json.data.devices.find((d: any) => d.deviceId === "dev-list");
      expect(device).toBeDefined();
      expect(device.scope.tools).toBe("write");
      expect(device.scope.system).toBe(true);
      expect(device.scope.mcp).toBe(false);

      await server.stop();
    });

    it("requires gateway token", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      const res = await fetch(server.baseUrl + "/admin/devices");
      expect(res.status).toBe(401);

      await server.stop();
    });
  });

  describe("/admin/scope", () => {
    it("updates device scope", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device with default scope
      await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-scope-update" }),
      });

      // Update scope
      const res = await fetch(server.baseUrl + "/admin/scope", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-scope-update",
          scope: { tools: "sign", system: true, mcp: true },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.scope.tools).toBe("sign");
      expect(json.data.scope.system).toBe(true);
      expect(json.data.scope.mcp).toBe(true);

      // Verify by listing
      const list = await fetch(server.baseUrl + "/admin/devices", {
        headers: { "X-Gateway-Token": "gw" },
      });
      const listJson: any = await list.json();
      const device = listJson.data.devices.find(
        (d: any) => d.deviceId === "dev-scope-update"
      );
      expect(device.scope.tools).toBe("sign");

      await server.stop();
    });

    it("returns 404 for non-existent device", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      const res = await fetch(server.baseUrl + "/admin/scope", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-nonexistent",
          scope: { tools: "read", system: false, mcp: false },
        }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(404);
      expect(json.error.code).toBe("ERR_NOT_FOUND");

      await server.stop();
    });

    it("returns 400 for invalid scope format", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device
      await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-invalid-scope" }),
      });

      // Try invalid scope
      const res = await fetch(server.baseUrl + "/admin/scope", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({
          deviceId: "dev-invalid-scope",
          scope: { tools: "invalid-level" },
        }),
      });

      expect(res.status).toBe(400);

      await server.stop();
    });
  });

  describe("/admin/rotate-token", () => {
    it("rotates device token", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-rotate" }),
      });
      const { data: approveData }: any = await approve.json();
      const oldToken = approveData.deviceToken;

      // Rotate token
      const res = await fetch(server.baseUrl + "/admin/rotate-token", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-rotate" }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.deviceToken).toBeDefined();
      expect(json.data.deviceToken).not.toBe(oldToken);

      // Old token should no longer work
      const oldTokenRes = await fetch(server.baseUrl + "/events/poll", {
        headers: {
          "X-Device-Id": "dev-rotate",
          "X-Device-Token": oldToken,
        },
      });
      expect(oldTokenRes.status).toBe(401);

      // New token should work
      const newTokenRes = await fetch(server.baseUrl + "/events/poll", {
        headers: {
          "X-Device-Id": "dev-rotate",
          "X-Device-Token": json.data.deviceToken,
        },
      });
      expect(newTokenRes.status).toBe(200);

      await server.stop();
    });

    it("returns 404 for non-existent device", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      const res = await fetch(server.baseUrl + "/admin/rotate-token", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-nonexistent" }),
      });

      const json: any = await res.json();
      expect(res.status).toBe(404);
      expect(json.error.code).toBe("ERR_NOT_FOUND");

      await server.stop();
    });
  });

  describe("/admin/reject", () => {
    it("removes pending device", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Request pairing
      await fetch(server.baseUrl + "/pair/request", {
        method: "POST",
        headers: { "X-Device-Id": "dev-reject" },
      });

      // Verify pending
      const pending1 = await fetch(server.baseUrl + "/admin/pending", {
        headers: { "X-Gateway-Token": "gw" },
      });
      const pending1Json: any = await pending1.json();
      expect(pending1Json.data.pending.some((p: any) => p.deviceId === "dev-reject")).toBe(true);

      // Reject
      const res = await fetch(server.baseUrl + "/admin/reject", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-reject" }),
      });
      expect(res.status).toBe(200);

      // Verify removed
      const pending2 = await fetch(server.baseUrl + "/admin/pending", {
        headers: { "X-Gateway-Token": "gw" },
      });
      const pending2Json: any = await pending2.json();
      expect(pending2Json.data.pending.some((p: any) => p.deviceId === "dev-reject")).toBe(false);

      await server.stop();
    });
  });

  describe("/admin/revoke", () => {
    it("revokes a paired device", async () => {
      const resources = createMockResources();
      const server = await startGatewayHttp({
        config: testConfig,
        ...resources,
      });

      // Approve device
      const approve = await fetch(server.baseUrl + "/admin/approve", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-revoke" }),
      });
      const { data }: any = await approve.json();

      // Token should work before revoke
      const before = await fetch(server.baseUrl + "/events/poll", {
        headers: {
          "X-Device-Id": "dev-revoke",
          "X-Device-Token": data.deviceToken,
        },
      });
      expect(before.status).toBe(200);

      // Revoke
      await fetch(server.baseUrl + "/admin/revoke", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
        body: JSON.stringify({ deviceId: "dev-revoke" }),
      });

      // Token should not work after revoke
      const after = await fetch(server.baseUrl + "/events/poll", {
        headers: {
          "X-Device-Id": "dev-revoke",
          "X-Device-Token": data.deviceToken,
        },
      });
      expect(after.status).toBe(401);

      await server.stop();
    });
  });
});
