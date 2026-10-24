import React from 'react';
import { Header, Segment, Grid, Card, Icon, Button } from 'semantic-ui-react';
import { Link } from 'react-router-dom';

export default function Homepage() {
  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Hero Banner */}
      <Segment 
        padded="very" 
        style={{ backgroundColor: 'var(--sec-navy)', border: 'none', borderRadius: '8px' }}
      >
        <Header as="h1" style={{ color: 'var(--text-light)' }}>
          WUMUN Central Hub
          <Header.Subheader style={{ color: 'var(--bg-primary)', marginTop: '0.5rem' }}>
            Live Committee Dashboard & Resolution Center
          </Header.Subheader>
        </Header>
      </Segment>

      {/* Dashboard Grid */}
      <Grid stackable columns={2} style={{ marginTop: '1rem' }}>
        
        {/* Rules & Info Card */}
        <Grid.Column>
          <Card fluid style={{ borderTop: '4px solid var(--un-yellow)', height: '100%' }}>
            <Card.Content>
              <Header as="h2" style={{ color: 'var(--sec-navy)' }}>
                <Icon name="gavel" style={{ color: 'var(--un-yellow)' }} />
                Rules of Procedure
              </Header>
              <Card.Description>
                <p><strong>Motions:</strong> Standard SRMUN parliamentary procedure applies.</p>
                <p><strong>Voting:</strong> Simple majority for procedural, 2/3 for substantive.</p>
                <p><strong>Decorum:</strong> Delegates must remain in character and address the body.</p>
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              <Button basic fluid style={{ color: 'var(--un-blue)', boxShadow: '0 0 0 1px var(--un-blue) inset' }}>
                View Full Rules Manual
              </Button>
            </Card.Content>
          </Card>
        </Grid.Column>

        {/* Resolution Center Gateway */}
        <Grid.Column>
          <Card fluid style={{ borderTop: '4px solid var(--un-blue)', height: '100%' }}>
            <Card.Content>
              <Header as="h2" style={{ color: 'var(--sec-navy)' }}>
                <Icon name="file alternate outline" style={{ color: 'var(--un-blue)' }} />
                Resolution Center
              </Header>
              <Card.Description>
                Track live working papers, view submitted amendments, and read passed resolutions in real-time as they hit the floor.
              </Card.Description>
            </Card.Content>
            <Card.Content extra>
              <Button 
                as={Link} 
                to="/resolutions" 
                fluid 
                style={{ backgroundColor: 'var(--un-blue)', color: 'var(--text-light)' }}
              >
                Enter Resolution Center &rarr;
              </Button>
            </Card.Content>
          </Card>
        </Grid.Column>

      </Grid>
    </div>
  );
}