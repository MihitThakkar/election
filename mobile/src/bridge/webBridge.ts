/**
 * webBridge.ts
 *
 * Generates the JavaScript string that is injected into the WebView via
 * `injectedJavaScriptBeforeContentLoaded`. It runs before any page script and
 * installs `window.__nativeBridge` so web code can:
 *
 *   • Send messages to native:
 *       window.__nativeBridge.send('HAPTIC', { style: 'light' })
 *
 *   • Listen for messages from native:
 *       window.__nativeBridge.on('AUTH_TOKEN', ({ token }) => { … })
 *       window.__nativeBridge.off('AUTH_TOKEN', handler)
 *
 *   • One-shot listener:
 *       window.__nativeBridge.once('NATIVE_READY', ({ appVersion }) => { … })
 */

// Keep the injected script as a plain string constant so Metro doesn't try to
// bundle it as a module. The template-literal is resolved at build time.
export const WEB_BRIDGE_SCRIPT = `
(function () {
  if (window.__nativeBridge) return; // guard against double-injection

  var _handlers = {};

  // ── Receive messages from native ─────────────────────────────────────────
  // react-native-webview dispatches a MessageEvent on window when the native
  // side calls webViewRef.current.postMessage(). We parse the JSON envelope
  // and fan it out to registered handlers.
  window.addEventListener('message', function (event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;

    var list = _handlers[msg.type];
    if (!list || list.length === 0) return;

    // Copy the list so once-handlers can safely splice themselves out.
    list.slice().forEach(function (entry) {
      try { entry.fn(msg.payload); } catch (e) { console.error('[Bridge]', e); }
      if (entry.once) {
        _handlers[msg.type] = (_handlers[msg.type] || []).filter(function (x) {
          return x !== entry;
        });
      }
    });
  });

  // ── Public API ────────────────────────────────────────────────────────────
  window.__nativeBridge = {
    /**
     * Send a typed message to the native layer.
     * @param {string} type  - message type discriminant
     * @param {*}      payload - optional payload
     * @param {string} [id] - optional correlation id for request/response
     */
    send: function (type, payload, id) {
      if (!window.ReactNativeWebView) {
        console.warn('[Bridge] ReactNativeWebView not available – are you in a WebView?');
        return;
      }
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: type, payload: payload, id: id })
      );
    },

    /** Register a persistent handler for a message type from native. */
    on: function (type, fn) {
      if (!_handlers[type]) _handlers[type] = [];
      _handlers[type].push({ fn: fn, once: false });
    },

    /** Remove a previously registered handler. */
    off: function (type, fn) {
      if (!_handlers[type]) return;
      _handlers[type] = _handlers[type].filter(function (e) { return e.fn !== fn; });
    },

    /** Register a handler that fires exactly once. */
    once: function (type, fn) {
      if (!_handlers[type]) _handlers[type] = [];
      _handlers[type].push({ fn: fn, once: true });
    },
  };

  // Signal to native that the bridge is ready.
  // Use a small timeout so the page's own DOMContentLoaded fires first.
  window.addEventListener('DOMContentLoaded', function () {
    window.__nativeBridge.send('WEB_READY');
  });
})();
true; // required by react-native-webview
`;

/**
 * Type augmentation so TypeScript-compiled web code can call the bridge
 * without casting to `any`.  Import this file (or a re-export) in web code.
 *
 * Example (in your Vite/web project):
 *   import type {} from '@/bridge/webBridge'; // side-effect import for types
 *   window.__nativeBridge.send('HAPTIC', { style: 'medium' });
 */
import type { NativeToWebMessage, WebToNativeMessage, PayloadOf } from './types';

type HandlerFn<T extends NativeToWebMessage['type']> = (
  payload: PayloadOf<NativeToWebMessage, T>,
) => void;

declare global {
  interface Window {
    __nativeBridge: {
      send<T extends WebToNativeMessage['type']>(
        type: T,
        payload?: PayloadOf<WebToNativeMessage, T>,
        id?: string,
      ): void;
      on<T extends NativeToWebMessage['type']>(type: T, fn: HandlerFn<T>): void;
      off<T extends NativeToWebMessage['type']>(type: T, fn: HandlerFn<T>): void;
      once<T extends NativeToWebMessage['type']>(type: T, fn: HandlerFn<T>): void;
    };
    /** Injected by react-native-webview. */
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}
