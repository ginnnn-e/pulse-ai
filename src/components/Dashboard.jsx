import React, { useState, useEffect } from 'react';
import { PatientRegistrationModal } from './PatientRegistrationModal';
import { formatTimestamp } from '../utils/formatTime';

export function Dashboard({ onNavigate }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [patients, setPatients] = useState([]);

    const fetchPatients = async () => {
        try {
            const response = await fetch('http://127.0.0.1:5001/patients');
            const result = await response.json();
            setPatients(Array.isArray(result) ? result : []);
        } catch (error) {
            console.error('Error fetching patients:', error);
        }
    };

    useEffect(() => {
        let active = true;
        fetch('http://127.0.0.1:5001/patients')
            .then(res => res.json())
            .then(result => {
                if (active) setPatients(Array.isArray(result) ? result : []);
            })
            .catch(err => console.error('Error fetching patients:', err));
        return () => { active = false; };
    }, []);

    const registerPatient = async (data) => {
        const response = await fetch('http://127.0.0.1:5001/register', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...data,
                created_at: data.visit_time || new Date().toISOString(),
                visit_time: data.visit_time || new Date().toISOString()
            }),
        });
        return response.json();
    };

    const handleConfirm = async (data) => {
        setIsModalOpen(false);
        await registerPatient(data);
        await fetchPatients();
    };

    const awaitingConsultation = patients
        .filter(p => p.status !== 'Consulted')
        .sort((a, b) => new Date(a.visit_time || a.created_at) - new Date(b.visit_time || b.created_at));

    const completedConsultations = patients
        .filter(p => p.status === 'Consulted')
        .sort((a, b) => new Date(b.consultation_time || b.created_at) - new Date(a.consultation_time || a.created_at));

    return (
        <div className="dashboard">
            <header className="dashboard-header">
                <div className="header-text">
                    <h1>Daily Patient Queue</h1>
                    <p className="subtitle">Manage intake registrations, visit times, and consultation status</p>
                </div>
                <div className="header-controls">
                    <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Register Patient
                    </button>
                </div>
            </header>

            <div className={`content-area ${patients.length === 0 ? 'is-empty' : ''}`}>
                {patients.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                        </div>
                        <h3>No patients in today&apos;s queue</h3>
                        <p>Upload a registration form or policy document to extract patient details and add them to the queue.</p>
                        <a href="#register" className="action-link" onClick={(e) => { e.preventDefault(); setIsModalOpen(true); }}>
                            Register first patient
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </a>
                    </div>
                ) : (
                    <div className="patient-list">
                        <div className="list-header">
                            <span>Patient</span>
                            <span>DOB &amp; Contact</span>
                            <span>Policy ID</span>
                            <span>Time of Visit</span>
                            <span>Time of Consultation</span>
                            <span>Status</span>
                        </div>

                        {/* Tier 1: Awaiting Consultation (FIFO by visit time) */}
                        <div className="queue-section-header waiting">
                            <span>Awaiting Consultation</span>
                            <span className="queue-count-pill">{awaitingConsultation.length} waiting</span>
                        </div>
                        {awaitingConsultation.length === 0 ? (
                            <div style={{ padding: '0.85rem 1.15rem', color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                                No patients currently waiting in queue.
                            </div>
                        ) : (
                            awaitingConsultation.map(patient => (
                                <div key={`${patient.full_name}__${patient.created_at || patient.visit_time}`} className="patient-card">
                                    <div className="patient-info">
                                        <strong>{patient.full_name}</strong>
                                        {patient.complaint && <span className="mrn">{patient.complaint}</span>}
                                    </div>
                                    <div className="patient-info">
                                        <span>{patient.dob}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{patient.contact}</span>
                                    </div>
                                    <div className="tabular">{patient.policy_number}</div>
                                    <div className="tabular">{formatTimestamp(patient.visit_time || patient.created_at)}</div>
                                    <div className="tabular">{formatTimestamp(patient.consultation_time)}</div>
                                    <div>
                                        <span className="status-badge warning">
                                            {patient.status || 'Registered'}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}

                        {/* Tier 2: Completed Consultations (Most recent consultation first) */}
                        <div className="queue-section-header completed">
                            <span>Completed Consultations</span>
                            <span className="queue-count-pill">{completedConsultations.length} consulted</span>
                        </div>
                        {completedConsultations.length === 0 ? (
                            <div style={{ padding: '0.85rem 1.15rem', color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                                No completed consultations recorded yet today.
                            </div>
                        ) : (
                            completedConsultations.map(patient => (
                                <div key={`${patient.full_name}__${patient.created_at || patient.visit_time}`} className="patient-card completed-tier">
                                    <div className="patient-info">
                                        <strong>{patient.full_name}</strong>
                                        {patient.complaint && <span className="mrn">{patient.complaint}</span>}
                                    </div>
                                    <div className="patient-info">
                                        <span>{patient.dob}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{patient.contact}</span>
                                    </div>
                                    <div className="tabular">{patient.policy_number}</div>
                                    <div className="tabular">{formatTimestamp(patient.visit_time || patient.created_at)}</div>
                                    <div className="tabular">{formatTimestamp(patient.consultation_time)}</div>
                                    <div>
                                        <span className="status-badge success">
                                            Consulted
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            <PatientRegistrationModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onRegister={handleConfirm} />
        </div>
    );
}
