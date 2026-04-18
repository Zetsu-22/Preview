import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = 'http://10.0.2.2:3001';

const config: CapacitorConfig = {
  appId: 'com.example.preview',
  appName: 'Preview',
  webDir: 'capacitor-web',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://')
  }
};

export default config;
