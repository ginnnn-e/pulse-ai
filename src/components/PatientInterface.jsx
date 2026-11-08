import React, { useState, useEffect, useRef } from 'react';
import { formatTimestamp } from '../utils/formatTime';

function renderFormattedText(text) {
    if (!text) return null;
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={idx}>{part.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
}

export function PatientInterface() {
    const [patients, setPatients] = useState([]);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const chatEndRef = useRef(null);

    const handleSelectPatient = (patient) => {
        setSelectedPatient(patient);
        setMessages([]);
    };

    useEffect(() => {
        let active = true;
        const loadPatients = async () => {
            try {
                const res = await fetch('http://127.0.0.1:5001/patients');
                const data = await res.json();
                if (!active) return;
                const list = Array.isArray(data) ? data : [];
                setPatients(list);
                if (list.length > 0) {
                    const consulted = list.find(p => p.status === 'Consulted') || list[0];
                    handleSelectPatient(consulted);
                }
            } catch (err) {
                console.error('Error loading patients in PatientInterface:', err);
            }
        };
        loadPatients();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendQuestion = async (questionText) => {
        const q = (questionText ?? input).trim();
        if (!q || isSending) return;

        const userMsg = { id: Date.now(), role: 'user', text: q };
        const updatedHistory = [...messages, userMsg];
        setMessages(updatedHistory);
        setInput('');
        setIsSending(true);

        try {
            const res = await fetch('http://127.0.0.1:5001/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_name: selectedPatient?.full_name || '',
                    question: q,
                    history: updatedHistory.map(m => ({ role: m.role, text: m.text }))
                })
            });
            const data = await res.json();
            setMessages(prev => [
                ...prev,
                {
                    id: Date.now() + 1,
                    role: 'assistant',
                    text: data.answer || 'I could not process that request. Please try again.',
                    topic: data.topic,
                    sources: data.sources || [],
                    responseTimeMs: data.response_time_ms
                }
            ]);
        } catch (err) {
            console.error('Error calling /chat:', err);
            setMessages(prev => [
                ...prev,
                {
                    id: Date.now() + 1,
                    role: 'assistant',
                    text: 'Unable to reach the backend server at http://127.0.0.1:5001. Ensure the Flask server is running.'
                }
            ]);
        } finally {
            setIsSending(false);
        }
    };

    const handleDownloadQuotationPdf = async () => {
        if (!selectedPatient) return;
        setIsGeneratingPdf(true);
        try {
            const res = await fetch('http://127.0.0.1:5001/quotation-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(selectedPatient)
            });
            if (!res.ok) throw new Error('Failed to generate PDF');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (selectedPatient.full_name || 'Patient').replace(/\s+/g, '_');
            a.download = `PulseAI_Quotation_${safeName}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error generating quotation PDF:', err);
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const rawPrescriptions = Array.isArray(selectedPatient?.prescription) ? selectedPatient.prescription : [];
    const prescriptions = rawPrescriptions.map((item, idx) => {
        if (typeof item === 'string') {
            try {
                return JSON.parse(item);
            } catch {
                return { id: idx + 1, medicine: item };
            }
        }
        return item;
    });
    const consultationFee = 65.0;
    const medTotal = prescriptions.reduce((sum, p, idx) => sum + Number(p.unit_price || (15 + idx * 7.5)), 0);
    const subtotal = consultationFee + medTotal;
    const gst = subtotal * 0.09;
    const grossTotal = subtotal + gst;
    const insuranceSubsidy = selectedPatient?.policy_number ? grossTotal * 0.7 : 0;
    const netPayable = grossTotal - insuranceSubsidy;

    const quickPrompts = [
        'What does each medication treat?',
        'How should I take my prescribed medicines?',
        'What side effects should I watch for?',
        'Explain my diagnosis in plain terms'
    ];

    return (
        <div className="patient-interface">
            <header className="dashboard-header">
                <div>
                    <h1>Patient Care Summary</h1>
                    <p className="subtitle">Post-consultation diagnosis, medication guide, billing statement, and care assistant</p>
                </div>

                <div className="header-controls">
                    {patients.length > 0 && (
                        <select
                            className="select-control"
                            value={`${selectedPatient?.full_name || ''}__${selectedPatient?.created_at || ''}`}
                            onChange={(e) => {
                                const found = patients.find(
                                    p => `${p.full_name}__${p.created_at || ''}` === e.target.value
                                );
                                if (found) handleSelectPatient(found);
                            }}
                        >
                            {patients.map(p => (
                                <option
                                    key={`${p.full_name}__${p.created_at || p.visit_time}`}
                                    value={`${p.full_name}__${p.created_at || ''}`}
                                >
                                    {p.full_name} — {formatTimestamp(p.created_at || p.visit_time)} ({p.status || 'Registered'})
                                </option>
                            ))}
                        </select>
                    )}

                    <button
                        className="btn-primary"
                        onClick={handleDownloadQuotationPdf}
                        disabled={!selectedPatient || isGeneratingPdf}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        {isGeneratingPdf ? 'Exporting PDF...' : 'Download Quotation PDF'}
                    </button>
                </div>
            </header>

            {!selectedPatient ? (
                <div className="content-area is-empty">
                    <div className="empty-state">
                        <h3>No patient records available</h3>
                        <p>Register a patient in the Staff Dashboard and complete a consultation to view care summaries.</p>
                    </div>
                </div>
            ) : (
                <div className="portal-grid">
                    {/* Left Column: Unified Clinical Record & Billing Panel */}
                    <div className="panel">
                        <div className="panel-section">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <span className="panel-label">Visit Record</span>
                                    <h2 style={{ fontSize: '1.15rem', fontWeight: 700 }}>{selectedPatient.full_name}</h2>
                                </div>
                                <span className={`status-badge ${selectedPatient.status === 'Consulted' ? 'success' : 'warning'}`}>
                                    {selectedPatient.status || 'Registered'}
                                </span>
                            </div>

                            <div className="patient-meta-grid">
                                <div className="meta-item">
                                    <span>Date of Birth</span>
                                    <strong>{selectedPatient.dob || '—'}</strong>
                                </div>
                                <div className="meta-item">
                                    <span>Contact</span>
                                    <strong>{selectedPatient.contact || '—'}</strong>
                                </div>
                                <div className="meta-item">
                                    <span>Insurance Policy</span>
                                    <strong>{selectedPatient.policy_number || 'Self-Pay'}</strong>
                                </div>
                                <div className="meta-item">
                                    <span>Time of Visit</span>
                                    <strong className="tabular">{formatTimestamp(selectedPatient.visit_time || selectedPatient.created_at)}</strong>
                                </div>
                                <div className="meta-item">
                                    <span>Time of Consultation</span>
                                    <strong className="tabular">{formatTimestamp(selectedPatient.consultation_time)}</strong>
                                </div>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <span className="panel-label">Presenting Complaint</span>
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.2rem', lineHeight: '1.5' }}>
                                    {selectedPatient.complaint || 'No complaint recorded.'}
                                </p>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <span className="panel-label">Clinical Diagnosis</span>
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.2rem', lineHeight: '1.5' }}>
                                    {selectedPatient.diagnosis || 'Pending physician consultation.'}
                                </p>
                            </div>
                        </div>

                        <div className="panel-section">
                            <span className="panel-label">Prescribed Medications &amp; Indications</span>
                            {prescriptions.length === 0 ? (
                                <p className="section-hint" style={{ marginTop: '0.35rem' }}>
                                    No medications prescribed for this visit yet.
                                </p>
                            ) : (
                                <div className="rx-list">
                                    {prescriptions.map((med, idx) => (
                                        <div key={med.id || idx} className="rx-row">
                                            <div className="rx-row-header">
                                                <span className="rx-name">{med.medicine}</span>
                                                <span className="rx-dosage">{med.dosage} · {med.frequency}</span>
                                            </div>
                                            <div className="rx-purpose">
                                                <strong>Treats: </strong>
                                                {med.purpose || `Symptoms associated with ${selectedPatient.diagnosis || selectedPatient.complaint || 'presenting condition'}.`}
                                            </div>
                                            {med.instructions && (
                                                <div className="rx-instructions">
                                                    Directions: {med.instructions}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="panel-section">
                            <div className="section-header-row">
                                <span className="panel-label">Itemized Billing Quotation</span>
                                <span className="section-hint">USD</span>
                            </div>

                            <div className="invoice-row">
                                <span>Specialist Consultation</span>
                                <span className="mono">${consultationFee.toFixed(2)}</span>
                            </div>
                            {prescriptions.map((med, idx) => {
                                const price = Number(med.unit_price || (15 + idx * 7.5));
                                return (
                                    <div key={med.id || idx} className="invoice-row">
                                        <span>{med.medicine} ({med.dosage})</span>
                                        <span className="mono">${price.toFixed(2)}</span>
                                    </div>
                                );
                            })}
                            <div className="invoice-row Muted">
                                <span>GST (9%)</span>
                                <span className="mono">${gst.toFixed(2)}</span>
                            </div>
                            {insuranceSubsidy > 0 && (
                                <div className="invoice-row discount">
                                    <span>Policy Coverage ({selectedPatient.policy_number} · 70%)</span>
                                    <span className="mono">-${insuranceSubsidy.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="invoice-row total">
                                <span>Net Payable</span>
                                <span className="mono">${netPayable.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Care Assistant */}
                    <div className="panel chat-panel">
                        <div className="chat-header">
                            <div>
                                <h3>Medication &amp; Care Assistant</h3>
                                <p className="section-hint">
                                    Answers based on your consultation record and clinic reference documents
                                </p>
                            </div>
                        </div>

                        <div className="chat-prompts">
                            {quickPrompts.map((prompt, i) => (
                                <button
                                    key={i}
                                    className="prompt-chip"
                                    onClick={() => sendQuestion(prompt)}
                                    disabled={isSending}
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>

                        <div className="chat-messages">
                            {messages.length === 0 && (
                                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                                    <p>Select a question above or type below to ask about your diagnosis, medication indications, or care advice.</p>
                                </div>
                            )}
                            {messages.map(msg => (
                                <div key={msg.id} className={`chat-bubble ${msg.role}`}>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>
                                        {renderFormattedText(msg.text)}
                                    </div>

                                    {msg.sources && msg.sources.length > 0 && (
                                        <div className="chat-sources">
                                            <span className="section-hint">References:</span>
                                            {msg.sources.map((src, idx) => (
                                                <span key={idx} className="source-tag">{src}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {isSending && (
                                <div className="chat-bubble assistant" style={{ color: 'var(--text-muted)' }}>
                                    Searching clinical references...
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <form
                            className="chat-input-bar"
                            onSubmit={(e) => {
                                e.preventDefault();
                                sendQuestion();
                            }}
                        >
                            <input
                                type="text"
                                placeholder="Ask a question about your diagnosis or medications..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={isSending}
                            />
                            <button type="submit" className="btn-primary" disabled={isSending || !input.trim()}>
                                Send
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
