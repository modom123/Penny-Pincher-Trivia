import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const LINKS = [
  { to: '/games', label: 'Games' },
  { to: '/questions', label: 'Question Bank' },
  { to: '/financials', label: 'Financials' },
  { to: '/compliance', label: 'Compliance' },
  { to: '/support', label: 'Support' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/launch', label: '🚀 Launch' },
];

export default function Layout() {
  const { signOut } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Penny Pincher</h1>
        <nav>
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="signout" onClick={signOut}>
          Sign out
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
