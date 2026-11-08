import React, { useState, useEffect, useRef } from 'react';
import { formatTimestamp } from '../utils/formatTime';

const FIELD_LABELS = {
    full_name: 'Full Name',
    dob: 'Date of Birth',
    contact: 'Contact (Phone)',
    policy_number: 'Policy Number',
    complaint: 'Primary Complaint / Reason'
};

export function PatientRegistrationModal({ isOpen, onClose, onRegister }) {
    const [step, setStep] = useState('upload');
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);
    const [visitTime, setVisitTime] = useState('');
    const [formData, setFormData] = useState({
        full_name: '',
        dob: '',
        contact: '',
        policy_number: '',
        complaint: ''
    });
    const [errors, setErrors] = useState({});
    const [extractionWarning, setExtractionWarning] = useState('');

    const validateFields = (data, isPostExtraction = false) => {
        const newErrors = {};
        const missingLabels = [];

        Object.keys(FIELD_LABELS).forEach((key) => {
            const val = String(data[key] || '').trim();
            if (!val) {
                newErrors[key] = isPostExtraction
                    ? `${FIELD_LABELS[key]} could not be detected from the document.`
                    : `${FIELD_LABELS[key]} is required.`;
                missingLabels.push(FIELD_LABELS[key]);
            }
        });

        if (data.contact && !/^\d+$/.test(String(data.contact).trim())) {
            newErrors.contact = 'Contact phone number must contain digits only (0-9).';
        }

        return { newErrors, missingLabels };
    };

    useEffect(() => {
        if (isOpen) {
            setStep('upload');
            setVisitTime(new Date().toISOString());
            setFormData({
                full_name: '',
                dob: '',
                contact: '',
                policy_number: '',
                complaint: ''
            });
            setErrors({});
            setExtractionWarning('');
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
            if (fileInputRef.current) fileInputRef.current.value = '';
        }

        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            startExtraction(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            startExtraction(e.target.files[0]);
        }
    };

    const startExtraction = async (file) => {
        setStep('processing');
        setErrors({});
        setExtractionWarning('');
        setVisitTime(new Date().toISOString());

        const uploadPayload = new FormData();
        uploadPayload.append('file', file);

        try {
            const response = await fetch('http://127.0.0.1:5001/extract', {
                method: 'POST',
                body: uploadPayload,
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            const digitsOnlyContact = String(data?.contact || '').replace(/\D/g, '');
            const extractedForm = {
                full_name: String(data?.full_name || '').trim(),
                dob: String(data?.dob || '').trim(),
                contact: digitsOnlyContact,
                policy_number: String(data?.policy_number || '').trim(),
                complaint: String(data?.complaint || '').trim()
            };

            setFormData(extractedForm);

            const { newErrors, missingLabels } = validateFields(extractedForm, true);
            setErrors(newErrors);
            if (missingLabels.length > 0) {
                setExtractionWarning(
                    `Incomplete OCR extraction. Missing fields: ${missingLabels.join(', ')}. Complete the highlighted fields below.`
                );
            } else {
                setExtractionWarning('');
            }

            setStep('review');
        } catch (error) {
            console.error("Error uploading file:", error);
            const emptyForm = {
                full_name: '',
                dob: '',
                contact: '',
                policy_number: '',
                complaint: ''
            };
            const { newErrors } = validateFields(emptyForm, true);
            setErrors(newErrors);
            setExtractionWarning('Automatic extraction failed. Please enter the required fields manually.');
            setStep('review');
        }
    };

    const handleConfirm = () => {
        const { newErrors, missingLabels } = validateFields(formData, false);
        setErrors(newErrors);

        if (Object.keys(newErrors).length > 0) {
            if (missingLabels.length > 0) {
                setExtractionWarning(`Required fields missing: ${missingLabels.join(', ')}.`);
            }
            return;
        }

        if (onRegister) {
            onRegister({
                ...formData,
                contact: String(formData.contact).replace(/\D/g, ''),
                visit_time: visitTime || new Date().toISOString()
            });
        }
        onClose();
    };

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'contact') {
            const hasNonDigits = /\D/.test(value);
            const digitsOnly = value.replace(/\D/g, '');
            setFormData(prev => ({ ...prev, contact: digitsOnly }));
            setErrors(prev => ({
                ...prev,
                contact: hasNonDigits
                    ? 'Only digits (0-9) are allowed in the Contact field.'
                    : digitsOnly.trim() === ''
                    ? 'Contact (Phone) is required.'
                    : undefined
            }));
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
        setErrors(prev => ({
            ...prev,
            [name]: value.trim() === '' ? `${FIELD_LABELS[name]} is required.` : undefined
        }));
    };

    if (!isOpen) return null;

    const hasAnyErrors = Object.values(errors).some(Boolean);

    return (
        <div className="modal-overlay">
            <div className="modal-container">
                <header className="modal-header">
                    <h2>New Patient Registration</h2>
                    <button className="close-btn" onClick={onClose} aria-label="Close">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </header>
                <div className="modal-content">
                    {step === 'upload' && (
                        <div
                            className={`upload-zone ${dragActive ? 'active' : ''}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                style={{ display: 'none' }}
                                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                            />
                            <div className="upload-icon">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                            </div>
                            <h3>Upload Registration Document</h3>
                            <p>Drop a PDF or handwritten registration form here, or click to browse</p>
                            <span className="upload-hint">Supports PDF, JPG, PNG</span>
                        </div>
                    )}

                    {step === 'processing' && (
                        <div className="processing-state">
                            <div className="spinner"></div>
                            <p>Extracting patient registration details...</p>
                        </div>
                    )}

                    {step === 'review' && (
                        <div className="review-form">
                            {extractionWarning || hasAnyErrors ? (
                                <div className="alert-banner error">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '1px' }}>
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <line x1="12" y1="8" x2="12" y2="12"></line>
                                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                    </svg>
                                    <span>{extractionWarning || 'Please resolve the highlighted field errors below before confirming.'}</span>
                                </div>
                            ) : (
                                <div className="alert-banner success">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    <span>All registration fields extracted and verified.</span>
                                </div>
                            )}

                            <div className="form-section">
                                <div className="section-header-row">
                                    <h4>Patient Identity</h4>
                                    <span className="section-hint mono">Visit Time: {formatTimestamp(visitTime)}</span>
                                </div>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Full Name *</label>
                                        <input
                                            type="text"
                                            name="full_name"
                                            value={formData.full_name}
                                            onChange={handleChange}
                                            className={errors.full_name ? 'input-error' : ''}
                                        />
                                        {errors.full_name && <span className="field-error">{errors.full_name}</span>}
                                    </div>
                                    <div className="form-group">
                                        <label>Date of Birth *</label>
                                        <input
                                            type="date"
                                            name="dob"
                                            value={formData.dob}
                                            onChange={handleChange}
                                            className={`mono ${errors.dob ? 'input-error' : ''}`}
                                        />
                                        {errors.dob && <span className="field-error">{errors.dob}</span>}
                                    </div>
                                    <div className="form-group">
                                        <label>Contact Phone (Digits Only) *</label>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            name="contact"
                                            placeholder="e.g. 91234567"
                                            value={formData.contact}
                                            onChange={handleChange}
                                            className={`mono ${errors.contact ? 'input-error' : ''}`}
                                        />
                                        {errors.contact && <span className="field-error">{errors.contact}</span>}
                                    </div>
                                    <div className="form-group">
                                        <label>Insurance Policy Number *</label>
                                        <input
                                            type="text"
                                            name="policy_number"
                                            value={formData.policy_number}
                                            onChange={handleChange}
                                            className={`mono ${errors.policy_number ? 'input-error' : ''}`}
                                        />
                                        {errors.policy_number && <span className="field-error">{errors.policy_number}</span>}
                                    </div>
                                </div>
                            </div>

                            <div className="form-section">
                                <h4>Clinical Intake</h4>
                                <div className="form-group">
                                    <label>Primary Complaint / Reason for Visit *</label>
                                    <textarea
                                        name="complaint"
                                        rows="3"
                                        value={formData.complaint}
                                        onChange={handleChange}
                                        className={errors.complaint ? 'input-error' : ''}
                                    ></textarea>
                                    {errors.complaint && <span className="field-error">{errors.complaint}</span>}
                                </div>
                            </div>

                            <div className="form-actions">
                                <button className="btn-secondary" onClick={onClose}>Cancel</button>
                                <button className="btn-primary" onClick={handleConfirm}>Confirm Registration</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
