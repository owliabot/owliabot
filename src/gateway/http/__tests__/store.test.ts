import { describe, it, expect } from "vitest";
import { createStore } from "../store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

function dbPath(name: string) {
  return join(tmpdir(), `gw-${Date.now()}-${name}.db`);
}

describe("gateway store", () => {
  it("stores and retrieves devices", () => {
    const store = createStore(dbPath("devices"));
    store.addPending("dev1", "1.2.3.4", "ua");
    const token = store.approveDevice("dev1");
    const device = store.getDevice("dev1");
    expect(device?.tokenHash).toBeTruthy();
    expect(token).toBeTruthy();
  });

  it("supports idempotency cache", () => {
    const store = createStore(dbPath("idem"));
    store.saveIdempotency("k", "h", { ok: true }, Date.now() + 1000);
    const hit = store.getIdempotency("k");
    expect(hit?.requestHash).toBe("h");
  });
});
