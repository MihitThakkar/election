#!/usr/bin/env node
/**
 * build-web.js
 *
 * Builds the frontend and copies the output into the native asset directories
 * so the WebView can load it from a local file:// URL — no server or network needed.
 *
 * Android : android/app/src/main/assets/www/
 * iOS     : ios/mobile/www/  (also needs to be added to the Xcode project once)
 *
 * Usage:
 *   node scripts/build-web.js              # build + copy to both platforms
 *   node scripts/build-web.js --android    # Android only
 *   node scripts/build-web.js --ios        # iOS only
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const androidOnly = args.includes('--android');
const iosOnly = args.includes('--ios');
const both = !androidOnly && !iosOnly;

const FRONTEND_DIR = path.resolve(__dirname, '../../frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const ANDROID_WWW = path.resolve(__dirname, '../android/app/src/main/assets/www');
const IOS_WWW = path.resolve(__dirname, '../ios/mobile/www');

// ── 1. Build ─────────────────────────────────────────────────────────────────
console.log('\n📦 Building frontend...');
execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });
console.log('✓ Build complete\n');

// ── 2. Copy ───────────────────────────────────────────────────────────────────
function copyToPlatform(dest, label) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(DIST_DIR, dest, { recursive: true });
  console.log(`✓ Copied to ${label}: ${path.relative(process.cwd(), dest)}`);
}

if (androidOnly || both) copyToPlatform(ANDROID_WWW, 'Android');
if (iosOnly || both) copyToPlatform(IOS_WWW, 'iOS');

console.log('\n✅ Web assets ready. Run your platform build next.\n');
