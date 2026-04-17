/**
 * Typed contract for all messages that cross the native <-> web boundary.
 *
 * Adding a new message:
 *   1. Add a union member here (NativeToWebMessage or WebToNativeMessage).
 *   2. Handle it in useBridge (native) or window.__nativeBridge listeners (web).
 */

// ---------------------------------------------------------------------------
// Shared envelope
// ---------------------------------------------------------------------------

export type BridgeMessage<T extends string = string, P = unknown> = {
  /** Discriminant used to route the message to the right handler. */
  type: T;
  /** Optional correlation id for request/response pairs. */
  id?: string;
  payload?: P;
};

// ---------------------------------------------------------------------------
// Native → Web
// ---------------------------------------------------------------------------

export type NativeToWebMessage =
  | BridgeMessage<'NATIVE_READY', { appVersion: string }>
  | BridgeMessage<'AUTH_TOKEN', { token: string; expiresAt: number }>
  | BridgeMessage<'THEME_CHANGE', { theme: 'light' | 'dark' }>
  | BridgeMessage<'PUSH_NOTIFICATION', { title: string; body: string; data?: Record<string, unknown> }>
  | BridgeMessage<'RESPONSE', { id: string; ok: boolean; result?: unknown; error?: string }>;

// ---------------------------------------------------------------------------
// Web → Native
// ---------------------------------------------------------------------------

export type WebToNativeMessage =
  | BridgeMessage<'WEB_READY'>
  | BridgeMessage<'REQUEST_AUTH'>
  | BridgeMessage<'NAVIGATE', { screen: string; params?: Record<string, unknown> }>
  | BridgeMessage<'HAPTIC', { style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' }>
  | BridgeMessage<'OPEN_CAMERA'>
  | BridgeMessage<'SHARE', { title?: string; message: string; url?: string }>
  | BridgeMessage<'REQUEST', { id: string; method: string; args?: unknown[] }>;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

/** Infer the payload for a specific message type from a union. */
export type PayloadOf<
  Union extends BridgeMessage,
  T extends Union['type'],
> = Extract<Union, { type: T }>['payload'];

/** Handler map for NativeToWebMessage — use on the web side. */
export type NativeMessageHandlers = {
  [K in NativeToWebMessage['type']]?: (
    payload: PayloadOf<NativeToWebMessage, K>,
  ) => void;
};

/** Handler map for WebToNativeMessage — use on the native side. */
export type WebMessageHandlers = {
  [K in WebToNativeMessage['type']]?: (
    payload: PayloadOf<WebToNativeMessage, K>,
  ) => void;
};
