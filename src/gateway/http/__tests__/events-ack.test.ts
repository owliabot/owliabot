/**
 * Tests for event polling with ACK mechanism
 *
 * @see docs/plans/gateway-unification.md Section 2.4
 */

import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";
import { testConfig, createMockResources } from "./test-helpers.js";

describe("events/poll ACK mechanism", () => {
  it("returns events for a device", async () => {
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
        deviceId: "dev-events",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Make a tool call to generate an event
    await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev-events",
        "X-Device-Token": data.deviceToken,
      },
      body: JSON.stringify({
        payload: {
          toolCalls: [{ id: "1", name: "test_read", arguments: {} }],
        },
      }),
    });

    // Poll events
    const res = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-events",
        "X-Device-Token": data.deviceToken,
      },
    });

    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(typeof json.cursor).toBe("number");
    expect(Array.isArray(json.events)).toBe(true);

    await server.stop();
  });

  it("acknowledges events with ack parameter", async () => {
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
        deviceId: "dev-ack",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Use channel to push an event directly
    server.channel.send("dev-ack", { text: "Test message 1" });
    server.channel.send("dev-ack", { text: "Test message 2" });

    // Wait for events to be stored
    await new Promise((r) => setTimeout(r, 50));

    // First poll - should get events
    const poll1 = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-ack",
        "X-Device-Token": data.deviceToken,
      },
    });
    const json1: any = await poll1.json();
    expect(json1.events.length).toBeGreaterThan(0);
    const lastEventId = json1.cursor;

    // Second poll with ACK - should mark events as acknowledged
    const poll2 = await fetch(
      server.baseUrl + `/events/poll?ack=${lastEventId}`,
      {
        headers: {
          "X-Device-Id": "dev-ack",
          "X-Device-Token": data.deviceToken,
        },
      }
    );
    const json2: any = await poll2.json();
    expect(json2.ok).toBe(true);

    // Third poll without since - acked events should not reappear
    const poll3 = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-ack",
        "X-Device-Token": data.deviceToken,
      },
    });
    const json3: any = await poll3.json();
    // After ACK, the same events should not be returned
    const ackedIds = json1.events.map((e: any) => e.id);
    const newEvents = json3.events.filter((e: any) => !ackedIds.includes(e.id));
    expect(newEvents.length).toBe(0);

    await server.stop();
  });

  it("supports since parameter for cursor-based polling", async () => {
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
        deviceId: "dev-cursor",
        scope: { tools: "read", system: false, mcp: false },
      }),
    });
    const { data }: any = await approve.json();

    // Push events via channel
    await server.channel.send("dev-cursor", { text: "Event 1" });
    await new Promise((r) => setTimeout(r, 10));

    // Poll and get cursor
    const poll1 = await fetch(server.baseUrl + "/events/poll", {
      headers: {
        "X-Device-Id": "dev-cursor",
        "X-Device-Token": data.deviceToken,
      },
    });
    const json1: any = await poll1.json();
    const cursor = json1.cursor;

    // Push more events
    await server.channel.send("dev-cursor", { text: "Event 2" });
    await new Promise((r) => setTimeout(r, 10));

    // Poll with since=cursor - should only get new events
    const poll2 = await fetch(
      server.baseUrl + `/events/poll?since=${cursor}`,
      {
        headers: {
          "X-Device-Id": "dev-cursor",
          "X-Device-Token": data.deviceToken,
        },
      }
    );
    const json2: any = await poll2.json();
    expect(json2.ok).toBe(true);
    // New events should have id > cursor
    for (const event of json2.events) {
      expect(event.id).toBeGreaterThan(cursor);
    }

    await server.stop();
  });
});
