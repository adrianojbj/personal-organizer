import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import People from './pages/People.jsx';
import Tasks from './pages/Tasks.jsx';
import { api } from './api.js';

export default function App() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);
  return (
    <>
      <nav>
        <span className="brand">📋 Personal Organizer</span>
        <NavLink to="/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>Tasks</NavLink>
        <NavLink to="/my-tasks" className={({ isActive }) => (isActive ? 'active' : '')}>My Tasks</NavLink>
        <NavLink to="/people" className={({ isActive }) => (isActive ? 'active' : '')}>People</NavLink>
        <span className="health">
          {health ? (
            <>API: {health.ok ? '✅' : '❌'} · Slack: {health.slack ? '✅' : '⚠️ off'}</>
          ) : 'connecting...'}
        </span>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/tasks" />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/my-tasks" element={<Tasks mineOnly />} />
          <Route path="/people" element={<People />} />
        </Routes>
      </main>
    </>
  );
}
