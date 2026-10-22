import {
  getOpenCodeVersion,
  refreshOpenCodeVersion,
} from "../operations/client-versions";

let lastTimestamp = 0;
let sequenceCounter = 0;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function tUId(descending: boolean, now = Date.now()): string {
  if (now !== lastTimestamp) {
    lastTimestamp = now;
    sequenceCounter = 0;
  }
  sequenceCounter++;
  if (sequenceCounter > 63) {
    lastTimestamp++;
    sequenceCounter = 1;
  }
  const base = BigInt(lastTimestamp) * 0x1000n + BigInt(sequenceCounter);
  const bits = descending ? ~base : base;
  const hex = Array.from({ length: 6 }, (_, i) =>
    Number((bits >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0"),
  ).join("");
  const rand = crypto.getRandomValues(new Uint8Array(14));
  const suffix = Array.from(rand, (byte) => BASE62[byte % 62]).join("");
  return `${hex}${suffix}`;
}

/**
 * Generate a valid OpenCode session identifier matching official binary:
 * `ses_` + 12-char hex (descending timestamp) + 14-char base62.
 */
export function generateOpenCodeSessionId(now = Date.now()): string {
  return `ses_${tUId(true, now)}`;
}

/** Generate a valid OpenCode message/request identifier: `msg_` + 12-char hex (ascending timestamp) + 14-char base62. */
export function generateOpenCodeRequestId(now = Date.now()): string {
  return `msg_${tUId(false, now)}`;
}

/** Deterministically maps an inbound session/conversation ID to a valid OpenCode session shape. */
export function deriveOpenCodeSessionId(inboundId: string): string {
  if (inboundId.startsWith("ses_") && inboundId.length >= 26) {
    return inboundId;
  }
  let hash = 0;
  for (let i = 0; i < inboundId.length; i++) {
    hash = (Math.imul(31, hash) + inboundId.charCodeAt(i)) | 0;
  }
  const pseudoTs = (Math.abs(hash) % 1_000_000_000) + 1_700_000_000_000;
  return `ses_${tUId(true, pseudoTs)}`;
}

/** Build the full fingerprint headers matching the official OpenCode CLI client. */
export function buildOpenCodeHeaders(
  version = getOpenCodeVersion(),
  inboundSessionId?: string,
): Record<string, string> {
  refreshOpenCodeVersion();
  const cleanVersion = version && /^1\.18\.(?:[0-9]|[12][0-9]|3[0-3])$/.test(version) ? version : "1.18.18";
  const sessionId =
    inboundSessionId && inboundSessionId.trim().length > 0
      ? deriveOpenCodeSessionId(inboundSessionId.trim())
      : generateOpenCodeSessionId();
  return {
    "x-opencode-client": "cli",
    "x-opencode-session": sessionId,
    "x-opencode-request": generateOpenCodeRequestId(),
    "x-opencode-project": "global",
    "user-agent": `opencode/${cleanVersion} ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14`,
  };
}
