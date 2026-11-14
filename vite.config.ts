import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

function timingRulesCjsBridgePlugin(): Plugin {
  return {
    name: 'timing-rules-cjs-bridge',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0].replace(/\\/g, '/');
      if (cleanId.endsWith('/electron/lib/TimingRulesConfig.cjs')) {
        return {
          code: `const module = { exports: {} };\nconst exports = module.exports;\n${code}\nexport default module.exports;\n`,
          map: null,
        };
      }
      return null;
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [timingRulesCjsBridgePlugin(), react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      emptyOutDir: false,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
          }
        }
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/assets/models/**', '**/assets/ffmpeg/**', '**/dist/**']
      }
    },
  };
});
