<script setup lang="ts">
// Phase 2.17 — active hand-off migration UX. Drives src/migration.ts.
//
// Flow:
//   1. User opens VanishWhisper on the new device first; gets fresh UID +
//      keypair (just like a brand-new install).
//   2. On THIS (old) device: paste the new device's UID, press Look up.
//      We fetch its PublicKey from Users/{newUID} and show the fingerprint.
//   3. User compares the fingerprint against what the new device's Profile
//      page shows. Same value = correct UID was entered. (This step is the
//      defense against accidentally migrating to an attacker's UID.)
//   4. Confirm + Migrate. Each session gets its participant slot swapped
//      from this UID to the new UID, with the wrapped session key re-
//      wrapped for the new device's public key. Sequential, with progress.
//   5. After the slot swap, this UID is no longer a participant in any
//      session — opening the app from THIS device naturally shows an empty
//      home. No auto-wipe of local data: leaving the keypair / labels in
//      place means partial-failure retries work, and local-only state
//      isn't sensitive on a device the user is about to physically
//      decommission anyway.
import { computed, ref } from 'vue'
import { useIdentity } from '../identity'
import {
  fetchTargetIdentity,
  listMigratableSessions,
  migrateAllSessions,
  type SessionToMigrate,
  type TargetIdentity,
} from '../migration'
import AppLogo from '../components/AppLogo.vue'

const { identity } = useIdentity()

const draftUid = ref('')
const target = ref<TargetIdentity | null>(null)
const sessions = ref<SessionToMigrate[]>([])
const verified = ref(false)
const looking = ref(false)
const lookupError = ref<string | null>(null)

type MigrateState = 'idle' | 'running' | 'done' | 'error'
const state = ref<MigrateState>('idle')
const progressDone = ref(0)
const progressTotal = ref(0)
const runError = ref<string | null>(null)

async function lookup(): Promise<void> {
  looking.value = true
  lookupError.value = null
  target.value = null
  sessions.value = []
  verified.value = false
  try {
    const t = await fetchTargetIdentity(draftUid.value)
    // Snapshot the current session set so the confirmation card can show
    // a count and the user knows what's about to be moved.
    const list = await listMigratableSessions()
    target.value = t
    sessions.value = list
  } catch (err) {
    lookupError.value = err instanceof Error ? err.message : String(err)
  } finally {
    looking.value = false
  }
}

async function run(): Promise<void> {
  if (!target.value) return
  state.value = 'running'
  runError.value = null
  progressDone.value = 0
  progressTotal.value = sessions.value.length
  try {
    await migrateAllSessions(target.value, (done, total) => {
      progressDone.value = done
      progressTotal.value = total
    })
    state.value = 'done'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    state.value = 'error'
  }
}

const progressPct = computed(() => {
  if (progressTotal.value === 0) return 0
  return Math.round((progressDone.value / progressTotal.value) * 100)
})
</script>

