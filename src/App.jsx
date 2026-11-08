import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { PatientInterface } from './components/PatientInterface';
import { DoctorInterface } from './components/DoctorInterface';
import { ReferenceDocuments } from './components/ReferenceDocuments';
import { ChatbotAnalytics } from './components/ChatbotAnalytics';

function App() {
  const [currentView, setCurrentView] = useState('dashboard');

  return (
    <div className="app-container">
      <Sidebar activeView={currentView} onNavigate={setCurrentView} />
      <main className="main-content">
        {currentView === 'dashboard' ? (
          <Dashboard onNavigate={setCurrentView} />
        ) : currentView === 'patient' ? (
          <PatientInterface />
        ) : currentView === 'doctor' ? (
          <DoctorInterface />
        ) : currentView === 'documents' ? (
          <ReferenceDocuments />
        ) : currentView === 'analytics' ? (
          <ChatbotAnalytics />
        ) : (
          <Dashboard onNavigate={setCurrentView} />
        )}
      </main>
    </div>
  );
}

export default App;
