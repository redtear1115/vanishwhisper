import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from './views/HomeView.vue'
import CreateSessionView from './views/CreateSessionView.vue'
import ChatSessionView from './views/ChatSessionView.vue'
import JoinView from './views/JoinView.vue'
import ProfileView from './views/ProfileView.vue'
import MigrateView from './views/MigrateView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/create', name: 'create-session', component: CreateSessionView },
  { path: '/session/:id', name: 'session', component: ChatSessionView, props: true },
  // /join/:uid — invite-link landing. The :uid is the INVITER's UID; the
  // viewer of this page becomes Participant1 of the new session via
  // createSession() after explicit confirmation.
  { path: '/join/:uid', name: 'join', component: JoinView, props: true },
  { path: '/profile', name: 'profile', component: ProfileView },
  // Phase 2.17 — active hand-off migration. Old device coordinates the
  // session-slot transfer to a new device's UID; new device claims its
  // historical messages on first chat-view entry.
  { path: '/migrate', name: 'migrate', component: MigrateView },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
