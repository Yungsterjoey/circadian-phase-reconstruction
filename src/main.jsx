import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './liquid-glass.css';
import AppRouter from './router';
import { useAuthStore } from './stores/authStore';

// Hydrate auth session before first render (prevents flash)
useAuthStore.getState().init();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </React.StrictMode>
);
