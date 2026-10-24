import * as React from 'react';
import {
  Button,
  Divider,
  Dropdown,
  Flag,
  Form,
  Header,
  Icon,
  Label,
  Message,
  Modal,
  Segment,
} from 'semantic-ui-react';
import { CommitteeData, CommitteeID, recoverFeatureLocks } from '../models/committee';
import { isDaisMember, MemberData, MemberID, nameToFlagCode } from '../modules/member';
import {
  clearDelegateSession,
  DelegateSession,
  setDelegateSession,
} from '../modules/delegate-session';

interface DelegationSelectorModalProps {
  committeeID: CommitteeID;
  committee?: CommitteeData;
  currentSession: DelegateSession | null;
  open: boolean;
  canClose: boolean;
  onClose: () => void;
}

export const DelegationSelectorModal: React.FC<DelegationSelectorModalProps> = ({
  committeeID,
  committee,
  currentSession,
  open,
  canClose,
  onClose,
}) => {
  const [selectedMemberID, setSelectedMemberID] = React.useState<string>(
    currentSession?.memberID || ''
  );
  const [password, setPassword] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (currentSession?.memberID) {
      setSelectedMemberID(currentSession.memberID);
    }
    setPassword('');
    setError(null);
  }, [currentSession, open, committeeID]);

  if (!committee) {
    return null;
  }

  const locks = recoverFeatureLocks(committee);
  const membersMap = committee.members || {};

  const memberEntries: [MemberID, MemberData][] = Object.entries(membersMap)
    .filter(([, m]) => m && !isDaisMember(m))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const dropdownOptions = memberEntries.map(([id, m]) => ({
    key: id,
    value: id,
    flag: nameToFlagCode(m.name),
    text: m.name + (m.present ? ' (Present)' : ''),
  }));

  const selectedMember = selectedMemberID ? membersMap[selectedMemberID] : undefined;
  const requiresPassword = Boolean(selectedMember && selectedMember.password && selectedMember.password.trim() !== '');

  const handleJoinAsDelegate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (!selectedMemberID || !selectedMember) {
      setError('Please select a delegation from the list.');
      return;
    }

    const expectedPassword = (selectedMember.password || '').trim();
    const providedPassword = password.trim();

    if (expectedPassword !== '' && providedPassword !== expectedPassword) {
      setError('Incorrect password for this delegation. Please check with the Dais.');
      return;
    }

    setDelegateSession({
      committeeID,
      role: 'delegate',
      memberID: selectedMemberID,
      memberName: selectedMember.name,
      authenticatedAt: Date.now(),
    });
    onClose();
  };

  const handleJoinAsObserver = () => {
    setError(null);
    setDelegateSession({
      committeeID,
      role: 'observer',
      memberName: 'Observer',
      authenticatedAt: Date.now(),
    });
    onClose();
  };

  const allowObserver = !locks.disableObservers || locks.physicalMode || memberEntries.length === 0;

  return (
    <Modal
      open={open}
      onClose={canClose ? onClose : undefined}
      closeOnDimmerClick={canClose}
      closeOnEscape={canClose}
      size="small"
    >
      <Modal.Header
        style={{
          backgroundColor: 'var(--wumun-navy)',
          color: 'var(--wumun-text-light)',
        }}
      >
        <Icon name="globe" /> Select Your Delegation — {committee.name || 'Committee'}
      </Modal.Header>
      <Modal.Content style={{ backgroundColor: 'var(--wumun-bg)', color: 'var(--wumun-text-dark)' }}>
        <p style={{ marginBottom: '1em' }}>
          Welcome to <strong>{committee.name || 'this committee'}</strong>. Students do not need a
          personal account to participate — select your assigned Member State below to interact as
          that delegation, or join as an Observer.
        </p>

        {locks.physicalMode && (
          <Message info icon>
            <Icon name="hand paper outline" />
            <Message.Content>
              <Message.Header>Physical Committee Mode Active</Message.Header>
              This committee is currently operating in <strong>Physical Mode</strong>. All timers,
              speaking queues, and motions are managed directly by the Dais. Your screen will
              function as a live read-only floor monitor — please pass notes in person to the Dais
              for floor requests.
            </Message.Content>
          </Message>
        )}

        {error && (
          <Message negative onDismiss={() => setError(null)}>
            <Message.Header>Unable to Join Delegation</Message.Header>
            <p>{error}</p>
          </Message>
        )}

        {memberEntries.length > 0 ? (
          <Segment>
            <Form onSubmit={handleJoinAsDelegate}>
              <Form.Field required>
                <label>Member State / Delegation</label>
                <Dropdown
                  placeholder="Search and select your country / delegation..."
                  fluid
                  search
                  selection
                  options={dropdownOptions}
                  value={selectedMemberID}
                  onChange={(_, d) => {
                    setSelectedMemberID((d.value as string) || '');
                    setError(null);
                  }}
                />
              </Form.Field>

              <Form.Field>
                <label>
                  Delegation Password{' '}
                  <span style={{ fontWeight: 400, color: 'var(--wumun-brown)' }}>
                    {requiresPassword
                      ? '(Required for this delegation)'
                      : '(Leave blank — no password set)'}
                  </span>
                </label>
                <Form.Input
                  type="password"
                  icon="lock"
                  iconPosition="left"
                  placeholder={
                    requiresPassword
                      ? 'Enter delegation password...'
                      : 'No password required (leave blank)'
                  }
                  value={password}
                  onChange={e => {
                    setPassword(e.currentTarget.value);
                    setError(null);
                  }}
                />
              </Form.Field>

              <Button
                type="submit"
                fluid
                disabled={!selectedMemberID}
                style={{
                  backgroundColor: 'var(--wumun-blue)',
                  color: 'var(--wumun-text-light)',
                  fontWeight: 700,
                }}
              >
                <Icon name="check" /> Enter as{' '}
                {selectedMember ? selectedMember.name : 'Selected Delegation'}
              </Button>
            </Form>
          </Segment>
        ) : (
          <Message warning>
            <Message.Header>No Delegations Configured Yet</Message.Header>
            <p>
              The Dais has not added member states to this committee yet. You may continue as an
              Observer in the meantime.
            </p>
          </Message>
        )}

        {allowObserver ? (
          <>
            <Divider horizontal>Or</Divider>
            <Button
              type="button"
              fluid
              onClick={handleJoinAsObserver}
              style={{
                backgroundColor: 'var(--wumun-teal)',
                color: 'var(--wumun-text-light)',
              }}
            >
              <Icon name="eye" /> Continue as Observer (Read-Only)
            </Button>
          </>
        ) : (
          <Message size="small" style={{ marginTop: '1em' }}>
            <Icon name="info circle" /> Observer access has been disabled by the Dais for this
            committee. Please select your assigned Member State above.
          </Message>
        )}
      </Modal.Content>
      {canClose && (
        <Modal.Actions style={{ backgroundColor: 'var(--wumun-bg)' }}>
          {currentSession && (
            <Button
              size="small"
              basic
              color="red"
              onClick={() => {
                clearDelegateSession(committeeID);
              }}
            >
              Clear Selection
            </Button>
          )}
          <Button size="small" onClick={onClose}>
            Close
          </Button>
        </Modal.Actions>
      )}
    </Modal>
  );
};

