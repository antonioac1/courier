// Type definitions for getcourier 0.1.0
// Client + CLI for the hosted GetCourier API (https://getcourier.dev).

export interface GetCourierIdentity {
  /** did:key identifier for the inbox. */
  did: string;
  /** base64url ed25519 public key. */
  public_key: string;
  fingerprint: string;
  /** base64url pkcs8 private key — returned once at creation. */
  private_key?: string;
}

export interface AliasDetails {
  alias: string;
  inbox_id: string;
  read_token: string;
  created_at: string;
  expires_at: string;
}

export interface InboxLinks {
  messages?: string;
  wait?: string;
  mcp?: string;
  [key: string]: string | undefined;
}

/** Normalized inbox returned by createInbox(). */
export interface Inbox {
  /** Full address, e.g. "my-agent-k3xmqz@getcourier.dev". */
  address: string;
  /** Alias / local part, e.g. "my-agent-k3xmqz". */
  alias: string;
  inboxId: string;
  /** Inbox-scoped read token (shown once). Use as `Authorization: Bearer <readToken>`. */
  readToken: string;
  expiresAt: string;
  ttlHours: number;
  paid: boolean;
  identity: GetCourierIdentity | null;
  links: InboxLinks | null;
  chargedCredits?: number;
  balance?: number;
  /** Raw API response. */
  raw: Record<string, unknown>;
}

export interface MessageAuth {
  verdict?: string;
  spf?: string;
  dkim?: string;
  dmarc?: string;
  [key: string]: unknown;
}

/** A message as returned inside `messages`. Content is UNTRUSTED. */
export interface Message {
  id: string;
  received_at: string;
  from: string;
  from_name?: string;
  subject?: string;
  codes: string[];
  links: string[];
  text?: string;
  auth?: MessageAuth;
  untrusted?: boolean;
  marker?: string;
}

export interface MessagesResponse {
  success: boolean;
  inbox_id: string;
  address: string;
  untrusted: boolean;
  marker: string;
  messages: Message[];
  count: number;
}

export interface WaitResult {
  message: Message | null;
  code: string | null;
  link: string | null;
  /** True when the overall deadline passed with no matching message. */
  timeout: boolean;
}

export interface PricingTier {
  inboxes_per_hour_per_ip: number;
  inboxes_per_day_per_ip: number;
  ttl_hours: number;
}

export interface PricingResponse {
  unit: string;
  credit_usd: number;
  free_tier: PricingTier;
  prices: Array<{ item: string; credits: number }>;
  rails: Array<Record<string, string>>;
  min_deposit_usd: number;
}

export type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<any>;

/** An inbox handle: the object from createInbox(), or an alias + token. */
export type InboxRef = Inbox | string;

export interface RequestOptions {
  /** Override the fetch implementation (defaults to globalThis.fetch). */
  fetch?: FetchLike;
  signal?: AbortSignal;
}

export interface InboxAuthOptions extends RequestOptions {
  /** read_token when passing a bare alias string. */
  token?: string;
  readToken?: string;
}

export interface CreateInboxOptions extends RequestOptions {
  /** Requested alias, `^[a-z0-9][a-z0-9-]{1,30}$`; a 6-char suffix is appended. */
  alias?: string;
  /** What the inbox is for, <= 200 chars. */
  purpose?: string;
  /** Your agent name, <= 100 chars. */
  agent?: string;
  /** 72 (free, default) or 720 (paid). */
  ttlHours?: number;
  /** `cak_...` account key for a paid inbox. */
  accountKey?: string;
}

export interface WaitForCodeOptions extends InboxAuthOptions {
  /** Overall deadline in seconds (default 30). */
  timeoutSeconds?: number;
  /** Only consider messages newer than this message id. */
  after?: string;
}

export interface ListMessagesOptions extends InboxAuthOptions {
  after?: string;
  /** Default 20, max 100. */
  limit?: number;
}

export interface CourierErrorOptions {
  code?: string;
  status?: number | null;
  retryable?: boolean;
  retryAfter?: number | null;
  hint?: string | null;
  requestId?: string | null;
  payment?: unknown;
  body?: unknown;
}

export class CourierError extends Error {
  constructor(message: string, options?: CourierErrorOptions);
  code: string;
  status: number | null;
  retryable: boolean;
  /** Seconds before retrying, from `retry_after_seconds` or `Retry-After`. */
  retryAfter: number | null;
  readonly retryAfterSeconds: number | null;
  hint: string | null;
  requestId: string | null;
  payment: unknown;
  body: unknown;
  toJSON(): Record<string, unknown>;
}

/** HTTP 402 with code FREE_QUOTA_EXCEEDED (3 inboxes/hour, 5/day per IP). */
export class QuotaExceededError extends CourierError {
  retryable: true;
}

/** HTTP 402 for paid usage (longer inbox, insufficient credits). */
export class PaymentRequiredError extends CourierError {}

export const VERSION: string;
export const USER_AGENT: string;
export const DEFAULT_BASE_URL: string;

export function createInbox(options?: CreateInboxOptions): Promise<Inbox>;
export function waitForCode(inbox: InboxRef, options?: WaitForCodeOptions): Promise<WaitResult>;
export function listMessages(inbox: InboxRef, options?: ListMessagesOptions): Promise<MessagesResponse>;
export function getMessage(inbox: InboxRef, messageId: string, options?: InboxAuthOptions): Promise<Message>;
export function deleteInbox(inbox: InboxRef, options?: InboxAuthOptions): Promise<{ success: boolean }>;
export function pricing(options?: RequestOptions): Promise<PricingResponse>;
