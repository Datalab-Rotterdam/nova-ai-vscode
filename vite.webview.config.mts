import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    {
      name: 'nova-webview-placeholders',
      enforce: 'pre',
      transformIndexHtml(html) {
        return html
          .replaceAll('%svelte.head%', '<!--nova:svelte-head-->')
          .replaceAll('%svelte.body%', '<!--nova:svelte-body-->');
      }
    },
    svelte()
  ],
  build: {
    outDir: path.resolve(__dirname, 'out', 'webview'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'webview', 'index.html')
    }
  }
});
