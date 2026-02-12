import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestDeviceCode,
  pollForDeviceCodeCompletion,
  exchangeDeviceCodeForTokens,
  refreshDeviceCodeTokens,
  runDeviceCodeLogin,
  AUTH_BASE_URL,
  CLIENT_ID,
  VERIFICATION_URL,
} from "../device-code-auth.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Suppress console.log in tests
vi.spyOn(console, "log").mockImplementation(() => {});

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestDeviceCode", () => {
  it("should request and return device code info", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_auth_id: "daid_123",
        user_code: "ABCD-1234",
        interval: "5",
      }),
    });

    const result = await requestDeviceCode();

    expect(mockFetch).toHaveBeenCalledWith(
      `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ client_id: CLIENT_ID }),
      }),
    );
    expect(result).toEqual({
      verificationUrl: VERIFICATION_URL,
      userCode: "ABCD-1234",
      deviceAuthId: "daid_123",
      interval: 5,
    });
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    await expect(requestDeviceCode()).rejects.toThrow("Failed to request device code: 500");
  });
});

describe("pollForDeviceCodeCompletion", () => {
  it("should retry on 403 and succeed", async () => {
    // First call: 403 (pending)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "pending",
    });
    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_code: "auth_code_123",
        code_challenge: "challenge_abc",
        code_verifier: "verifier_xyz",
      }),
    });

    const result = await pollForDeviceCodeCompletion("daid_123", "ABCD-1234", 1, 30000);

    expect(result).toEqual({
      authorizationCode: "auth_code_123",
      codeChallenge: "challenge_abc",
      codeVerifier: "verifier_xyz",
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should retry on 404 and succeed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_code: "code",
        code_challenge: "ch",
        code_verifier: "cv",
      }),
    });

    const result = await pollForDeviceCodeCompletion("d", "U", 1, 30000);
    expect(result.authorizationCode).toBe("code");
  });

  it("should throw on unexpected error status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "server error",
    });

    await expect(
      pollForDeviceCodeCompletion("d", "U", 1, 30000),
    ).rejects.toThrow("Unexpected polling response: 500");
  });

  it("should timeout after specified duration", async () => {
    // Always return 403
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "pending",
    });

    // Use a very short timeout and interval
    const promise = pollForDeviceCodeCompletion("d", "U", 1, 100);

    await expect(promise).rejects.toThrow("timed out");
  });
});

describe("exchangeDeviceCodeForTokens", () => {
  it("should exchange authorization code for tokens", async () => {
    const now = Date.now();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "at_123",
        refresh_token: "rt_456",
        id_token: "id_789",
        expires_in: 3600,
      }),
    });

    const result = await exchangeDeviceCodeForTokens("auth_code", "verifier");

    expect(mockFetch).toHaveBeenCalledWith(
      `${AUTH_BASE_URL}/oauth/token`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          code: "auth_code",
          code_verifier: "verifier",
          redirect_uri: `${AUTH_BASE_URL}/deviceauth/callback`,
        }),
      }),
    );
    expect(result.accessToken).toBe("at_123");
    expect(result.refreshToken).toBe("rt_456");
    expect(result.idToken).toBe("id_789");
    expect(result.expiresAt).toBeGreaterThanOrEqual(now + 3600 * 1000 - 1000);
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(
      exchangeDeviceCodeForTokens("bad", "bad"),
    ).rejects.toThrow("Failed to exchange code for tokens: 400");
  });
});

describe("refreshDeviceCodeTokens", () => {
  it("should refresh tokens using refresh_token grant", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new_at",
        refresh_token: "new_rt",
        id_token: "new_id",
        expires_in: 3600,
      }),
    });

    const result = await refreshDeviceCodeTokens("old_rt");

    expect(mockFetch).toHaveBeenCalledWith(
      `${AUTH_BASE_URL}/oauth/token`,
      expect.objectContaining({
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: "old_rt",
        }),
      }),
    );
    expect(result.accessToken).toBe("new_at");
    expect(result.refreshToken).toBe("new_rt");
  });

  it("should throw on HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(refreshDeviceCodeTokens("bad_rt")).rejects.toThrow(
      "Failed to refresh token: 401",
    );
  });
});

describe("runDeviceCodeLogin (end-to-end)", () => {
  it("should run the complete flow", async () => {
    // Step 1: request device code
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_auth_id: "daid_e2e",
        user_code: "TEST-CODE",
        interval: "1",
      }),
    });

    // Step 3: poll — first pending, then success
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "pending",
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_code: "auth_e2e",
        code_challenge: "ch_e2e",
        code_verifier: "cv_e2e",
      }),
    });

    // Step 4: exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "final_at",
        refresh_token: "final_rt",
        id_token: "final_id",
        expires_in: 3600,
      }),
    });

    const tokens = await runDeviceCodeLogin();

    expect(tokens.accessToken).toBe("final_at");
    expect(tokens.refreshToken).toBe("final_rt");
    expect(tokens.idToken).toBe("final_id");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
