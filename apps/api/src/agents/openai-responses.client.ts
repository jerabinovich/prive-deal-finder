import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type JsonGenerationParams = {
  model: string;
  systemPrompt: string;
  userInput: Record<string, unknown>;
  schema: {
    name: string;
    strict: boolean;
    schema: Record<string, unknown>;
  };
  timeoutMs: number;
};

type WebVerifyParams = {
  model: string;
  query: string;
  intent?: string;
  timeoutMs: number;
};

@Injectable()
export class OpenAIResponsesClient {
  constructor(private readonly config: ConfigService) {}

  private extractText(responseJson: Record<string, unknown>) {
    const direct = responseJson.output_text;
    if (typeof direct === "string" && direct.trim().length) return direct.trim();

    const output = Array.isArray(responseJson.output) ? (responseJson.output as Array<Record<string, unknown>>) : [];
    for (const item of output) {
      const content = Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : [];
      for (const chunk of content) {
        if (typeof chunk.text === "string" && chunk.text.trim().length) return chunk.text.trim();
      }
    }
    return "";
  }

  private parseJsonText(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const clean = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
      : trimmed;
    try {
      return JSON.parse(clean) as Record<string, unknown>;
    } catch (_error) {
      return null;
    }
  }

  async generateJson(params: JsonGenerationParams) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return { ok: false as const, reason: "MISSING_API_KEY" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          input: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: JSON.stringify(params.userInput) },
          ],
          text: {
            format: {
              type: "json_schema",
              name: params.schema.name,
              strict: params.schema.strict,
              schema: params.schema.schema,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false as const, reason: `OPENAI_HTTP_${response.status}`, detail: body };
      }
      const data = (await response.json()) as Record<string, unknown>;
      const text = this.extractText(data);
      const parsed = this.parseJsonText(text);
      if (!parsed) return { ok: false as const, reason: "PARSE_ERROR", detail: text };
      return {
        ok: true as const,
        parsed,
        text,
        tokenUsage: typeof (data.usage as Record<string, unknown> | undefined)?.total_tokens === "number"
          ? ((data.usage as Record<string, unknown>).total_tokens as number)
          : undefined,
      };
    } catch (error) {
      return {
        ok: false as const,
        reason: "NETWORK_ERROR",
        detail: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async webVerify(params: WebVerifyParams) {
    const apiKey = this.config.get<string>("OPENAI_API_KEY", "").trim();
    if (!apiKey) return { ok: false as const, reason: "MISSING_API_KEY" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          input: [
            {
              role: "user",
              content: `Verify in real-time web sources. Intent=${params.intent || "general"}. Query=${params.query}. Return concise summary with source quality.`,
            },
          ],
          tools: [{ type: "web_search_preview" }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false as const, reason: `OPENAI_HTTP_${response.status}`, detail: body };
      }
      const data = (await response.json()) as Record<string, unknown>;
      const text = this.extractText(data);
      return { ok: true as const, text };
    } catch (error) {
      return {
        ok: false as const,
        reason: "NETWORK_ERROR",
        detail: error instanceof Error ? error.message : "Unknown error",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
