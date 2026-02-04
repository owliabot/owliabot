/**
 * Tests for OpenAI-compatible provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  openAICompatibleComplete,
  isOpenAICompatible,
} from "./openai-compatible.js";
import type { Message } from "./session.js";
import type { ToolDefinition } from "./tools/interface.js";
import { HTTPError, TimeoutError } from "./runner.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("toOpenAIMessages", () => {
  it("converts system message", () => {
    const messages: Message[] = [
      { role: "system", content: "You are helpful.", timestamp: Date.now() },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "system", content: "You are helpful." }]);
  });

  it("converts user message", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello!", timestamp: Date.now() },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello!" }]);
  });

  it("converts assistant message", () => {
    const messages: Message[] = [
      { role: "assistant", content: "Hi there!", timestamp: Date.now() },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "assistant", content: "Hi there!" }]);
  });

  it("converts assistant message with tool calls", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tc1", name: "get_weather", arguments: { city: "Paris" } },
        ],
        timestamp: Date.now(),
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "get_weather",
              arguments: '{"city":"Paris"}',
            },
          },
        ],
      },
    ]);
  });

  it("converts tool results", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        toolResults: [
          {
            toolCallId: "tc1",
            toolName: "get_weather",
            success: true,
            data: { temp: 20 },
          },
        ],
        timestamp: Date.now(),
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: "tool",
        tool_call_id: "tc1",
        content: '{\n  "temp": 20\n}',
      },
    ]);
  });

  it("converts tool error results", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        toolResults: [
          {
            toolCallId: "tc1",
            toolName: "get_weather",
            success: false,
            error: "City not found",
          },
        ],
        timestamp: Date.now(),
      },
    ];

    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      {
        role: "tool",
        tool_call_id: "tc1",
        content: "Error: City not found",
      },
    ]);
  });
});

describe("toOpenAITools", () => {
  it("returns undefined for empty tools", () => {
    expect(toOpenAITools(undefined)).toBeUndefined();
    expect(toOpenAITools([])).toBeUndefined();
  });

  it("converts tool definitions", () => {
    const tools: ToolDefinition[] = [
      {
        name: "get_weather",
        description: "Get weather for a city",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
          },
          required: ["city"],
        },
        security: { level: "read" },
        execute: vi.fn(),
      },
    ];

    const result = toOpenAITools(tools);
    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
            },
            required: ["city"],
          },
        },
      },
    ]);
  });
});

describe("fromOpenAIResponse", () => {
  it("converts basic response", () => {
    const response = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: "Hello!",
          },
          finish_reason: "stop" as const,
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const result = fromOpenAIResponse(response, "openai-compatible", "llama3.2:latest");

    expect(result).toEqual({
      content: "Hello!",
      toolCalls: undefined,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
      },
      provider: "openai-compatible",
      model: "llama3.2:latest",
      truncated: false,
    });
  });

  it("converts response with tool calls", () => {
    const response = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "gpt-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function" as const,
                function: {
                  name: "get_weather",
                  arguments: '{"city":"Paris"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls" as const,
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      },
    };

    const result = fromOpenAIResponse(response, "openai-compatible", "gpt-4");

    expect(result.toolCalls).toEqual([
      {
        id: "call_abc123",
        name: "get_weather",
        arguments: { city: "Paris" },
      },
    ]);
  });

  it("handles truncated response", () => {
    const response = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content: "This is a truncated...",
          },
          finish_reason: "length" as const,
        },
      ],
    };

    const result = fromOpenAIResponse(response, "openai-compatible", "llama3.2:latest");
    expect(result.truncated).toBe(true);
  });

  it("throws on empty choices", () => {
    const response = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [],
    };

    expect(() =>
      fromOpenAIResponse(response, "openai-compatible", "llama3.2:latest")
    ).toThrow("No choices in OpenAI response");
  });
});

describe("openAICompatibleComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes successful completion request", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello!",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    const result = await openAICompatibleComplete(
      {
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2:latest",
      },
      messages
    );

    expect(result.content).toBe("Hello!");
    expect(result.provider).toBe("openai-compatible");

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body).model).toBe("llama3.2:latest");
  });

  it("includes Authorization header when API key provided", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "deepseek-chat",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await openAICompatibleComplete(
      {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-test-key",
      },
      messages
    );

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBe("Bearer sk-test-key");
  });

  it("omits Authorization header for empty API key", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await openAICompatibleComplete(
      {
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2:latest",
        apiKey: "",
      },
      messages
    );

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["Authorization"]).toBeUndefined();
  });

  it("includes tools in request when provided", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Paris"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const messages: Message[] = [
      { role: "user", content: "What's the weather in Paris?", timestamp: Date.now() },
    ];

    const tools: ToolDefinition[] = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} },
        security: { level: "read" },
        execute: vi.fn(),
      },
    ];

    const result = await openAICompatibleComplete(
      {
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.2:latest",
      },
      messages,
      { tools }
    );

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls![0].name).toBe("get_weather");

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe("auto");
  });

  it("throws HTTPError on 4xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () =>
        Promise.resolve({
          error: { message: "Invalid API key" },
        }),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(
      openAICompatibleComplete(
        {
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2:latest",
          apiKey: "bad-key",
        },
        messages
      )
    ).rejects.toThrow(HTTPError);
  });

  it("throws HTTPError on 5xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.reject(new Error("Not JSON")),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(
      openAICompatibleComplete(
        {
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2:latest",
        },
        messages
      )
    ).rejects.toThrow(HTTPError);
  });

  it("throws TimeoutError on request timeout", async () => {
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        })
    );

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(
      openAICompatibleComplete(
        {
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2:latest",
          timeoutMs: 100,
        },
        messages
      )
    ).rejects.toThrow(TimeoutError);
  });

  it("handles network errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed: ECONNREFUSED"));

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await expect(
      openAICompatibleComplete(
        {
          baseUrl: "http://localhost:11434/v1",
          model: "llama3.2:latest",
        },
        messages
      )
    ).rejects.toThrow("Network error");
  });

  it("normalizes baseUrl with trailing slash", async () => {
    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1234567890,
      model: "llama3.2:latest",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const messages: Message[] = [
      { role: "user", content: "Hi", timestamp: Date.now() },
    ];

    await openAICompatibleComplete(
      {
        baseUrl: "http://localhost:11434/v1/",
        model: "llama3.2:latest",
      },
      messages
    );

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });
});

describe("isOpenAICompatible", () => {
  it("returns true for openai-compatible", () => {
    expect(isOpenAICompatible("openai-compatible")).toBe(true);
  });

  it("returns false for other providers", () => {
    expect(isOpenAICompatible("anthropic")).toBe(false);
    expect(isOpenAICompatible("openai")).toBe(false);
    expect(isOpenAICompatible("google")).toBe(false);
  });
});
