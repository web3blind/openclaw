import {
  extractLeadingHttpStatus,
  formatRawAssistantErrorForUi,
  isCloudflareOrHtmlErrorPage,
  parseApiErrorInfo,
} from "../../shared/assistant-error-format.js";
import { normalizeLowercaseStringOrEmpty } from "../../shared/string-coerce.js";
import { formatExecDeniedUserMessage } from "../exec-approval-result.js";
import { stripInternalRuntimeContext } from "../internal-runtime-context.js";
import { stableStringify } from "../stable-stringify.js";
import {
  isBillingErrorMessage,
  isOverloadedErrorMessage,
  isRateLimitErrorMessage,
  isTimeoutErrorMessage,
} from "./failover-matches.js";

export function formatBillingErrorMessage(provider?: string, model?: string): string {
  const providerName = provider?.trim();
  const modelName = model?.trim();
  const providerLabel =
    providerName && modelName ? `${providerName} (${modelName})` : providerName || undefined;
  if (providerLabel) {
    return `⚠️ ${providerLabel} returned a billing error — your API key has run out of credits or has an insufficient balance. Check your ${providerName} billing dashboard and top up or switch to a different API key.`;
  }
  return "⚠️ API provider returned a billing error — your API key has run out of credits or has an insufficient balance. Check your provider's billing dashboard and top up or switch to a different API key.";
}

export const BILLING_ERROR_USER_MESSAGE = formatBillingErrorMessage();

const RATE_LIMIT_ERROR_USER_MESSAGE = "⚠️ API rate limit reached. Please try again later.";
const OVERLOADED_ERROR_USER_MESSAGE =
  "The AI service is temporarily overloaded. Please try again in a moment.";
const FINAL_TAG_RE = /<\s*\/?\s*final\s*>/gi;
const ERROR_PREFIX_RE =
  /^(?:error|(?:[a-z][\w-]*\s+)?api\s*error|openai\s*error|anthropic\s*error|gateway\s*error|codex\s*error|request failed|failed|exception)(?:\s+\d{3})?[:\s-]+/i;
const CONTEXT_OVERFLOW_ERROR_HEAD_RE =
  /^(?:context overflow:|request_too_large\b|request size exceeds\b|request exceeds the maximum size\b|context length exceeded\b|maximum context length\b|prompt is too long\b|exceeds model context window\b)/i;
const HTTP_ERROR_HINTS = [
  "error",
  "bad request",
  "not found",
  "unauthorized",
  "forbidden",
  "internal server",
  "service unavailable",
  "gateway",
  "rate limit",
  "overloaded",
  "timeout",
  "timed out",
  "invalid",
  "too many requests",
  "permission",
];
const RATE_LIMIT_SPECIFIC_HINT_RE =
  /\bmin(ute)?s?\b|\bhours?\b|\bseconds?\b|\btry again in\b|\breset\b|\bplan\b|\bquota\b/i;
const NON_ERROR_PROVIDER_PAYLOAD_MAX_LENGTH = 16_384;
const NON_ERROR_PROVIDER_PAYLOAD_PREFIX_RE = /^codex\s*error(?:\s+\d{3})?[:\s-]+/i;

function extractProviderRateLimitMessage(raw: string): string | undefined {
  const withoutPrefix = raw.replace(ERROR_PREFIX_RE, "").trim();
  const info = parseApiErrorInfo(raw) ?? parseApiErrorInfo(withoutPrefix);
  const candidate =
    info?.message ?? (extractLeadingHttpStatus(withoutPrefix)?.rest || withoutPrefix);

  if (!candidate || !RATE_LIMIT_SPECIFIC_HINT_RE.test(candidate)) {
    return undefined;
  }

  if (isCloudflareOrHtmlErrorPage(withoutPrefix)) {
    return undefined;
  }

  const trimmed = candidate.trim();
  if (
    trimmed.length > 300 ||
    trimmed.startsWith("{") ||
    /^(?:<!doctype\s+html\b|<html\b)/i.test(trimmed)
  ) {
    return undefined;
  }

  return `⚠️ ${trimmed}`;
}

export function formatRateLimitOrOverloadedErrorCopy(raw: string): string | undefined {
  if (isRateLimitErrorMessage(raw)) {
    return extractProviderRateLimitMessage(raw) ?? RATE_LIMIT_ERROR_USER_MESSAGE;
  }
  if (isOverloadedErrorMessage(raw)) {
    return OVERLOADED_ERROR_USER_MESSAGE;
  }
  return undefined;
}

