import { v4 as uuidv4 } from 'uuid';

const TOKEN_KEY = 'safepath_anon_token';

/**
 * Get or create anonymous UUID session token.
 * Stored in localStorage — never tied to identity.
 */
export function getAnonToken() {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = uuidv4();
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
}

// ─── Trusted Contacts (stored locally, never sent to server) ──
const CONTACTS_KEY = 'safepath_trusted_contacts';

export function getTrustedContacts() {
  try {
    return JSON.parse(localStorage.getItem(CONTACTS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveTrustedContacts(contacts) {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts.slice(0, 3)));
}

// ─── Panic queue (offline SMS queue) ─────────────────────────
const PANIC_QUEUE_KEY = 'safepath_panic_queue';

export function queuePanicAlert(data) {
  const queue = getPanicQueue();
  queue.push({ ...data, queued_at: Date.now() });
  localStorage.setItem(PANIC_QUEUE_KEY, JSON.stringify(queue));
}

export function getPanicQueue() {
  try {
    return JSON.parse(localStorage.getItem(PANIC_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearPanicQueue() {
  localStorage.removeItem(PANIC_QUEUE_KEY);
}

// ─── Settings ─────────────────────────────────────────────────
const SETTINGS_KEY = 'safepath_settings';

const DEFAULT_SETTINGS = {
  showHeatmap: false,
  mapStyle: 'default',
  locationTracking: true,
};

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
