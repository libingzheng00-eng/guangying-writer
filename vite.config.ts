import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { lstatSync } from 'node:fs';

const projectRoot = normalizePath(path.resolve(__dirname));

// 渲染进程构建配置：产物输出到 dist-renderer，供 Electron 主进程 loadFile 加载
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5178,
    strictPort: false,
    watch: {
      // DMG staging includes Applications -> /Applications. Development HMR
      // must never follow that link into unrelated installed applications, or
      // watch generated test/runtime trees until its heap is exhausted.
      // These options affect the dev server only, not the packaged renderer.
      followSymlinks: false,
      ignored: [
        `${projectRoot}/release`, `${projectRoot}/release/**`,
        `${projectRoot}/release-*`, `${projectRoot}/release-*/**`,
        `${projectRoot}/tmp`, `${projectRoot}/tmp/**`,
        '**/*.app', '**/*.app/**',
        // macOS FSEvents initial inventory can still descend into directory
        // links despite followSymlinks:false. Prune the actual link entry too.
        (watchedPath: string) => {
          try { return lstatSync(watchedPath).isSymbolicLink(); }
          catch { return false; } // Missing/deleted paths remain valid HMR events.
        },
      ],
    },
  },
});
