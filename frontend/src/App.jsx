import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ManageTeam from './pages/ManageTeam';
import ManageAreas from './pages/ManageAreas';
import UploadVoters from './pages/UploadVoters';
import VoterList from './pages/VoterList';
import MyList from './pages/MyList';
import GlobalSearch from './pages/GlobalSearch';
import Notifications from './pages/Notifications';
import VideoGuide from './pages/VideoGuide';

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={['super_admin', 'team_lead'].includes(user.role) ? '/' : '/my-list'} replace />;
}

function HomePage() {
  const { user } = useAuth();
  if (['field_worker'].includes(user?.role)) {
    return <MyList />;
  }
  return <Dashboard />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route path="/" element={
            <ProtectedRoute>
              <Layout><HomePage /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/team" element={
            <ProtectedRoute roles={['super_admin', 'team_lead']}>
              <Layout><ManageTeam /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/areas" element={
            <ProtectedRoute roles={['super_admin']}>
              <Layout><ManageAreas /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/upload" element={
            <ProtectedRoute roles={['super_admin']}>
              <Layout><UploadVoters /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/voters" element={
            <ProtectedRoute roles={['super_admin', 'team_lead']}>
              <Layout><VoterList /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/my-list" element={
            <ProtectedRoute>
              <Layout><MyList /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/search" element={
            <ProtectedRoute>
              <Layout><GlobalSearch /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/notifications" element={
            <ProtectedRoute>
              <Layout><Notifications /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/video-guide" element={
            <ProtectedRoute>
              <Layout><VideoGuide /></Layout>
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
