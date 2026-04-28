import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from './views/HomeView.vue'
import CreateSessionView from './views/CreateSessionView.vue'
import ChatSessionView from './views/ChatSessionView.vue'
import JoinView from './views/JoinView.vue'
import ProfileView from './views/ProfileView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/create', name: 'create-session', component: CreateSessionView },
  { path: '/session/:id', name: 'session', component: ChatSessionView, props: true },
  // /join/:uid — invite-link landing. The :uid is the INVITER's UID; the
  // viewer of this page becomes Participant1 of the new session via
  // createSession() after explicit confirmation.
  { path: '/join/:uid', name: 'join', component: JoinView, props: true },
  { path: '/profile', name: 'profile', component: ProfileView },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
