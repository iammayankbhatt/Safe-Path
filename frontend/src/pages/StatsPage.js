import React, { useState, useEffect } from 'react';
import { getStats } from '../utils/api';
import styles from './StatsPage.module.css';

export default function StatsPage({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStats()
      .then((res) => setStats(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => onNavigate('map')}>← Back</button>
        <h1 className={styles.title}>📊 Live Stats</h1>
      </div>

      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>Loading statistics...</div>
        ) : stats ? (
          <>
            {/* Report stats */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Safety Reports</h2>
              <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                  <div className={styles.statNumber}>{stats.reports?.total_reports || 0}</div>
                  <div className={styles.statLabel}>Total Reports</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statNumber} style={{ color: '#E63946' }}>
                    {stats.reports?.reports_today || 0}
                  </div>
                  <div className={styles.statLabel}>Today</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statNumber} style={{ color: '#F4A261' }}>
                    {stats.reports?.reports_this_week || 0}
                  </div>
                  <div className={styles.statLabel}>This Week</div>
                </div>
              </div>

              {stats.reports?.by_type?.length > 0 && (
                <div className={styles.byType}>
                  {stats.reports.by_type.map((t) => (
                    <div key={t.report_type} className={styles.typeRow}>
                      <span className={styles.typeName}>{t.report_type.replace('_', ' ')}</span>
                      <div className={styles.typeBar}>
                        <div
                          className={styles.typeBarFill}
                          style={{
                            width: `${Math.min(100, (t.count / stats.reports.total_reports) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className={styles.typeCount}>{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Zone stats */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Safety Zones (Live)</h2>
              <div className={styles.zoneCards}>
                <div className={styles.zoneCard} style={{ borderColor: '#2DC653', background: '#f0fff4' }}>
                  <span style={{ color: '#2DC653', fontSize: 28 }}>🟢</span>
                  <div className={styles.zoneNum}>{stats.zones?.safe_zones || 0}</div>
                  <div className={styles.zoneLabel}>Safe</div>
                </div>
                <div className={styles.zoneCard} style={{ borderColor: '#F4A261', background: '#fffbf0' }}>
                  <span style={{ color: '#F4A261', fontSize: 28 }}>🟡</span>
                  <div className={styles.zoneNum}>{stats.zones?.caution_zones || 0}</div>
                  <div className={styles.zoneLabel}>Caution</div>
                </div>
                <div className={styles.zoneCard} style={{ borderColor: '#E63946', background: '#fff3f3' }}>
                  <span style={{ color: '#E63946', fontSize: 28 }}>🔴</span>
                  <div className={styles.zoneNum}>{stats.zones?.danger_zones || 0}</div>
                  <div className={styles.zoneLabel}>Avoid</div>
                </div>
              </div>
              {stats.zones?.avg_safety_score && (
                <div className={styles.avgScore}>
                  City avg. safety score:
                  <strong style={{ color: parseFloat(stats.zones.avg_safety_score) >= 7 ? '#2DC653' : '#F4A261' }}>
                    {' '}{stats.zones.avg_safety_score} / 10
                  </strong>
                </div>
              )}
            </section>

            {/* Panic stats */}
            {stats.panic_alerts && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Emergency Alerts</h2>
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber}>{stats.panic_alerts.total_alerts || 0}</div>
                    <div className={styles.statLabel}>Total Alerts</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber} style={{ color: '#2DC653' }}>
                      {stats.panic_alerts.resolved_alerts || 0}
                    </div>
                    <div className={styles.statLabel}>Resolved</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber} style={{ color: '#1D3557' }}>
                      {stats.panic_alerts.police_notified || 0}
                    </div>
                    <div className={styles.statLabel}>Police Alerted</div>
                  </div>
                </div>
              </section>
            )}

            {/* Roadmap */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>🛣️ Roadmap</h2>
              <div className={styles.roadmap}>
                <div className={styles.roadmapItem}>
                  <div className={styles.roadmapDot} style={{ background: '#2DC653' }} />
                  <div>
                    <div className={styles.roadmapPhase}>Phase 1 (Now — 6 months)</div>
                    <div className={styles.roadmapDesc}>City pilot in Meerut/Delhi. Target: 10,000 users</div>
                  </div>
                </div>
                <div className={styles.roadmapItem}>
                  <div className={styles.roadmapDot} style={{ background: '#F4A261' }} />
                  <div>
                    <div className={styles.roadmapPhase}>Phase 2 (6–18 months)</div>
                    <div className={styles.roadmapDesc}>10 Tier-2 cities. Open API for safety NGOs</div>
                  </div>
                </div>
                <div className={styles.roadmapItem}>
                  <div className={styles.roadmapDot} style={{ background: '#457B9D' }} />
                  <div>
                    <div className={styles.roadmapPhase}>Phase 3 (18+ months)</div>
                    <div className={styles.roadmapDesc}>National scale. CCTNS + Smart Cities integration</div>
                  </div>
                </div>
              </div>
            </section>

            <p className={styles.footer}>
              Generated at {new Date(stats.generated_at).toLocaleTimeString('en-IN')}
            </p>
          </>
        ) : (
          <div className={styles.loading}>Failed to load statistics.</div>
        )}
      </div>
    </div>
  );
}
