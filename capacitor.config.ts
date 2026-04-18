import type { CapacitorConfig } from '@capacitor/cli';

const liveReloadUrl = 'http://10.0.2.2:3001';
const isLiveReload = process.env.CAPACITOR_LIVE_RELOAD === 'true';

const config: CapacitorConfig = {
  appId: 'com.example.preview',
  appName: 'Preview',
  webDir: 'out',
  ...(isLiveReload
    ? {
        server: {
          url: liveReloadUrl,
          cleartext: liveReloadUrl.startsWith('http://')
        }
      }
    : {})
};

export default config;
