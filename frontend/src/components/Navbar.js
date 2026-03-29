import React from 'react';
import styles from './Navbar.module.css';

const NAV_ITEMS = [
  { id: 'map',      icon: '🗺️',  label: 'Map' },
  { id: 'route',    icon: '🧭',  label: 'Route' },
  { id: 'stats',    icon: '📊',  label: 'Stats' },
  { id: 'settings', icon: '⚙️',  label: 'Settings' },
];

export default function Navbar({ currentScreen, onNavigate }) {
  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`${styles.navBtn} ${currentScreen === item.id ? styles.navBtnActive : ''}`}
          onClick={() => onNavigate(item.id)}
          aria-label={item.label}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
