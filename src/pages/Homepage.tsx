import React from 'react';
import { Link } from 'react-router-dom';

export default function Homepage() {
  return (
    <div className="wumun-hub-container" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ backgroundColor: 'var(--sec-navy)', color: 'var(--text-light)', padding: '2rem', borderRadius: '8px', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Winthrop University Model UN Hub</h1>
        <p>Live Committee Dashboard & Resolution Center</p>
      </header>

      <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        
        {/* Rules & Info Card */}
        <section style={{ backgroundColor: '#fff', borderTop: '4px solid var(--un-yellow)', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: 'var(--sec-navy)' }}>Rules of Procedure</h2>
          <ul style={{ listStyleType: 'none', padding: 0, margin: '1rem 0' }}>
            <li style={{ marginBottom: '0.5rem' }}><strong>Motions:</strong> Standard SRMUN parliamentary procedure applies.</li>
            <li style={{ marginBottom: '0.5rem' }}><strong>Voting:</strong> Simple majority for procedural, 2/3 for substantive.</li>
            <li><strong>Decorum:</strong> Delegates must remain in character.</li>
          </ul>
          <a href="/rules" style={{ color: 'var(--un-blue)', textDecoration: 'none', fontWeight: 'bold' }}>View Full Rules Manual &rarr;</a>
        </section>

        {/* Resolution Tracking Card */}
        <section style={{ backgroundColor: '#fff', borderTop: '4px solid var(--un-blue)', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <h2 style={{ color: 'var(--sec-navy)' }}>Resolution Center</h2>
          <p>Track live working papers, view submitted amendments, and read passed resolutions.</p>
          <Link to="/resolutions" style={{ display: 'inline-block', marginTop: '1rem', padding: '0.75rem 1.5rem', backgroundColor: 'var(--un-blue)', color: 'var(--text-light)', textDecoration: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
            Enter Resolution Center
          </Link>
        </section>

      </div>
    </div>
  );
}
