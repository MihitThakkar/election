import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// Inject JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-redirect on token expiry.
// Skip redirect for the login endpoint itself — a 401 there is just wrong credentials,
// not an expired session, so the login page handles it inline.
api.interceptors.response.use(
  res => res,
  err => {
    const isLoginRequest = err.config?.url?.includes('/auth/login');
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
