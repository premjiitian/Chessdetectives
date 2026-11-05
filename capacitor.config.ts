import type { CapacitorConfig } from '@capacitor/cli';

// The iOS app: the same web app, bundled inside the app (works offline),
// with Stockfish, Professor Pin's voice and all lessons on the device.
const config: CapacitorConfig = {
  appId: 'com.chessdetectives.app', // TODO(owner): confirm the bundle ID in App Store Connect
  appName: 'Chess Detectives',
  webDir: 'dist',
  ios: {
    contentInset: 'never', // the app handles the notch / home bar itself (safe-area CSS)
    backgroundColor: '#f5f7fb',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
