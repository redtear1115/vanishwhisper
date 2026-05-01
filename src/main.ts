import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
// Self-host the fonts (rather than Google Fonts CDN) so this E2E messenger
// doesn't leak every visitor's IP to a third-party font host. Fontsource
// emits @font-face with unicode-range subsets, so only the latin slice
// gets downloaded for typical English usage.
//
// Fraunces uses `full.css` to include the SOFT and WONK axes — they're
// the painted-ghost-character moves that make the wordmark distinctive.
// Body and mono only need the wght axis (default `index.css`).
import '@fontsource-variable/fraunces/full.css'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './styles/theme.css'

createApp(App).use(router).mount('#app')
