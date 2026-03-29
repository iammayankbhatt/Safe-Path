import React, { useState, useEffect } from 'react';
import styles from './InstallPrompt.module.css';

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(
    localStorage.getItem('safepath_install_dismissed') === 'true'
  );

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setPrompt(null);
    setDismissed(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('safepath_install_dismissed', 'true');
  };

  if (!prompt || dismissed) return null;

  return (
    <div className={styles.banner}>
      <span className={styles.icon}>🛡️</span>
      <div className={styles.text}>
        <strong>Add SafePath to Home Screen</strong>
        <span>Works offline, no app store needed</span>
      </div>
      <button className={styles.installBtn} onClick={handleInstall}>Install</button>
      <button className={styles.dismissBtn} onClick={handleDismiss}>✕</button>
    </div>
  );
}