interface DelegationBadgeProps {
  isStaff: boolean;
  session: DelegateSession | null;
  physicalMode?: boolean;
  onClickSwitch: () => void;
}

export const DelegationNavBadge: React.FC<DelegationBadgeProps> = ({
  isStaff,
  session,
  physicalMode,
  onClickSwitch,
}) => {
  if (isStaff) {
    return (
      <Label
        size="medium"
        style={{
          backgroundColor: 'var(--wumun-plum)',
          color: 'var(--wumun-text-light)',
          cursor: 'pointer',
        }}
        onClick={onClickSwitch}
        title="You are logged in as Dais / Staff. Click to preview or set a delegation."
      >
        <Icon name="gavel" /> Dais / Staff
        {session?.role === 'delegate' && session.memberName ? ` (${session.memberName})` : ''}
      </Label>
    );
  }

  if (session?.role === 'delegate' && session.memberName) {
    return (
      <Button
        size="tiny"
        onClick={onClickSwitch}
        style={{
          backgroundColor: 'var(--wumun-navy)',
          color: 'var(--wumun-text-light)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4em',
        }}
        title="Click to switch delegation or observer role"
      >
        <Flag name={nameToFlagCode(session.memberName)} />
        <span>{session.memberName}</span>
        {physicalMode && <Label size="mini" color="yellow">Read-Only</Label>}
        <Icon name="exchange" style={{ marginLeft: '0.3em' }} />
      </Button>
    );
  }

  return (
    <Button
      size="tiny"
      onClick={onClickSwitch}
      style={{
        backgroundColor: 'var(--wumun-teal)',
        color: 'var(--wumun-text-light)',
      }}
      title="Click to select your delegation"
    >
      <Icon name="eye" />
      {session?.role === 'observer' ? 'Observer (Switch)' : 'Select Delegation'}
    </Button>
  );
};