export function formatTransportErrorCopy(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const lower = normalizeLowercaseStringOrEmpty(raw);

  if (
    /\beconnrefused\b/i.test(raw) ||
    lower.includes("connection refused") ||
    lower.includes("actively refused")
  ) {
    return "LLM request failed: connection refused by the provider endpoint.";
  }

  if (
    /\beconnreset\b|\beconnaborted\b|\benetreset\b|\bepipe\b/i.test(raw) ||
    lower.includes("socket hang up") ||
    lower.includes("connection reset") ||
    lower.includes("connection aborted")
  ) {
    return "LLM request failed: network connection was interrupted.";
  }

  if (
    /\benotfound\b|\beai_again\b/i.test(raw) ||
    lower.includes("getaddrinfo") ||
    lower.includes("no such host") ||
    lower.includes("dns")
  ) {
    return "LLM request failed: DNS lookup for the provider endpoint failed.";
  }

  if (
    /\benetunreach\b|\behostunreach\b|\behostdown\b/i.test(raw) ||
    lower.includes("network is unreachable") ||
    lower.includes("host is unreachable")
  ) {
    return "LLM request failed: the provider endpoint is unreachable from this host.";
  }

  if (
    lower.includes("fetch failed") ||
    lower.includes("connection error") ||
    lower.includes("network request failed")
  ) {
    return "LLM request failed: network connection error.";
  }

  return undefined;
}

export function formatDiskSpaceErrorCopy(raw: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const lower = normalizeLowercaseStringOrEmpty(raw);
  if (
    /\benospc\b/i.test(raw) ||
    lower.includes("no space left on device") ||
    lower.includes("disk full")
  ) {
    return (
      "OpenClaw could not write local session data because the disk is full. " +
      "Free some disk space and try again."
    );
  }
  return undefined;
}

function isReasoningConstraintErrorMessage(raw: string): boolean {
  if (!raw) {
    return false;
  }
  const lower = normalizeLowercaseStringOrEmpty(raw);
  return (
    lower.includes("reasoning is mandatory") ||
    lower.includes("reasoning is required") ||
    lower.includes("requires reasoning") ||
    (lower.includes("reasoning") && lower.includes("cannot be disabled"))
  );
}

export function isInvalidStreamingEventOrderError(raw: string): boolean {
  if (!raw) {
    return false;
  }
  const lower = normalizeLowercaseStringOrEmpty(raw);
  return (
    lower.includes("unexpected event order") &&
    lower.includes("message_start") &&
    lower.includes("message_stop")
  );
}

function hasRateLimitTpmHint(raw: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(raw);
  return /\btpm\b/i.test(lower) || lower.includes("tokens per minute");
}

function looksLikeGenericContextOverflowError(raw: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(raw);
  return CONTEXT_OVERFLOW_ERROR_HEAD_RE.test(lower);
}

function stripFinalTags(text: string): string {
  return text.replace(FINAL_TAG_RE, "").trim();
}

function extractMessageFromJsonPayload(raw: string): string | undefined {
  return parseApiErrorInfo(raw)?.message;
}

function normalizeProviderErrorPayload(raw: string): string {
  const withoutKnownPrefix = raw.replace(NON_ERROR_PROVIDER_PAYLOAD_PREFIX_RE, "").trim();
  if (!withoutKnownPrefix) {
    return raw.trim();
  }
  if (withoutKnownPrefix.length > NON_ERROR_PROVIDER_PAYLOAD_MAX_LENGTH) {
    return raw.trim();
  }
  const parsedMessage = extractMessageFromJsonPayload(withoutKnownPrefix);
  return parsedMessage?.trim() || withoutKnownPrefix;
}

export function sanitizeUserFacingText(text: string, opts?: { errorContext?: boolean }): string {
  const cleaned = stripFinalTags(stripInternalRuntimeContext(text)).trim();
  if (!cleaned) {
    return cleaned;
  }
  if (opts?.errorContext !== true) {
    return cleaned;
  }

  const execDenied = formatExecDeniedUserMessage(cleaned);
  if (execDenied) {
    return execDenied;
  }

  const providerError = normalizeProviderErrorPayload(cleaned);
  const billingMessage = isBillingErrorMessage(providerError)
    ? formatBillingErrorMessage()
    : undefined;
  if (billingMessage) {
    return billingMessage;
  }

  const rateOrOverloaded = formatRateLimitOrOverloadedErrorCopy(providerError);
  if (rateOrOverloaded) {
    return rateOrOverloaded;
  }

  if (isTimeoutErrorMessage(providerError)) {
    return "The AI service timed out while generating a reply. Please try again.";
  }

  const transportMessage = formatTransportErrorCopy(providerError);
  if (transportMessage) {
    return transportMessage;
  }

  const diskMessage = formatDiskSpaceErrorCopy(providerError);
  if (diskMessage) {
    return diskMessage;
  }

  if (isReasoningConstraintErrorMessage(providerError)) {
    return "This model requires reasoning to stay enabled for this request.";
  }

  if (isInvalidStreamingEventOrderError(providerError)) {
    return "The provider returned an invalid streaming sequence. Please retry.";
  }

  if (looksLikeGenericContextOverflowError(providerError) && !hasRateLimitTpmHint(providerError)) {
    return "The request exceeded the model context window. Please shorten the prompt or start a fresh session.";
  }

  if (HTTP_ERROR_HINTS.some((hint) => providerError.toLowerCase().includes(hint))) {
    return formatRawAssistantErrorForUi(providerError);
  }

  return stableStringify(providerError) || providerError;
}
