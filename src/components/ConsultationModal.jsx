import React, { useState, useEffect } from 'react';
import { formatTimestamp } from '../utils/formatTime';

export function ConsultationModal({ isOpen, onClose, patient, onSave }) {
    const [diagnosis, setDiagnosis] = useState('');
    const [prescription, setPrescription] = useState([
        { id: 1, medicine: '', dosage: '', frequency: '', purpose: '' },
        { id: 2, medicine: '', dosage: '', frequency: '', purpose: '' },
        { id: 3, medicine: '', dosage: '', frequency: '', purpose: '' }
    ]);
    const [patientInfo, setPatientInfo] = useState({
        dob: '',
        contact: '',
        policy_number: '',
        complaint: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [draftSavedNotice, setDraftSavedNotice] = useState(false);

    useEffect(() => {
        if (isOpen && patient) {
            setDiagnosis(patient.diagnosis || '');
            setPatientInfo({
                dob: patient.dob || '',
                contact: patient.contact || '',
                policy_number: patient.policy_number || '',
                complaint: patient.complaint || ''
            });
            setDraftSavedNotice(false);

            if (patient.prescription && Array.isArray(patient.prescription) && patient.prescription.length > 0) {
                setPrescription(
                    patient.prescription.map((rawP, idx) => {
                        let p = rawP;
                        if (typeof p === 'string') {
                            try { p = JSON.parse(p); } catch { /* noop */ }
                        }
                        return {
                            id: p.id || idx + 1,
                            medicine: p.medicine || '',
                            dosage: p.dosage || '',
                            frequency: p.frequency || '',
                            purpose: p.purpose || '',
                            instructions: p.instructions || '',
                            unit_price: p.unit_price || ''
                        };
                    })
                );
            } else {
                setPrescription([
                    { id: 1, medicine: '', dosage: '', frequency: '', purpose: '' },
                    { id: 2, medicine: '', dosage: '', frequency: '', purpose: '' },
                    { id: 3, medicine: '', dosage: '', frequency: '', purpose: '' }
                ]);
            }
        }
    }, [patient, isOpen]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    const handlePrescriptionChange = (id, field, value) => {
        setPrescription(prev => prev.map(row =>
            row.id === id ? { ...row, [field]: value } : row
        ));
    };

    const addRow = () => {
        const newId = prescription.length > 0 ? Math.max(...prescription.map(p => p.id)) + 1 : 1;
        setPrescription([...prescription, { id: newId, medicine: '', dosage: '', frequency: '', purpose: '' }]);
    };

    const deleteRow = (id) => {
        setPrescription(prev => prev.filter(row => row.id !== id));
    };

    const handleSave = () => {
        const consultationData = {
            name: patient.full_name,
            created_at: patient.created_at || patient.visit_time,
            diagnosis,
            prescription: prescription.filter(p => p.medicine.trim() !== ''),
            dob: patientInfo.dob,
            contact: patientInfo.contact.replace(/\D/g, ''),
            policy_number: patientInfo.policy_number,
            complaint: patientInfo.complaint,
            status: 'Draft'
        };
        if (onSave) onSave(consultationData);
        setDraftSavedNotice(true);
        setTimeout(() => setDraftSavedNotice(false), 2500);
    };

    const handleSubmit = async () => {
        setIsSubmitting(true);
        const nowIso = new Date().toISOString();
        const consultationData = {
            name: patient.full_name,
            created_at: patient.created_at || patient.visit_time,
            diagnosis,
            prescription: prescription.filter(p => p.medicine.trim() !== ''),
            dob: patientInfo.dob,
            contact: patientInfo.contact.replace(/\D/g, ''),
            policy_number: patientInfo.policy_number,
            complaint: patientInfo.complaint,
            consultation_time: patient.consultation_time || nowIso,
            status: 'Consulted'
        };

        try {
            const response = await fetch('http://127.0.0.1:5001/consultation', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(consultationData),
            });
            const result = await response.json();
            const enrichedPrescription = result.prescription || consultationData.prescription;

            if (onSave) {
                onSave({
                    ...consultationData,
                    ...result.patient,
                    prescription: enrichedPrescription,
                    consultation_time: result.consultation_time || consultationData.consultation_time
                });
            }
            onClose();
        } catch (error) {
            console.error("Error submitting consultation:", error);
            if (onSave) onSave(consultationData);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !patient) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-container wide">
                <header className="modal-header">
                    <div>
                        <h2>Consultation: {patient.full_name}</h2>
                        <p className="modal-subtitle">
                            Visit Time: <span className="tabular">{formatTimestamp(patient.visit_time || patient.created_at)}</span>
                            {patient.consultation_time && (
                                <> · Consulted: <span className="tabular">{formatTimestamp(patient.consultation_time)}</span></>
                            )}
                        </p>
                    </div>
                    <button className="close-btn" onClick={onClose} aria-label="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </header>

                <div className="modal-content">
                    {/* Patient Information & Presenting Complaint */}
                    <div className="form-section" style={{ background: 'var(--surface-subtle)', padding: '0.9rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                        <div className="patient-meta-grid" style={{ margin: 0, padding: 0, border: 'none' }}>
                            <div className="meta-item">
                                <span>Date of Birth</span>
                                <strong>{patientInfo.dob || '—'}</strong>
                            </div>
                            <div className="meta-item">
                                <span>Contact</span>
                                <strong>{patientInfo.contact || '—'}</strong>
                            </div>
                            <div className="meta-item">
                                <span>Policy ID</span>
                                <strong>{patientInfo.policy_number || '—'}</strong>
                            </div>
                        </div>
                    </div>

                    {/* Presenting Complaint Section */}
                    <div className="form-section">
                        <h4>Presenting Complaint</h4>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.35rem', lineHeight: '1.5' }}>
                            {patientInfo.complaint || 'No complaint recorded.'}
                        </p>
                    </div>

                    {/* Clinical Diagnosis (Editable anytime by Doctor) */}
                    <div className="form-section">
                        <h4>Clinical Diagnosis</h4>
                        <div className="form-group">
                            <textarea
                                rows="3"
                                placeholder="Enter clinical findings, diagnosis, and care plan..."
                                value={diagnosis}
                                onChange={(e) => setDiagnosis(e.target.value)}
                            ></textarea>
                        </div>
                    </div>

                    {/* Prescriptions (Editable anytime by Doctor) */}
                    <div className="form-section">
                        <div className="section-header-row">
                            <h4>Prescription &amp; Targeted Indications</h4>
                        </div>
                        <table className="prescription-table">
                            <thead>
                                <tr>
                                    <th>Medication</th>
                                    <th>Dosage</th>
                                    <th>Frequency</th>
                                    <th>Targets / Purpose</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {prescription.map((row) => (
                                    <tr key={row.id}>
                                        <td>
                                            <input
                                                type="text"
                                                placeholder="e.g. Paracetamol"
                                                value={row.medicine}
                                                onChange={(e) => handlePrescriptionChange(row.id, 'medicine', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                placeholder="e.g. 500mg"
                                                value={row.dosage}
                                                onChange={(e) => handlePrescriptionChange(row.id, 'dosage', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                placeholder="e.g. 3x daily"
                                                value={row.frequency}
                                                onChange={(e) => handlePrescriptionChange(row.id, 'frequency', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="text"
                                                placeholder="e.g. Reduces fever and headache"
                                                value={row.purpose || ''}
                                                onChange={(e) => handlePrescriptionChange(row.id, 'purpose', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <button className="btn-icon danger" onClick={() => deleteRow(row.id)} title="Remove row">
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button className="btn-secondary small" onClick={addRow}>+ Add Medication</button>
                    </div>

                    <div className="form-actions split">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <button className="btn-secondary" onClick={handleSave} disabled={isSubmitting}>Save Draft</button>
                            {draftSavedNotice && <span className="section-hint">Draft saved</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '0.65rem' }}>
                            <button className="btn-secondary" onClick={onClose}>Close</button>
                            <button className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? 'Saving...' : patient.status === 'Consulted' ? 'Update Consultation' : 'Complete Consultation'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
