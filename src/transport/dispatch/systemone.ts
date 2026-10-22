import { GatewayError } from "../gateway-error";
import { ProxyRequestStateStore } from "../request/state";
import { buildOpenCodeHeaders } from "../../providers/integrations/opencode-fingerprint";

export function createSystemOneHandler(deps: { stateStore: ProxyRequestStateStore }) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    const state = deps.stateStore.require(request);
    const authorization = state.authorization;
    if (!authorization) {
      throw new GatewayError("invalid_request", 401, "invalid or revoked API key");
    }
    const body = state.ingressBody as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new GatewayError("invalid_request", 400, "request body must be a JSON object");
    }

    const rawModel = typeof body.model === "string" ? body.model.toLowerCase() : "";
    const cleanModel = rawModel.includes("jev") || !rawModel ? "jev-1.13-free" : body.model;
    const payload = JSON.stringify({ ...body, model: cleanModel });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "accept": "application/json",
      ...buildOpenCodeHeaders(),
    };

    try {
      const upstream = await fetch("https://opencode.ai/zen/v1/systemone", {
        method: "POST",
        headers,
        body: payload,
        signal: state.abortController.signal,
      });

      state.completed = true;
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
          "x-request-id": state.requestId,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new GatewayError("client_disconnected", 499, "client closed request");
      }
      throw new GatewayError("upstream_unavailable", 502, `Upstream OpenCode error: ${err}`);
    }
  };
}
