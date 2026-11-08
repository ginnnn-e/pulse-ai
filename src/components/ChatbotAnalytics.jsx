import React, { useState, useEffect } from 'react';

export function ChatbotAnalytics() {
    const [analytics, setAnalytics] = useState({
        summary: {
            total_queries: 0,
            unique_patients: 0,
            avg_response_time_ms: 0,
            rag_hit_rate_percent: 100,
            total_rag_chunks: 0
        },
        topics: [],
        recent_logs: []
    });
    const [loading, setLoading] = useState(true);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const res = await fetch('http://127.0.0.1:5001/analytics');
            const data = await res.json();
            if (data && data.summary) {
                setAnalytics(data);
            }
        } catch (err) {
            console.error('Error fetching chatbot analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const { summary, topics, recent_logs } = analytics;
    const maxTopicCount = topics.length > 0 ? Math.max(...topics.map(t => t.count), 1) : 1;

    return (
        <div className="chatbot-analytics">
            <header className="dashboard-header">
                <div>
                    <h1>Assistant Telemetry</h1>
                    <p className="subtitle">Query volume, reference match rate, and interaction logs</p>
                </div>
                <button className="btn-secondary" onClick={fetchAnalytics}>
                    Refresh
                </button>
            </header>

            <div className="metric-strip">
                <div className="metric-cell">
                    <div className="metric-label">Total Queries</div>
                    <div className="metric-value">{summary.total_queries}</div>
                    <div className="metric-sub">Patient care inquiries</div>
                </div>

                <div className="metric-cell">
                    <div className="metric-label">Patients Assisted</div>
                    <div className="metric-value">{summary.unique_patients}</div>
                    <div className="metric-sub">Distinct patient sessions</div>
                </div>

                <div className="metric-cell">
                    <div className="metric-label">Reference Match Rate</div>
                    <div className="metric-value">{summary.rag_hit_rate_percent}%</div>
                    <div className="metric-sub">{summary.total_rag_chunks} reference sections</div>
                </div>

                <div className="metric-cell">
                    <div className="metric-label">Mean Latency</div>
                    <div className="metric-value">{summary.avg_response_time_ms} ms</div>
                    <div className="metric-sub">Average response time</div>
                </div>
            </div>

            <div className="analytics-grid">
                <div className="panel">
                    <div className="panel-section">
                        <span className="panel-label">Topic Distribution</span>
                        <p className="section-hint" style={{ marginBottom: '1rem' }}>
                            Queries grouped by clinical category
                        </p>

                        {topics.length === 0 ? (
                            <p className="section-hint">No queries logged yet.</p>
                        ) : (
                            <div>
                                {topics.map((item, idx) => {
                                    const widthPct = Math.round((item.count / maxTopicCount) * 100);
                                    return (
                                        <div key={idx} className="topic-row">
                                            <div className="topic-row-header">
                                                <span style={{ fontWeight: 500 }}>{item.topic}</span>
                                                <span className="mono">{item.count}</span>
                                            </div>
                                            <div className="topic-bar-track">
                                                <div className="topic-bar-fill" style={{ width: `${widthPct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="panel">
                    <div className="panel-section">
                        <span className="panel-label">Interaction Audit Log</span>
                        <p className="section-hint" style={{ marginBottom: '0.85rem' }}>
                            Recent patient questions, responses, and cited references
                        </p>

                        {loading ? (
                            <p className="section-hint">Loading telemetry...</p>
                        ) : recent_logs.length === 0 ? (
                            <p className="section-hint">No patient interactions recorded yet.</p>
                        ) : (
                            <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                                {recent_logs.map((log, idx) => (
                                    <div key={log.id || idx} className="audit-log-item">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.3rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <strong style={{ fontSize: '0.86rem' }}>{log.patient_name || 'Patient'}</strong>
                                                <span className="source-tag">{log.topic || 'General Care'}</span>
                                            </div>
                                            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                {log.response_time_ms ? `${log.response_time_ms} ms` : ''}
                                            </span>
                                        </div>

                                        <div style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                                            <strong>Q:</strong> {log.question}
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                            <strong>A:</strong> {log.answer}
                                        </div>

                                        {Array.isArray(log.sources) && log.sources.length > 0 && (
                                            <div className="chat-sources" style={{ borderTop: 'none', paddingTop: 0, marginTop: '0.4rem' }}>
                                                <span className="section-hint">References:</span>
                                                {log.sources.map((s, i) => (
                                                    <span key={i} className="source-tag">{s}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
