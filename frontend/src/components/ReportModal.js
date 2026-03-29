import React, { useState } from 'react';
import { submitReport } from '../utils/api';
import { getAnonToken } from '../utils/storage';
import styles from './ReportModal.module.css';

const REPORT_TYPES = [
  { value: 'unsafe',     label: 'Unsafe',       icon: '🚨', desc: 'General unsafe feeling' },
  { value: 'harassment', label: 'Harassment',   icon: '⚠️', desc: 'Verbal / physical harassment' },
  { value: 'poorly_lit', label: 'Poorly Lit',   icon: '🔦', desc: 'Dark or broken street lights' },
  { value: 'isolated',   label: 'Isolated',     icon: '🏚️', desc: 'Deserted / no people around' },
  { value: 'suspicious', label: 'Suspicious',   icon: '👁️', desc: 'Suspicious activity / people' },
];

export default function ReportModal({ location, onClose }) {
  const [selectedType, setSelectedType] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!selectedType) {
      setError('Please select a report type.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const token = getAnonToken();
      await submitReport({
        lat: location?.lat || 28.9845,
        lng: location?.lng || 77.7064,
        type: selectedType,
        description: description.trim() || null,
        token,
      });

      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to submit. Try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Handle */}
        <div className={styles.handle} />

        {success ? (
          <div className={styles.successState}>
            <span className={styles.successIcon}>✅</span>
            <h3>Report Submitted</h3>
            <p>Thank you for making streets safer.</p>
          </div>
        ) : (
          <>
            <div className={styles.header}>
              <div>
                <h2 className={styles.title}>Report Location</h2>
                <p className={styles.subtitle}>
                  📍 {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : 'Current location'}
                </p>
              </div>
              <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className={styles.privacyNote}>
              🔒 Anonymous · No account needed · Location never tied to identity
            </div>

            {/* Report type selection */}
            <div className={styles.typeGrid}>
              {REPORT_TYPES.map((type) => (
                <button
                  key={type.value}
                  className={`${styles.typeBtn} ${selectedType === type.value ? styles.typeBtnSelected : ''}`}
                  onClick={() => setSelectedType(type.value)}
                >
                  <span className={styles.typeIcon}>{type.icon}</span>
                  <span className={styles.typeLabel}>{type.label}</span>
                  <span className={styles.typeDesc}>{type.desc}</span>
                </button>
              ))}
            </div>

            {/* Optional description */}
            <div className={styles.descSection}>
              <label className={styles.descLabel}>
                Description <span className={styles.optional}>(optional)</span>
              </label>
              <textarea
                className={styles.textarea}
                placeholder="Add details... (max 280 characters)"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 280))}
                rows={3}
                maxLength={280}
              />
              <div className={styles.charCount}>{description.length}/280</div>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={loading || !selectedType}
            >
              {loading ? (
                <span className={styles.spinner} />
              ) : (
                <>Submit Anonymously</>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
