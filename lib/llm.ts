import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { getAnthropicKey, readEnv } from "@/db";

// One place to ask a model for a typed answer. Prefers the Anthropic API when
// its key is set, otherwise OpenRouter (any model, OpenAI-compatible), otherwise
// returns null so callers fall back to rules.

export type LlmSource = "anthropic" | "openrouter" | "none";

export function llmSource(): LlmSource {
  if (getAnthropicKey()) return "anthropic";
  if (readEnv("OPENROUTER_API_KEY")) return "openrouter";
  return "none";
}

export function llmModel(): string {
  return readEnv("OPENROUTER_MODEL") || "anthropic/claude-sonnet-5";
}

type Ask<T extends z.ZodTypeAny> = { system: string; user: string; schema: T; maxTokens?: number; label?: string; timeoutMs?: number; retries?: number };

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  // Some models prepend prose; take the first {...} block.
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

async function viaOpenRouter<T extends z.ZodTypeAny>(ask: Ask<T>, attempt = 0): Promise<z.infer<T> | null> {
  const key = readEnv("OPENROUTER_API_KEY") as string;
  const schemaJson = z.toJSONSchema(ask.schema);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(ask.timeoutMs ?? 75_000),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": readEnv("SITE_URL") || "https://makersmap.net",
      "X-Title": "MakersMap",
    },
    body: JSON.stringify({
      model: llmModel(),
      max_tokens: ask.maxTokens ?? 1200,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${ask.system}\n\nAnswer with a single JSON object and nothing else. It must match this JSON schema exactly:\n${JSON.stringify(schemaJson)}` },
        { role: "user", content: ask.user },
      ],
    }),
  });
  } catch (error) {
    console.error(`OpenRouter ${ask.label || ""}: request failed (${error instanceof Error ? error.name : "error"})`);
    if (attempt < (ask.retries ?? 2)) return viaOpenRouter(ask, attempt + 1);
    return null;
  }
  const data = await response.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!response.ok) {
    console.error(`OpenRouter ${ask.label || ""}: ${response.status} ${data.error?.message || ""}`);
    if ((response.status === 429 || response.status >= 500) && attempt < (ask.retries ?? 2)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return viaOpenRouter(ask, attempt + 1);
    }
    return null;
  }
  const content = data.choices?.[0]?.message?.content || "";
  try {
    const parsed = ask.schema.safeParse(JSON.parse(stripFences(content)));
    if (parsed.success) return parsed.data;
    console.error(`OpenRouter ${ask.label || ""}: answer didn't match schema`, parsed.error.issues.slice(0, 3));
  } catch {
    console.error(`OpenRouter ${ask.label || ""}: answer wasn't JSON:`, content.slice(0, 200).replace(/\s+/g, " "), data.choices?.[0] ? "" : JSON.stringify(data).slice(0, 200));
  }
  if (attempt < Math.min(1, ask.retries ?? 1)) return viaOpenRouter(ask, attempt + 1);
  return null;
}

async function viaAnthropic<T extends z.ZodTypeAny>(ask: Ask<T>): Promise<z.infer<T> | null> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: ask.maxTokens ?? 1200,
      output_config: { effort: "low", format: zodOutputFormat(ask.schema) },
      system: ask.system,
      messages: [{ role: "user", content: ask.user }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output as z.infer<T>;
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`Anthropic ${ask.label || ""}: ${error.status} ${error.message}`);
    else console.error(`Anthropic ${ask.label || ""}: request failed`, error);
    return null;
  }
}

/** Ask for a typed answer. Returns null when no model is configured or the model failed. */
export async function structured<T extends z.ZodTypeAny>(ask: Ask<T>): Promise<z.infer<T> | null> {
  const source = llmSource();
  if (source === "anthropic") return viaAnthropic(ask);
  if (source === "openrouter") return viaOpenRouter(ask);
  return null;
}

/** Run `fn` over `items` with at most `limit` in flight; preserves order. */
export async function mapWithConcurrency<A, B>(items: A[], limit: number, fn: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const results: B[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
