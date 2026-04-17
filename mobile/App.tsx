/**
 * Root of the app.
 *
 * Renders a BridgedWebView that loads the local election frontend.
 * Demonstrates the full native ↔ web bridge:
 *
 *   Web → Native  :  WEB_READY, HAPTIC, NAVIGATE, REQUEST_AUTH, SHARE
 *   Native → Web  :  NATIVE_READY, AUTH_TOKEN, THEME_CHANGE
 */

import React, { useCallback, useRef } from 'react';
import {
  Alert,
  Platform,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import BridgedWebView, {
  BridgedWebViewHandle,
} from './src/components/BridgedWebView';

// ---------------------------------------------------------------------------
// Web source — local bundled assets (built by scripts/build-web.js)
// ---------------------------------------------------------------------------
const WEB_URL = Platform.select({
  android: 'file:///android_asset/www/index.html',
  ios: 'PLACEHOLDER', // see iOS note below
  default: 'http://10.0.2.2:3000',
})!;

// To use a remote dev server instead, comment out WEB_URL above and use:
// const WEB_URL = 'http://10.0.2.2:3000';           // Android emulator
// const WEB_URL = 'http://localhost:3000';           // iOS simulator
// const WEB_URL = 'https://<ngrok-url>.ngrok-free.app'; // physical device

function AppContent() {
  const insets = useSafeAreaInsets();
  const bridgeRef = useRef<BridgedWebViewHandle>(null);
  const colorScheme = useColorScheme();

  // ── Web → Native handlers ──────────────────────────────────────────────

  const handleWebReady = useCallback(() => {
    console.log('[Bridge] Web side is ready');
    // Immediately push app version and current theme.
    bridgeRef.current?.sendToWeb('NATIVE_READY', { appVersion: '1.0.0' });
    bridgeRef.current?.sendToWeb('THEME_CHANGE', {
      theme: colorScheme === 'dark' ? 'dark' : 'light',
    });
  }, [colorScheme]);

  const handleRequestAuth = useCallback(() => {
    console.log('[Bridge] Web requested auth token');
    // In a real app, fetch from your auth store / keychain.
    bridgeRef.current?.sendToWeb('AUTH_TOKEN', {
      token: 'demo-jwt-token',
      expiresAt: Date.now() + 3600_000,
    });
  }, []);

  const handleNavigate = useCallback(
    (
      payload: { screen: string; params?: Record<string, unknown> } | undefined,
    ) => {
      if (!payload) return;
      console.log('[Bridge] Navigate to', payload.screen, payload.params);
      // Integrate with React Navigation:
      // navigation.navigate(payload.screen as never, payload.params);
      Alert.alert('Navigate', `Screen: ${payload.screen}`);
    },
    [],
  );

  const handleHaptic = useCallback(
    (
      payload:
        | {
            style:
              | 'light'
              | 'medium'
              | 'heavy'
              | 'success'
              | 'warning'
              | 'error';
          }
        | undefined,
    ) => {
      if (!payload) return;
      console.log('[Bridge] Haptic:', payload.style);
      // Integrate with react-native-haptic-feedback:
      // HapticFeedback.trigger(payload.style);
    },
    [],
  );

  const handleShare = useCallback(
    (
      payload: { title?: string; message: string; url?: string } | undefined,
    ) => {
      if (!payload) return;
      // Integrate with Share API:
      // Share.share({ title: payload.title, message: payload.message, url: payload.url });
      Alert.alert('Share', payload.message);
    },
    [],
  );

  const handleRequest = useCallback(
    (payload: { id: string; method: string; args?: unknown[] } | undefined) => {
      if (!payload) return;
      console.log('[Bridge] Request:', payload.method, payload.args);
      // Respond with RESPONSE message:
      bridgeRef.current?.sendToWeb('RESPONSE', {
        id: payload.id,
        ok: true,
        result: `echo: ${payload.method}`,
      });
    },
    [],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BridgedWebView
        ref={bridgeRef}
        source={{
          uri: WEB_URL,
          headers: { 'ngrok-skip-browser-warning': 'true' },
        }}
        onWebReady={handleWebReady}
        onRequestAuth={handleRequestAuth}
        onNavigate={handleNavigate}
        onHaptic={handleHaptic}
        onShare={handleShare}
        onRequest={handleRequest}
      />
    </View>
  );
}

export default function App() {
  const isDark = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
