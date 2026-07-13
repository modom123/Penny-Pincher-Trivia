import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import GamesPage from './pages/GamesPage';
import QuestionsPage from './pages/QuestionsPage';
import FinancialsPage from './pages/FinancialsPage';
import CompliancePage from './pages/CompliancePage';
import SupportPage from './pages/SupportPage';
import AnalyticsPage from './pages/AnalyticsPage';
import LaunchPage from './pages/LaunchPage';

function Gate({ children }: { children: React.ReactNode }) {
  const { session, isStaff, loading } = useAuth();
  if (loading) return null;
  if (!session || !isStaff) return <LoginPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/games" replace />} />
              <Route path="/games" element={<GamesPage />} />
              <Route path="/questions" element={<QuestionsPage />} />
              <Route path="/financials" element={<FinancialsPage />} />
              <Route path="/compliance" element={<CompliancePage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/launch" element={<LaunchPage />} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  );
}
