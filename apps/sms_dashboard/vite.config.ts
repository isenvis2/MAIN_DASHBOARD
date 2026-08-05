import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const backendTarget = env.SMS_BACKEND_URL || process.env.SMS_BACKEND_URL || 'http://127.0.0.1:3005';

  // Try to read port from SMS_DashBoard.json for local use
  let customPort = 3000;
  try {
    const rootConfigPath = path.resolve(__dirname, 'SMS_DashBoard.json');
    const publicConfigPath = path.resolve(__dirname, 'public', 'SMS_DashBoard.json');
    let configPath = null;
    if (fs.existsSync(rootConfigPath)) configPath = rootConfigPath;
    else if (fs.existsSync(publicConfigPath)) configPath = publicConfigPath;
    if (configPath) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.port_number) customPort = Number(config.port_number);
    }
  } catch {
    // Fallback
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: process.env.DISABLE_HMR === 'true' ? 3000 : customPort,
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
