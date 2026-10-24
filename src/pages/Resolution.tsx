import React, { useState, useEffect } from 'react';
// Import your data fetching hooks here depending on your Firebase setup

export default function Resolution() {
  // Mock data structure - replace with your Firebase data source
  const [resolutions, setResolutions] = useState([
    { id: '1.1', committee: 'GA', sponsors: 'France, UK', status: 'Passed', text: 'The General Assembly...', history: ['Drafted 10:00 AM', 'Amended 11:30 AM', 'Passed 1:00 PM'] },
    { id: '1.2', committee: 'GA', sponsors: 'Brazil, Japan', status: 'Amended', text: 'Recognizing the need...', history: ['Drafted 10:15 AM', 'Amended 12:00 PM'] }
  ]);

  const getStatusBadge = (status: string) => {
    const badgeClass = `status-badge badge-${status.toLowerCase()}`;
    return <span className={badgeClass}>{status}</span>;
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ color: 'var(--sec-navy)' }}>Live Resolutions</h1>
      
      <div className="resolution-list" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {resolutions.map(res => (
          <div key={res.id} style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '8px', borderLeft: `6px solid var(--status-${res.status.toLowerCase()})`, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Resolution {res.id} ({res.committee})</h3>
              {getStatusBadge(res.status)}
            </div>
            <p style={{ margin: '0 0 1rem 0', color: 'var(--sec-brown)' }}><strong>Sponsors:</strong> {res.sponsors}</p>
            
            {/* Document Text */}
            <div style={{ backgroundColor: 'var(--bg-primary)', padding: '1rem', borderRadius: '4px', fontFamily: 'serif', whiteSpace: 'pre-wrap', border: '1px solid #ddd' }}>
              {res.text}
            </div>

            {/* Timeline */}
            <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--sec-teal)' }}>
              <strong>History: </strong> {res.history.join(' → ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
