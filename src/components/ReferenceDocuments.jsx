import React, { useState, useEffect, useRef } from 'react';
import { formatTimestamp } from '../utils/formatTime';

export function ReferenceDocuments() {
    const [documents, setDocuments] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [uploadMessage, setUploadMessage] = useState('');
    const [selectedDoc, setSelectedDoc] = useState(null);
    const [deletingId, setDeletingId] = useState(null);
    const fileInputRef = useRef(null);

    const fetchDocuments = async () => {
        try {
            const res = await fetch('http://127.0.0.1:5001/medical-docs');
            const data = await res.json();
            setDocuments(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error loading documents:', err);
        }
    };

    const handleDeleteDoc = async (e, doc) => {
        e.stopPropagation();
        const targetId = doc.document_id || doc.id || doc.filename;
        if (!targetId) return;

        const confirmDelete = window.confirm(`Are you sure you want to delete "${doc.filename}" from Supabase?`);
        if (!confirmDelete) return;

        setDeletingId(targetId);
        try {
            const res = await fetch(`http://127.0.0.1:5001/medical-docs/${encodeURIComponent(targetId)}`, {
                method: 'DELETE',
            });
            if (res.ok) {
                setUploadMessage(`Deleted "${doc.filename}" from Supabase successfully.`);
                if (selectedDoc && (selectedDoc.document_id === targetId || selectedDoc.id === targetId)) {
                    setSelectedDoc(null);
                }
                await fetchDocuments();
            } else {
                setUploadMessage('Failed to delete document from Supabase.');
            }
        } catch (err) {
            console.error('Error deleting document:', err);
            setUploadMessage('Error connecting to server to delete document.');
        } finally {
            setDeletingId(null);
        }
    };

    useEffect(() => {
        fetchDocuments();
    }, []);

    const handleUploadFile = async (file) => {
        if (!file) return;
        setIsUploading(true);
        setUploadMessage('');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('http://127.0.0.1:5001/upload-medical-doc', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (res.ok && data.document) {
                setUploadMessage(`Uploaded "${data.document.filename}" successfully.`);
                await fetchDocuments();
            } else {
                setUploadMessage('Failed to upload document.');
            }
        } catch (err) {
            console.error('Error uploading document:', err);
            setUploadMessage('Error connecting to server.');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleUploadFile(e.dataTransfer.files[0]);
        }
    };

    return (
        <div className="reference-documents">
            <header className="dashboard-header">
                <div>
                    <h1>Clinical Reference Documents</h1>
                    <p className="subtitle">Upload clinic-wide medication leaflets, clinical protocols, and reference materials</p>
                </div>
                <div className="header-controls">
                    <button
                        className="btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        {isUploading ? 'Uploading...' : 'Upload Document'}
                    </button>
                </div>
            </header>

            <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => handleUploadFile(e.target.files?.[0])}
                style={{ display: 'none' }}
                accept=".pdf,.txt,.md,.png,.jpg,.jpeg"
            />

            {/* Upload Zone / Loading Wheel State */}
            {isUploading ? (
                <div className="upload-zone" style={{ padding: '2.5rem 1.5rem', marginBottom: '1.5rem', cursor: 'default' }}>
                    <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                    <h3 style={{ fontSize: '0.98rem' }}>Reading &amp; Adding Document...</h3>
                    <p className="upload-hint">Preparing clinical information for patient questions. This will take just a few seconds.</p>
                </div>
            ) : (
                <div
                    className={`upload-zone ${dragActive ? 'active' : ''}`}
                    style={{ padding: '1.75rem 1.5rem', marginBottom: '1.5rem' }}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="upload-icon">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                    </div>
                    <h3>Drop a clinical reference document here or click to browse</h3>
                    <p style={{ marginBottom: '0.25rem' }}>
                        Document will be indexed and accessible across all patient consultations
                    </p>
                    <span className="upload-hint">Supports PDF, TXT, JPG, PNG</span>
                </div>
            )}

            {uploadMessage && (
                <div className="alert-banner success" style={{ marginBottom: '1.25rem' }}>
                    <span>{uploadMessage}</span>
                </div>
            )}

            <div className="panel">
                <div className="panel-section">
                    <div className="section-header-row">
                        <span className="panel-label">Clinic Reference Library</span>
                        <span className="section-hint">{documents.length} document(s)</span>
                    </div>

                    {documents.length === 0 ? (
                        <p className="section-hint" style={{ padding: '1rem 0' }}>
                            No reference documents uploaded yet. Upload a medication leaflet or clinical protocol above.
                        </p>
                    ) : (
                        <div className="rx-list">
                            {documents.map((doc, idx) => (
                                <div
                                    key={doc.document_id || doc.id || idx}
                                    className="rx-row"
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        cursor: 'pointer',
                                        padding: '0.85rem 0.65rem',
                                        borderRadius: 'var(--radius-md)',
                                        transition: 'background-color 0.12s'
                                    }}
                                    onClick={() => setSelectedDoc(doc)}
                                    title="Click to view document"
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center' }}>
                                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                                <polyline points="14 2 14 8 20 8"></polyline>
                                                <line x1="16" y1="13" x2="8" y2="13"></line>
                                                <line x1="16" y1="17" x2="8" y2="17"></line>
                                            </svg>
                                        </div>
                                        <div>
                                            <div className="rx-name" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                                {doc.filename}
                                            </div>
                                            <div className="rx-instructions">
                                                {doc.document_id && (
                                                    <>ID: <span className="mono">{String(doc.document_id).slice(0, 8)}...</span></>
                                                )}
                                                {doc.chunks_indexed && (
                                                    <> · <span className="mono">{doc.chunks_indexed} indexed sections</span></>
                                                )}
                                                <span style={{ color: 'var(--text-muted)' }}> · Click to preview</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                                        <span className="mono" style={{ color: 'var(--text-muted)' }}>
                                            {formatTimestamp(doc.uploaded_at)}
                                        </span>
                                        <span className="status-badge success">Active in Supabase</span>
                                        <button
                                            type="button"
                                            className="btn-icon danger"
                                            onClick={(e) => handleDeleteDoc(e, doc)}
                                            disabled={deletingId === (doc.document_id || doc.id || doc.filename)}
                                            title="Delete document from Supabase"
                                            style={{ padding: '0.35rem 0.5rem', borderRadius: 'var(--radius-sm)' }}
                                        >
                                            {deletingId === (doc.document_id || doc.id || doc.filename) ? (
                                                <span style={{ fontSize: '0.72rem' }}>Deleting...</span>
                                            ) : (
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="3 6 5 6 21 6"></polyline>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                    <line x1="10" y1="11" x2="10" y2="17"></line>
                                                    <line x1="14" y1="11" x2="14" y2="17"></line>
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Document Viewer Modal */}
            {selectedDoc && (
                <div className="modal-overlay" onClick={() => setSelectedDoc(null)}>
                    <div
                        className="modal-container wide"
                        style={{ maxWidth: '960px', width: '95%', height: '88vh' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <header className="modal-header">
                            <div>
                                <h2>{selectedDoc.filename}</h2>
                                <p className="modal-subtitle">
                                    ID: <span className="mono">{selectedDoc.document_id || selectedDoc.id}</span>
                                    {selectedDoc.uploaded_at && (
                                        <> · Uploaded: <span className="mono">{formatTimestamp(selectedDoc.uploaded_at)}</span></>
                                    )}
                                </p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                {selectedDoc.document_url && (
                                    <a
                                        href={selectedDoc.document_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="btn-secondary small"
                                    >
                                        Open in New Tab
                                    </a>
                                )}
                                <button className="close-btn" onClick={() => setSelectedDoc(null)} aria-label="Close">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        </header>
                        <div className="modal-content" style={{ padding: 0, flex: 1, display: 'flex', height: '100%' }}>
                            {selectedDoc.document_url ? (
                                <iframe
                                    src={selectedDoc.document_url}
                                    title={selectedDoc.filename}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                />
                            ) : (
                                <div style={{ padding: '2rem', textAlign: 'center', width: '100%' }}>
                                    <p className="section-hint">Preview URL not available for this document.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
