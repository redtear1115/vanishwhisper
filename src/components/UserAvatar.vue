<script setup lang="ts">
// Coloured-initials avatar for the other participant in a session. Used
// on the home session row (36px) and inside the chat header (28px) — the
// same uid hashes to the same colour scheme on both surfaces, so when
// the user taps a row to enter the chat the visual identity of "this
// person" carries through.
//
// Initials and scheme come from labels.ts so the per-uid mapping stays
// in one place: SessionRow's row, ChatSessionView's header, and any
// future surface (notification, search result, …) all see the same
// initials + colour for the same uid without a second source of truth.
//
// `name` falls back to `uid` for the initials computation when the user
// hasn't set a label yet — matches the avatarInitials() helper's
// behaviour, just makes the prop ergonomics nicer at the call site.
import { computed } from 'vue'
import { avatarInitials, avatarScheme } from '../labels'

const props = withDefaults(
  defineProps<{
    uid: string
    name?: string | null
    size?: number
  }>(),
  { size: 36, name: null },
)

const initials = computed(() => avatarInitials(props.name ?? props.uid))
const scheme = computed(() => avatarScheme(props.uid))
// Font-size formula tuned for the two sizes currently in use:
//   36 → 12, 28 → 11. A flat ratio (~1/3) gives 36→12 but 28→9 which is
//   too small for a 2-letter glyph at 28px diameter; the floor at 11
//   keeps small avatars legible.
const fontSize = computed(() => Math.max(11, Math.round(props.size / 3)))
</script>

<template>
  <div
    class="user-avatar"
    :class="`scheme-${scheme}`"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${fontSize}px`,
    }"
    aria-hidden="true"
  >
    {{ initials }}
  </div>
</template>

<style scoped>
.user-avatar {
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  flex-shrink: 0;
}
.user-avatar.scheme-purple {
  background: var(--vw-purple-deep);
  color: var(--vw-purple-pale);
}
.user-avatar.scheme-green {
  background: var(--vw-green-deep);
  color: var(--vw-green);
}
</style>
