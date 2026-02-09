/**
 * Tests for HTTP Channel Plugin
 *
 * @see docs/plans/gateway-unification.md Phase 2
 */

import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("HTTP Channel Plugin", () => {
  it("has correct channel id", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    expect(server.channel.id).toBe("http");

    await server.stop();
  });

  it("has appropriate capabilities", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    expect(server.channel.capabilities.reactions).toBe(false);
    expect(server.channel.capabilities.threads).toBe(false);
    expect(server.channel.capabilities.buttons).toBe(false);
    expect(server.channel.capabilities.markdown).toBe(false);
    expect(server.channel.capabilities.maxMessageLength).toBe(1_000_000);

    await server.stop();
  });

  it("start/stop are no-ops", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // These should not throw
    await server.channel.start();
    await server.channel.stop();

    await server.stop();
  });

  it("send() pushes events to store", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({
        deviceId: "dev-channel",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Send message via channel
    await server.channel.send("dev-channel", { text: "Hello from gateway!" });

    // Wait for event to be stored
    await new Promise((r) => setTimeout(r, 50));

    // Poll events
    const res = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-channel",
        "X-Device-Token": data.deviceToken,
      },
    });

    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.events.length).toBeGreaterThan(0);

    // Find the message event
    const messageEvent = json.events.find(
      (e: any) => e.type === "message" && e.message === "Hello from gateway!"
    );
    expect(messageEvent).toBeDefined();
    expect(messageEvent.source).toBe("gateway");

    await server.stop();
  });

  it("send() includes replyToId in metadata", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({
        deviceId: "dev-reply",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Send message with replyToId
    await server.channel.send("dev-reply", {
      text: "Reply message",
      replyToId: "original-msg-123",
    });

    await new Promise((r) => setTimeout(r, 50));

    // Poll events
    const res = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-reply",
        "X-Device-Token": data.deviceToken,
      },
    });

    const json: any = await res.json();
    const messageEvent = json.events.find(
      (e: any) => e.type === "message" && e.message === "Reply message"
    );
    expect(messageEvent).toBeDefined();

    // Check metadata
    const metadata = JSON.parse(messageEvent.metadataJson);
    expect(metadata.replyToId).toBe("original-msg-123");

    await server.stop();
  });

  it("send() includes buttons in metadata", async () => {
    const resources = createMockResources();
    const server = await startGatewayHttp({
      config: testConfig,
      ...resources,
    });

    // Approve device
    const approve = await fetch(server.baseUrl + "/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({
        deviceId: "dev-buttons",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Send message with buttons
    await server.channel.send("dev-buttons", {
      text: "Choose an option:",
      buttons: [
        { text: "Option A", callbackData: "opt_a" },
        { text: "Option B", callbackData: "opt_b" },
      ],
    });

    await new Promise((r) => setTimeout(r, 50));

    // Poll events
    const res = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-buttons",
        "X-Device-Token": data.deviceToken,
      },
    });

    const json: any = await res.json();
    const messageEvent = json.events.find(
      (e: any) => e.type === "message" && e.message === "Choose an option:"
    );
    expect(messageEvent).toBeDefined();

    // Check metadata
    const metadata = JSON.parse(messageEvent.metadataJson);
    expect(metadata.buttons).toHaveLength(2);
    expect(metadata.buttons[0].text).toBe("Option A");
    expect(metadata.buttons[1].callbackData).toBe("opt_b");

    await server.stop();
  });
});
