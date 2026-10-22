import { withBearerAuthentication, type OpenAICompatibleAdapterConfig } from "../../compatible-adapter";
import type { CanonicalRequest } from "../../../transport/canonical-model";
import type {
  ProviderDispatchContext,
  ProviderDispatchTarget,
  ProviderId,
} from "../../provider-registry";
import { resolveInboundSessionId } from "../../operations/session-resolution";
import { buildCodeBuddyUserAgent, getCodeBuddyVersion, resolveCodeBuddyVersion } from "../../operations/client-versions";

/** Client identity variant behind the per-request CodeBuddy headers. */
export type CodeBuddyVariant = "IDE" | "CLI";

export function codebuddyDomain(variant: CodeBuddyVariant): string {
  return variant === "IDE" ? "www.codebuddy.ai" : "copilot.tencent.com";
}


/**
 * Per-request CodeBuddy headers — exact provider contract shared by the
 * international (IDE identity) and CN (CLI identity). The stable conversation
 * header is preserved from the client when available; request IDs rotate.
 */
export async function codebuddyHeaders(
  variant: CodeBuddyVariant,
  context?: ProviderDispatchContext,
  request?: CanonicalRequest,
): Promise<Record<string, string>> {
  // Await discovery so the true latest client version is stamped on every
  // dispatch; the pinned fallback only applies on a real network failure.
  await resolveCodeBuddyVersion();
  const version = getCodeBuddyVersion();
  const ua = buildCodeBuddyUserAgent("CLI", version);
  const identity = variant === "IDE" ? "IDE" : "CLI";
  const convId = resolveInboundSessionId(context, request) ?? `cb_session_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const reqId = crypto.randomUUID().replaceAll("-", "");
  return {
    accept: "text/event-stream",
    "User-Agent": ua,
    Origin: `https://${codebuddyDomain(variant)}`,
    "X-Domain": codebuddyDomain(variant),
    "X-Product": "SaaS",
    "X-IDE-Type": identity,
    "X-IDE-Name": identity,
    "X-IDE-Version": version,
    "X-Agent-Intent": "craft",
    "X-Agent-Runtime": "local-agent",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
    "x-conversation-id": convId,
    "x-conversation-request-id": convId,
    "x-conversation-message-id": convId,
    "x-request-id": reqId,
  };
}

/**
 * Shared OpenAI-compatible chat-adapter config for both CodeBuddy variants:
 * bearer auth, chat-only wire contract, per-request identity headers, and the
 * variant's payload hook.
 */
export function codebuddyAdapterConfig(args: {
  providerId: ProviderId;
  baseUrl: string;
  variant: CodeBuddyVariant;
  prePayload: (
    payload: Record<string, unknown>,
    request: CanonicalRequest,
    candidate: ProviderDispatchTarget,
  ) => void;
  fetchImpl?: typeof fetch;
}): OpenAICompatibleAdapterConfig {
  return withBearerAuthentication({
    provider_id: args.providerId,
    base_url: args.baseUrl,
    supported_wire_families: ["chat"],
    buildExtraHeaders: (context, request) => codebuddyHeaders(args.variant, context, request),
    prePayload: args.prePayload,
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
  });
}
