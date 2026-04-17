/**
 * BridgedWebView
 *
 * A drop-in WebView wrapper that:
 *  • Injects the __nativeBridge script before any page content loads.
 *  • Wires up the useBridge hook.
 *  • Forwards all remaining WebView props.
 *
 * Usage:
 *   <BridgedWebView
 *     source={{ uri: 'https://yourapp.com' }}
 *     onWebReady={() => console.log('web side ready')}
 *     onNavigate={({ screen }) => navigation.navigate(screen)}
 *   />
 */

import React, { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import WebView, { WebViewProps } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';

import { WEB_BRIDGE_SCRIPT } from '../bridge/webBridge';
import { useBridge } from '../bridge/useBridge';
import type { NativeToWebMessage, PayloadOf, WebMessageHandlers } from '../bridge/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type BridgedWebViewProps = Omit<WebViewProps, 'onMessage' | 'injectedJavaScriptBeforeContentLoaded' | 'source'> & {
  source?: WebViewProps['source'];
  /** Called once the web side fires WEB_READY. */
  onWebReady?: WebMessageHandlers['WEB_READY'];
  /** Called when the web asks to navigate to a native screen. */
  onNavigate?: WebMessageHandlers['NAVIGATE'];
  /** Called when the web requests the auth token. */
  onRequestAuth?: WebMessageHandlers['REQUEST_AUTH'];
  /** Called when the web triggers a haptic. */
  onHaptic?: WebMessageHandlers['HAPTIC'];
  /** Called when the web requests camera access. */
  onOpenCamera?: WebMessageHandlers['OPEN_CAMERA'];
  /** Called when the web triggers a share sheet. */
  onShare?: WebMessageHandlers['SHARE'];
  /** Called for raw REQUEST messages (method-call pattern). */
  onRequest?: WebMessageHandlers['REQUEST'];
};

// ---------------------------------------------------------------------------
// Ref handle — lets parent components call sendToWeb imperatively
// ---------------------------------------------------------------------------

export type BridgedWebViewHandle = {
  sendToWeb: <T extends NativeToWebMessage['type']>(
    type: T,
    payload?: PayloadOf<NativeToWebMessage, T>,
    id?: string,
  ) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const BridgedWebView = forwardRef<BridgedWebViewHandle, BridgedWebViewProps>(
  (
    {
      onWebReady,
      onNavigate,
      onRequestAuth,
      onHaptic,
      onOpenCamera,
      onShare,
      onRequest,
      source,
      style,
      ...rest
    },
    ref,
  ) => {
    const webViewRef = useRef<WebView>(null);

    // Managed internally so we can rewrite localhost redirects on Android.
    const [resolvedSource, setResolvedSource] = useState(source);

    const { onMessage, sendToWeb } = useBridge(webViewRef, {
      WEB_READY: onWebReady,
      NAVIGATE: onNavigate,
      REQUEST_AUTH: onRequestAuth,
      HAPTIC: onHaptic,
      OPEN_CAMERA: onOpenCamera,
      SHARE: onShare,
      REQUEST: onRequest,
    });

    // Expose sendToWeb to parent via ref.
    useImperativeHandle(ref, () => ({ sendToWeb }), [sendToWeb]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        onMessage(event);
      },
      [onMessage],
    );

    // On Android the emulator reaches the host via 10.0.2.2, but dev servers
    // (Vite, CRA, etc.) may redirect back to `localhost`. Intercept those
    // redirects, rewrite the host, and update the source so the WebView loads
    // the corrected URL instead of dead-ending with ERR_CONNECTION_REFUSED.
    const handleShouldStartLoad = useCallback(
      ({ url }: WebViewNavigation) => {
        if (Platform.OS === 'android' && url.includes('localhost')) {
          const rewritten = url.replace(/localhost/g, '10.0.2.2');
          setResolvedSource({ uri: rewritten });
          return false; // cancel the bad navigation; source update triggers a fresh load
        }
        return true;
      },
      [],
    );

    return (
      <WebView
        ref={webViewRef}
        style={[styles.webview, style]}
        source={resolvedSource}
        injectedJavaScriptBeforeContentLoaded={WEB_BRIDGE_SCRIPT}
        // Allow postMessage from any origin — restrict to your domain in prod.
        originWhitelist={['*']}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        // Recommended perf / security defaults
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Required for file:// assets on Android
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        {...rest}
      />
    );
  },
);

BridgedWebView.displayName = 'BridgedWebView';

export default BridgedWebView;

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
