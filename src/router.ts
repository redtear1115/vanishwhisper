import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from './views/HomeView.vue'
import CreateSessionView from './views/CreateSessionView.vue'
import ChatSessionView from './views/ChatSessionView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/create', name: 'create-session', component: CreateSessionView },
  { path: '/session/:id', name: 'session', component: ChatSessionView, props: true },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
