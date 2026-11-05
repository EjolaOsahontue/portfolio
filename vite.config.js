import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Three pages: the portfolio (index.html), project details (project.html) and admin (admin.html).
// If you deploy to GitHub Pages at https://you.github.io/repo-name/, set base: '/repo-name/'.
export default defineConfig({
  // base: '/repo-name/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        project: fileURLToPath(new URL('./project.html', import.meta.url)),
      },
    },
  },
})
