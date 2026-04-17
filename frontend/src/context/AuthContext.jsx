import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me')
        .then(res => {
          setUser(res.data.data);
          setUnreadCount(res.data.data.unreadCount || 0);
        })
        .catch(() => {
          localStorage.removeItem('token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (phone, password) => {
    const res = await api.post('/auth/login', { phone, password });
    const { token, user, unreadCount } = res.data.data;
    localStorage.setItem('token', token);
    setUser(user);
    setUnreadCount(unreadCount || 0);
    return user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setUnreadCount(0);
  };

  const refreshUnread = async () => {
    if (!user) return;
    try {
      const res = await api.get('/auth/me');
      setUnreadCount(res.data.data.unreadCount || 0);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, unreadCount, setUnreadCount, login, logout, refreshUnread }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
