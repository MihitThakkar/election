/**
 * useBridge – native-side bridge hook
 *
 * Wires the WebView's `onMessage` prop to a typed handler map and exposes a
 * `sendToWeb` helper for posting messages into the WebView.
 *
 * Usage:
 *   const { onMessage, sendToWeb } = useBridge(webViewRef, {
 *     WEB_READY: () => sendToWeb('NATIVE_READY', { appVersion: '1.0.0' }),
 *     NAVIGATE:  ({ screen, params }) => navigation.navigate(screen, params),
 *     HAPTIC:    ({ style }) => triggerHaptic(style),
 *   });
 *
 *   <WebView ref={webViewRef} onMessage={onMessage} … />
 */

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type {
  WebToNativeMessage,
  NativeToWebMessage,
  WebMessageHandlers,
  PayloadOf,
} from './types';

export function useBridge(
  webViewRef: RefObject<WebView | null>,
  handlers: WebMessageHandlers,
) {
  // Keep handlers in a ref so the memoised callbacks below never go stale
  // even if the parent re-renders with a new handlers object.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /**
   * Called by <WebView onMessage={…} />.
   * Parses the JSON envelope and dispatches to the matching handler.
   */
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: WebToNativeMessage;
    try {
      msg = JSON.parse(event.nativeEvent.data) as WebToNativeMessage;
    } catch {
      console.warn('[Bridge] Received non-JSON message:', event.nativeEvent.data);
      return;
    }

    if (!msg || typeof msg.type !== 'string') return;

    // TypeScript narrows the payload through the handler map.
    const handler = handlersRef.current[msg.type as WebToNativeMessage['type']];
    if (handler) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (handler as (p: any) => void)(msg.payload);
    } else {
      console.debug('[Bridge] Unhandled web→native message:', msg.type);
    }
  }, []);

  /**
   * Post a typed message into the WebView.
   * Calls window.__nativeBridge internal listener via postMessage.
   */
  const sendToWeb = useCallback(
    <T extends NativeToWebMessage['type']>(
      type: T,
      payload?: PayloadOf<NativeToWebMessage, T>,
      id?: string,
    ) => {
      if (!webViewRef.current) {
        console.warn('[Bridge] sendToWeb called before WebView is mounted');
        return;
      }
      const json = JSON.stringify({ type, payload, id });
      // postMessage posts to the window's message event listeners.
      webViewRef.current.postMessage(json);
    },
    [webViewRef],
  );

  return { onMessage, sendToWeb };
}
