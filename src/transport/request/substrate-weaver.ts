import { existsSync, readFileSync, statSync } from "node:fs";
import { GatewayError } from "../gateway-error";
import type { CanonicalMessage, ContentPart } from "../canonical-model";

interface CachedFileSubstrate {
  readonly mtimeMs: number;
  readonly content: string;
}

const fileSubstrateCache = new Map<string, CachedFileSubstrate>();

/**
 * Resolves substrate content either from direct inline text or an `@file:` path.
 * When pointing to a file, caches the read in RAM and automatically invalidates
 * on file modification (`mtime` check) with negligible I/O overhead.
 */
export function resolveSubstrateContent(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("@file:")) {
    return trimmed;
  }

  const filePath = trimmed.slice("@file:".length).trim();
  if (!existsSync(filePath)) {
    throw new GatewayError(
      "invalid_request",
      400,
      `Substrate prompt file not found: ${filePath}`,
      { filePath },
    );
  }

  try {
    const stats = statSync(filePath);
    const cached = fileSubstrateCache.get(filePath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.content;
    }

    const content = readFileSync(filePath, "utf-8").trim();
    fileSubstrateCache.set(filePath, { mtimeMs: stats.mtimeMs, content });
    return content;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError(
      "invalid_request",
      500,
      `Failed to read substrate prompt file: ${String(error)}`,
      { filePath },
    );
  }
}

/**
 * Clears the file substrate cache (for testing or manual invalidation).
 */
export function clearSubstrateCache(): void {
  fileSubstrateCache.clear();
}

/**
 * Weaves a substrate system prompt into an ordered list of canonical messages.
 *
 * Strategies:
 * - `prepend` (default): Weaves substrate at Token 0. If a client system message
 *   (e.g. Hermes SOUL.md) exists, joins them with `\n\n---\n\n` so the substrate
 *   takes Primacy Bias (guardrail nullification) while the client system prompt
 *   preserves agent identity, tool schemas, and behavior.
 * - `override`: Strips all client `system` and `developer` messages and installs
 *   the substrate exclusively.
 */
export function weaveSubstrate(
  messages: readonly CanonicalMessage[],
  substrateText: string,
  strategy: "prepend" | "override" = "prepend",
): readonly CanonicalMessage[] {
  if (!substrateText || substrateText.trim().length === 0) {
    return messages;
  }

  const cleanSubstrate = substrateText.trim();

  if (strategy === "override") {
    const nonSystem = messages.filter(
      (m) => m.role !== "system" && m.role !== "developer",
    );
    const systemMsg: CanonicalMessage = {
      role: "system",
      content: [{ kind: "text", text: cleanSubstrate }],
    };
    return [systemMsg, ...nonSystem];
  }

  // Prepend strategy:
  // Find first system or developer message
  const sysIdx = messages.findIndex(
    (m) => m.role === "system" || m.role === "developer",
  );

  if (sysIdx === -1) {
    // No client system message — prepend new system message at index 0
    const systemMsg: CanonicalMessage = {
      role: "system",
      content: [{ kind: "text", text: cleanSubstrate }],
    };
    return [systemMsg, ...messages];
  }

  // Client system message exists — merge at Token 0
  const target = messages[sysIdx]!;
  const firstTextPartIdx = target.content.findIndex((p) => p.kind === "text");

  let updatedContent: readonly ContentPart[];
  if (firstTextPartIdx !== -1) {
    const textPart = target.content[firstTextPartIdx] as { kind: "text"; text: string };
    const mergedText = `${cleanSubstrate}\n\n---\n\n${textPart.text}`;
    updatedContent = target.content.map((p, idx) =>
      idx === firstTextPartIdx ? { ...p, text: mergedText } : p,
    );
  } else {
    // Content has parts (e.g. image/document) but no text part — prepend text part
    const newPart: ContentPart = {
      kind: "text",
      text: `${cleanSubstrate}\n\n---\n\n`,
    };
    updatedContent = [newPart, ...target.content];
  }

  const updatedTarget: CanonicalMessage = {
    ...target,
    content: updatedContent,
  };

  return messages.map((m, idx) => (idx === sysIdx ? updatedTarget : m));
}