<template>
  <div class="migrate">
    <header class="vw-topbar">
      <AppLogo size="sm" />
    </header>

    <div class="migrate-body">
      <router-link to="/profile" class="back-link">← Profile</router-link>

      <h1 class="title">Move account to another device</h1>

      <div class="vw-card">
        <p class="hint">
          Transfers your sessions and message history to a new device of yours. Your old account
          becomes empty (this device's UID is no longer a participant in any chat); the other
          parties keep being able to read every message — they just see your UID change in their
          UI.
        </p>
        <p class="hint subtle">
          ⚠ Only works while THIS device is online and signed in. If you lose this device before
          migrating, the sessions are gone for good — by design.
        </p>
      </div>

      <!-- Step 1 — explain how to fetch new device UID -->
      <div class="section-label">Step 1 — On your new device</div>
      <div class="vw-card">
        <p class="hint">
          Install / open VanishWhisper on the new device. Open its <strong>Profile</strong> page.
          You'll see a <code>Your UID</code> field and a <code>Key fingerprint</code>. Keep that
          screen visible — you'll compare the fingerprint against this device in a moment.
        </p>
      </div>

      <!-- Step 2 — paste UID, look up fingerprint -->
      <div class="section-label">Step 2 — Paste the new device's UID here</div>
      <div class="vw-card">
        <input
          v-model="draftUid"
          type="text"
          class="vw-input uid-input"
          placeholder="Paste new device UID"
          :disabled="looking || state === 'running' || state === 'done'"
          @keydown.enter="lookup"
        />
        <div class="actions">
          <button
            type="button"
            class="vw-btn-primary"
            :disabled="!draftUid.trim() || looking || state === 'running' || state === 'done'"
            @click="lookup"
          >{{ looking ? 'Looking up…' : 'Look up' }}</button>
        </div>
        <p v-if="lookupError" class="vw-text-danger">{{ lookupError }}</p>
      </div>

      <!-- Step 3 — verify fingerprint, confirm, migrate -->
      <template v-if="target">
        <div class="section-label">Step 3 — Verify the fingerprint matches</div>
        <div class="vw-card">
          <div class="field-label">New device's key fingerprint</div>
          <code class="fp">{{ target.fingerprint }}</code>
          <p class="hint">
            On your new device, open <strong>Profile</strong> and check the
            <code>Key fingerprint</code>. The two must be byte-for-byte identical. If they differ,
            you've entered the wrong UID — DO NOT proceed.
          </p>
          <label class="verify-row">
            <input
              v-model="verified"
              type="checkbox"
              :disabled="state === 'running' || state === 'done'"
            />
            <span>I've verified the fingerprint matches what my new device shows.</span>
          </label>
        </div>

        <div class="vw-card">
          <p class="hint">
            <strong>{{ sessions.length }} session{{ sessions.length === 1 ? '' : 's' }}</strong>
            will be moved. After this, opening VanishWhisper on this device will show an empty
            home — your sessions live with the new UID.
          </p>
          <div class="actions">
            <button
              type="button"
              class="vw-btn-primary"
              :disabled="!verified || sessions.length === 0 || state === 'running' || state === 'done'"
              @click="run"
            >
              {{
                state === 'running'
                  ? `Migrating… (${progressDone}/${progressTotal})`
                  : state === 'done'
                    ? '✓ Done'
                    : `Migrate ${sessions.length} session${sessions.length === 1 ? '' : 's'}`
              }}
            </button>
          </div>

          <div v-if="state === 'running'" class="progress-wrap">
            <div class="progress-bar" :style="{ width: progressPct + '%' }" />
          </div>

          <p v-if="state === 'done'" class="vw-text-green done-msg">
            Migration complete. Your new device should see all sessions appear under its UID. You
            can close this app on this device and clear its data when convenient.
          </p>
          <p v-if="runError" class="vw-text-danger">{{ runError }}</p>
        </div>
      </template>

      <!-- Bottom hint: this device's own fingerprint, in case the user
           wants to read it out the OTHER direction (new device verifying
           old). Not load-bearing for the migration but cheap to surface. -->
      <p v-if="identity" class="hint subtle bottom-fp">
        For reference, this device's UID is
        <code>{{ identity.uid.slice(0, 12) }}…</code>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.migrate {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.migrate-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.back-link {
  font-size: 12px;
  color: var(--vw-purple-light);
  text-decoration: none;
}
.back-link:hover { color: var(--vw-purple-pale); }

.title {
  font-size: 18px;
  font-weight: 500;
  color: var(--vw-text);
  margin: 4px 0 0;
}

.section-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-top: 4px;
}

.field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vw-text3);
  margin-bottom: 6px;
}

.hint {
  font-size: 12px;
  color: var(--vw-text2);
  line-height: 1.5;
  margin: 0;
}
.hint.subtle { color: var(--vw-text3); font-size: 11px; }

.uid-input {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

.fp {
  font-family: ui-monospace, monospace;
  font-size: 14px;
  color: var(--vw-purple-pale);
  letter-spacing: 0.04em;
  display: block;
  padding: 8px 10px;
  background: var(--vw-bg);
  border-radius: 6px;
  border: 0.5px solid var(--vw-border);
  word-break: break-all;
}

.verify-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--vw-text2);
  margin-top: 10px;
  cursor: pointer;
}
.verify-row input { margin-top: 2px; cursor: pointer; }

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.progress-wrap {
  height: 4px;
  background: var(--vw-bg);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 10px;
}
.progress-bar {
  height: 100%;
  background: var(--vw-purple-mid);
  transition: width 0.2s;
}

.done-msg {
  font-size: 12px;
  margin-top: 10px;
  line-height: 1.5;
}

.bottom-fp {
  margin-top: 14px;
  text-align: center;
}
.bottom-fp code {
  font-family: ui-monospace, monospace;
  color: var(--vw-purple-light);
}
</style>
