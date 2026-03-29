import React from 'react';
import styles from './OfflineBanner.module.css';

export default function OfflineBanner() {
  return (
    <div className={styles.banner}>
      📡 You're offline — showing cached data. Panic alerts will queue and send when connected.
    </div>
  );
}
