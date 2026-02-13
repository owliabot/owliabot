import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AUTH_BASE_URL,
  CLIENT_ID,
  VERIFICATION_URL,
  requestDeviceCode,
  pollForDeviceCodeCompletion,
  exchangeDeviceCodeForTokens,
  refreshDeviceCodeTokens,
  runDeviceCodeLogin,
} from "../device-code-auth.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => mockLogger,
}));

function createMockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    headers: new Headers(),
    redirected: false,
    type: "basic",
    url: "https://auth.openai.com",
    clone: () => createMockResponse(body, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    bytes: async () => new Uint8Array(),
  } as Response;
}
let priorDeviceCodeOnly: string | undefined;

describe("device-code-auth", () => {
  beforeEach(() => {
    priorDeviceCodeOnly = process.env.OWLIABOT_OAUTH_DEVICE_CODE_ONLY;
    vi.clearAllMocks();
    mockFetch.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (priorDeviceCodeOnly === undefined) {
      delete process.env.OWLIABOT_OAUTH_DEVICE_CODE_ONLY;
    } else {
      process.env.OWLIABOT_OAUTH_DEVICE_CODE_ONLY = priorDeviceCodeOnly;
    }
  });

  describe("requestDeviceCode", () => {
    it("requests user code and maps response", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          device_auth_id: "device-auth-1",
          user_code: "WXYZ-9876",
          interval: "7",
        }),
      );

      const result = await requestDeviceCode();

      expect(result).toEqual({
        verificationUrl: VERIFICATION_URL,
        userCode: "WXYZ-9876",
        deviceAuthId: "device-auth-1",
        interval: 7,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: CLIENT_ID }),
        }),
      );
    });

    it("falls back to default poll interval when interval is invalid", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          device_auth_id: "device-auth-1",
          user_code: "WXYZ-9876",
          interval: "invalid",
        }),
      );

      const result = await requestDeviceCode();
      expect(result.interval).toBe(5);
    });

    it("throws response details when request fails", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse("boom", 500));

      await expect(requestDeviceCode()).rejects.toThrow(
        "Failed to request device code: 500 boom",
      );
    });
  });

  describe("pollForDeviceCodeCompletion", () => {
    it("returns completion payload after pending responses", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse("pending", 403))
        .mockResolvedValueOnce(createMockResponse("still pending", 404))
        .mockResolvedValueOnce(
          createMockResponse({
            authorization_code: "auth-code",
            code_challenge: "challenge",
            code_verifier: "verifier",
          }),
        );

      const result = await pollForDeviceCodeCompletion("device-auth-1", "WXYZ-9876", 0, 1000);

      expect(result).toEqual({
        authorizationCode: "auth-code",
        codeChallenge: "challenge",
        codeVerifier: "verifier",
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("throws when polling returns unexpected status", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse("bad request", 400));

      await expect(
        pollForDeviceCodeCompletion("device-auth-1", "WXYZ-9876", 0, 1000),
      ).rejects.toThrow("Unexpected polling response: 400 bad request");
    });

    it("throws timeout when deadline is exceeded", async () => {
      await expect(
        pollForDeviceCodeCompletion("device-auth-1", "WXYZ-9876", 0, 0),
      ).rejects.toThrow("Device code authentication timed out (15 minutes)");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("token exchange", () => {
    it("exchanges authorization code for oauth tokens", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-12T00:00:00Z"));
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          id_token: "id-1",
          expires_in: 3600,
        }),
      );

      const result = await exchangeDeviceCodeForTokens("auth-code", "verifier");

      expect(result).toEqual({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        idToken: "id-1",
        expiresAt: new Date("2026-02-12T01:00:00Z").getTime(),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `${AUTH_BASE_URL}/oauth/token`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            code: "auth-code",
            code_verifier: "verifier",
            redirect_uri: `${AUTH_BASE_URL}/deviceauth/callback`,
          }),
        }),
      );
    });

    it("throws detailed error when exchange fails", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse("invalid code", 401));

      await expect(exchangeDeviceCodeForTokens("auth-code", "verifier")).rejects.toThrow(
        "Failed to exchange code for tokens: 401 invalid code",
      );
    });
  });

  describe("refreshDeviceCodeTokens", () => {
    it("refreshes oauth tokens with refresh_token grant", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-12T00:00:00Z"));
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          access_token: "access-2",
          refresh_token: "refresh-2",
          id_token: "id-2",
          expires_in: 1800,
        }),
      );

      const result = await refreshDeviceCodeTokens("refresh-1");

      expect(result).toEqual({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        idToken: "id-2",
        expiresAt: new Date("2026-02-12T00:30:00Z").getTime(),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `${AUTH_BASE_URL}/oauth/token`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            grant_type: "refresh_token",
            client_id: CLIENT_ID,
            refresh_token: "refresh-1",
          }),
        }),
      );
    });

    it("throws detailed error when refresh fails", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse("expired refresh token", 401));

      await expect(refreshDeviceCodeTokens("refresh-1")).rejects.toThrow(
        "Failed to refresh token: 401 expired refresh token",
      );
    });
  });

  describe("runDeviceCodeLogin", () => {
    it("runs full flow and returns exchanged tokens", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-12T00:00:00Z"));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            device_auth_id: "device-auth-1",
            user_code: "WXYZ-9876",
            interval: "0",
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            authorization_code: "auth-code",
            code_challenge: "challenge",
            code_verifier: "verifier",
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            access_token: "access-3",
            refresh_token: "refresh-3",
            id_token: "id-3",
            expires_in: 900,
          }),
        );

      const result = await runDeviceCodeLogin();

      expect(result).toEqual({
        accessToken: "access-3",
        refreshToken: "refresh-3",
        idToken: "id-3",
        expiresAt: new Date("2026-02-12T00:15:00Z").getTime(),
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      const lines = consoleSpy.mock.calls.flat().map((v) => String(v));
      expect(lines.join("\n")).toContain(VERIFICATION_URL);
      expect(lines.join("\n")).toContain("WXYZ-9876");
      expect(mockLogger.info).toHaveBeenCalledWith("Device code authentication successful");

      consoleSpy.mockRestore();
    });
  });

  it("returns after requesting device code when DEVICE_CODE_ONLY is set", async () => {
    process.env.OWLIABOT_OAUTH_DEVICE_CODE_ONLY = "1";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_auth_id: "daid",
        user_code: "CODE-1234",
        interval: "5",
      }),
    });

    const tokens = await runDeviceCodeLogin();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(tokens.accessToken).toContain("device-code-only");
  });
});
