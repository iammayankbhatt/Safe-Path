import React, { useState } from 'react';
import { getTrustedContacts, saveTrustedContacts } from '../utils/storage';
import styles from './SettingsPage.module.css';

export default function SettingsPage({ onNavigate }) {
  const [contacts, setContacts] = useState(getTrustedContacts());
  const [editingIndex, setEditingIndex] = useState(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  // PWA install prompt
  React.useEffect(() => {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    });
  }, []);

  const handleAddContact = () => {
    if (!newName.trim() || !newPhone.trim()) return;
    if (contacts.length >= 3) return;

    const updated = [...contacts, { name: newName.trim(), phone: newPhone.trim() }];
    setContacts(updated);
    saveTrustedContacts(updated);
    setNewName('');
    setNewPhone('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRemove = (i) => {
    const updated = contacts.filter((_, idx) => idx !== i);
    setContacts(updated);
    saveTrustedContacts(updated);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') setDeferredPrompt(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => onNavigate('map')}>← Back</button>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.content}>

        {/* Trusted Contacts */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>👥 Trusted Contacts</h2>
            <span className={styles.badge}>{contacts.length}/3</span>
          </div>
          <p className={styles.sectionDesc}>
            Stored locally on your device. Never sent to our servers.
          </p>

          {contacts.map((contact, i) => (
            <div key={i} className={styles.contactCard}>
              <div className={styles.contactAvatar}>{contact.name[0].toUpperCase()}</div>
              <div className={styles.contactInfo}>
                <div className={styles.contactName}>{contact.name}</div>
                <div className={styles.contactPhone}>{contact.phone}</div>
              </div>
              <button className={styles.removeBtn} onClick={() => handleRemove(i)}>✕</button>
            </div>
          ))}

          {contacts.length < 3 && (
            <div className={styles.addForm}>
              <input
                className={styles.input}
                placeholder="Name (e.g. Mom)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <input
                className={styles.input}
                placeholder="Phone (+91...)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                type="tel"
              />
              <button className={styles.addBtn} onClick={handleAddContact} disabled={!newName || !newPhone}>
                Add Contact
              </button>
            </div>
          )}

          {saved && (
            <div className={styles.savedMsg}>✅ Contact saved locally</div>
          )}
        </section>

        {/* PWA Install */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>📱 Add to Home Screen</h2>
          <p className={styles.sectionDesc}>
            Install SafePath as a PWA — works offline, no app store needed.
          </p>
          {deferredPrompt ? (
            <button className={styles.installBtn} onClick={handleInstall}>
              Install SafePath App
            </button>
          ) : (
            <div className={styles.installInstructions}>
              <p>On iPhone: tap <strong>Share → Add to Home Screen</strong></p>
              <p>On Android: tap <strong>Menu → Add to Home Screen</strong></p>
            </div>
          )}
        </section>

        {/* About */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ℹ️ About SafePath</h2>
          <div className={styles.aboutCard}>
            <div className={styles.aboutRow}><span>Version</span><span>1.0.0</span></div>
            <div className={styles.aboutRow}><span>Team</span><span>HAWKS — GEHU Haldwani</span></div>
            <div className={styles.aboutRow}><span>Event</span><span>Watch The Code 2026</span></div>
            <div className={styles.aboutRow}><span>City</span><span>Meerut, Uttar Pradesh</span></div>
            <div className={styles.aboutRow}><span>Tech</span><span>React · Node.js · PostGIS · DBSCAN</span></div>
          </div>
          <p className={styles.tagline}>
            "One route saved is one assault prevented. One life changed."
          </p>
        </section>

        {/* Privacy */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>🔒 Privacy Promise</h2>
          <ul className={styles.privacyList}>
            <li>✅ No login or account required</li>
            <li>✅ Reports are 100% anonymous (UUID tokens only)</li>
            <li>✅ Trusted contacts stored only on your device</li>
            <li>✅ No tracking between sessions</li>
            <li>✅ Open source algorithm (DBSCAN + Dijkstra)</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
