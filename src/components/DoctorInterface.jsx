import React, { useState, useEffect } from 'react';
import { ConsultationModal } from './ConsultationModal';
import { formatTimestamp } from '../utils/formatTime';

export function DoctorInterface() {
    const [patients, setPatients] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState(null);

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

    const handleConsultationSave = (data) => {
        setPatients(prev => prev.map(p =>
            (p.full_name === data.name && (!data.created_at || p.created_at === data.created_at))
                ? {
                    ...p,
                    status: data.status || p.status,
                    diagnosis: data.diagnosis,
                    prescription: data.prescription,
                    consultation_time: data.consultation_time || p.consultation_time
                }
                : p
        ));
        fetchPatients();
    };

    const awaitingConsultation = patients
        .filter(p => p.status !== 'Consulted')
        .sort((a, b) => new Date(a.visit_time || a.created_at) - new Date(b.visit_time || b.created_at));

    const completedConsultations = patients
        .filter(p => p.status === 'Consulted')
        .sort((a, b) => new Date(b.consultation_time || b.created_at) - new Date(a.consultation_time || a.created_at));

    return (
        <div className="doctor-interface">
            <header className="dashboard-header">
                <div>
                    <h1>Physician Consultations</h1>
                    <p className="subtitle">Select a patient to record clinical diagnosis and prescriptions</p>
                </div>
            </header>
            <div className={`content-area ${patients.length === 0 ? 'is-empty' : ''}`}>
                {patients.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                            </svg>
                        </div>
                        <h3>No patients awaiting consultation</h3>
                        <p>Checked-in patients from the Staff Dashboard will appear here.</p>
                    </div>
                ) : (
                    <div className="patient-list">
                        <div className="list-header">
                            <span>Patient &amp; Complaint</span>
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
                                No patients currently waiting for consultation.
                            </div>
                        ) : (
                            awaitingConsultation.map(patient => (
                                <div
                                    key={`${patient.full_name}__${patient.created_at || patient.visit_time}`}
                                    className="patient-card clickable"
                                    onClick={() => setSelectedPatient(patient)}
                                >
                                    <div className="patient-info">
                                        <strong>{patient.full_name}</strong>
                                        {patient.complaint && (
                                            <span className="mrn">{patient.complaint}</span>
                                        )}
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

                        {/* Tier 2: Completed Consultations (Most recent first) */}
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
                                <div
                                    key={`${patient.full_name}__${patient.created_at || patient.visit_time}`}
                                    className="patient-card clickable completed-tier"
                                    onClick={() => setSelectedPatient(patient)}
                                >
                                    <div className="patient-info">
                                        <strong>{patient.full_name}</strong>
                                        {patient.complaint && (
                                            <span className="mrn">{patient.complaint}</span>
                                        )}
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

            <ConsultationModal
                isOpen={!!selectedPatient}
                patient={selectedPatient}
                onClose={() => setSelectedPatient(null)}
                onSave={handleConsultationSave}
            />
        </div>
    );
}
