import React from 'react';

export function Sidebar({ activeView, onNavigate }) {
    return (
        <aside className="sidebar">
            <div className="brand">
                <div className="logo-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white" />
                        <path d="M2 17L12 22L22 17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2 12L12 17L22 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
                <span className="brand-name">PulseAI</span>
            </div>

            <nav className="nav-menu">
                <a
                    href="#dashboard"
                    className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); onNavigate('dashboard'); }}
                >
                    <span className="icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="7" height="7"></rect>
                            <rect x="14" y="3" width="7" height="7"></rect>
                            <rect x="14" y="14" width="7" height="7"></rect>
                            <rect x="3" y="14" width="7" height="7"></rect>
                        </svg>
                    </span>
                    Staff Dashboard
                </a>
                <a
                    href="#doctor"
                    className={`nav-item ${activeView === 'doctor' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); onNavigate('doctor'); }}
                >
                    <span className="icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                        </svg>
                    </span>
                    Doctor Interface
                </a>
                <a
                    href="#patient"
                    className={`nav-item ${activeView === 'patient' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); onNavigate('patient'); }}
                >
                    <span className="icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                    </span>
                    Patient Interface
                </a>
                <a
                    href="#documents"
                    className={`nav-item ${activeView === 'documents' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); onNavigate('documents'); }}
                >
                    <span className="icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <line x1="9" y1="15" x2="15" y2="15"></line>
                        </svg>
                    </span>
                    Reference Documents
                </a>
                <a
                    href="#analytics"
                    className={`nav-item ${activeView === 'analytics' ? 'active' : ''}`}
                    onClick={(e) => { e.preventDefault(); onNavigate('analytics'); }}
                >
                    <span className="icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                    </span>
                    Chatbot Analytics
                </a>
            </nav>

            <div className="user-profile">
                <div className="avatar">RN</div>
                <div className="user-info">
                    <div className="user-name">Nurse Station 1</div>
                    <div className="user-role">General Ward</div>
                </div>
            </div>
        </aside>
    );
}
