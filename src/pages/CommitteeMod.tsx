import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import {
  Button,
  Checkbox,
  Container,
  Dropdown,
  Form,
  Grid,
  Header,
  Icon,
  Input,
  Label,
  List,
  Message,
  Segment,
  Table,
} from 'semantic-ui-react';
import { Helmet } from 'react-helmet';
import { URLParameters } from '../types';
import {
  CommitteeData,
  CommitteeFeatureLocks,
  CommitteeModerator,
  DEFAULT_FEATURE_LOCKS,
  pushMember,
  recoverFeatureLocks,
  recoverSettings,
} from '../models/committee';
import { isDaisMember, Rank } from '../modules/member';
import { DEFAULT_TIMER } from '../models/time';
import { DEFAULT_CAUCUS_TIME_SECONDS } from '../models/constants';
import {
  AdminRecord,
  isCommitteeStaff,
  isConferenceAdmin,
  sanitizeEmailKey,
  UserProfile,
} from '../models/conference';
import { Login } from '../components/auth';

interface Props extends RouteComponentProps<URLParameters> {
  committee: CommitteeData;
  fref: firebase.database.Reference;
}

interface State {
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  users: Record<string, UserProfile>;
  newModEmail: string;
  newHeadEmail: string;
  newHeadUid: string;
  statusMessage?: string;
  unsubscribeAuth?: () => void;
}

const FEATURE_LOCK_LABELS: {
  key: keyof CommitteeFeatureLocks;
  label: string;
  description: string;
}[] = [
  {
    key: 'lockMotions',
    label: 'Lock Motions Tab',
    description: 'Hide digital motion proposing/voting for traditional floor motions',
  },
  {
    key: 'lockResolutions',
    label: 'Lock Resolutions & Amendments Tab',
    description: 'Disable built-in resolution & amendment drafting',
  },
  {
    key: 'lockStrawpolls',
    label: 'Lock Strawpolls Tab',
    description: 'Hide digital strawpolling',
  },
  {
    key: 'lockPosts',
    label: 'Lock Posts / File Sharing Tab',
    description: 'Disable file and post uploads in committee',
  },
  {
    key: 'lockNotes',
    label: 'Lock Shared Notes Tab',
    description: 'Disable shared notepad',
  },
  {
    key: 'lockUnmod',
    label: 'Lock Unmod Timer Tab',
    description: 'Hide standalone unmoderated caucus tab',
  },
  {
    key: 'lockCaucuses',
    label: 'Lock Caucuses & Speakers Lists',
    description: 'Hide moderated caucuses and speaker queues',
  },
  {
    key: 'lockStats',
    label: 'Lock Delegate Stats Tab',
    description: 'Hide participation statistics table from delegates',
  },
];

export default class CommitteeMod extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');
  private usersRef = firebase.database().ref('users');

  constructor(props: Props) {
    super(props);
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }
    this.state = {
      user: initialUser,
      admins: {},
      users: {},
      newModEmail: '',
      newHeadEmail: '',
      newHeadUid: '',
    };
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  onUsers = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ users: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    this.adminsRef = firebase.database().ref('conference/admins');
    this.usersRef = firebase.database().ref('users');
    this.adminsRef.on('value', this.onAdmins);
    this.usersRef.on('value', this.onUsers);
    try {
      const unsubscribeAuth = firebase.auth().onAuthStateChanged(
        user => this.setState({ user }),
        () => this.setState({ user: null })
      );
      this.setState({ unsubscribeAuth });
    } catch (e) {
      this.setState({ user: null });
    }
  }

  componentWillUnmount() {
    this.adminsRef.off('value', this.onAdmins);
    this.usersRef.off('value', this.onUsers);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  notify = (statusMessage: string) => {
    this.setState({ statusMessage });
    window.setTimeout(() => {
      if (this.state.statusMessage === statusMessage) {
        this.setState({ statusMessage: undefined });
      }
    }, 3500);
  };

  addModerator = () => {
    const email = this.state.newModEmail.trim().toLowerCase();
    if (!email) return;

    const matchedUser = Object.values(this.state.users).find(
      u => u && u.email && u.email.toLowerCase() === email
    );
    const key = matchedUser ? matchedUser.uid : sanitizeEmailKey(email);
    const modRecord: CommitteeModerator = {
      uid: matchedUser ? matchedUser.uid : undefined,
      email,
      addedAt: Date.now(),
      addedBy: this.state.user?.email || this.state.user?.uid,
    };

    this.props.fref
      .child('moderators')
      .child(key)
      .set(modRecord)
      .then(() => {
        this.setState({ newModEmail: '' });
        this.notify(`Added ${email} as committee moderator.`);
      });
  };

  removeModerator = (modKey: string, email: string) => {
    this.props.fref
      .child('moderators')
      .child(modKey)
      .remove()
      .then(() => {
        this.notify(`Removed ${email} from committee moderators.`);
      });
  };

  transferCommitteeHead = () => {
    const email = this.state.newHeadEmail.trim().toLowerCase();
    if (!email && !this.state.newHeadUid) return;

    const matchedUser = Object.values(this.state.users).find(
      u =>
        (email && u.email && u.email.toLowerCase() === email) ||
        (this.state.newHeadUid && u.uid === this.state.newHeadUid)
    );

    const updates: Partial<CommitteeData> = {};
    if (matchedUser) {
      updates.creatorUid = matchedUser.uid;
      updates.creatorEmail = matchedUser.email;
    } else {
      updates.creatorEmail = email;
      if (this.state.newHeadUid.trim()) {
        updates.creatorUid = this.state.newHeadUid.trim();
      }
    }

    this.props.fref.update(updates).then(() => {
      this.setState({ newHeadEmail: '', newHeadUid: '' });
      this.notify('Updated Committee Head assignment.');
    });
  };

  toggleFeatureLock = (key: keyof CommitteeFeatureLocks, current: boolean) => {
    this.props.fref
      .child('featureLocks')
      .child(key)
      .set(!current);
  };

  applyLowTechPreset = () => {
    const lowTech: CommitteeFeatureLocks = {
      physicalMode: false,
      disableObservers: false,
      lockCaucuses: false,
      lockUnmod: false,
      lockStats: false,
      lockMotions: true,
      lockResolutions: true,
      lockStrawpolls: true,
      lockPosts: true,
      lockNotes: true,
    };
    this.props.fref.child('featureLocks').set(lowTech).then(() => {
      this.notify('Applied Low-Tech Committee preset (Roll Call, Caucuses/Timers & Stats only).');
    });
  };

  applyPhysicalModePreset = () => {
    const physical: CommitteeFeatureLocks = {
      ...DEFAULT_FEATURE_LOCKS,
      physicalMode: true,
    };
    this.props.fref.child('featureLocks').set(physical).then(() => {
      this.notify(
        'Enabled Physical Committee Mode (Read-Only Floor Display for delegates; Dais controls all actions).'
      );
    });
  };

  applyFullDigitalPreset = () => {
    this.props.fref.child('featureLocks').set(DEFAULT_FEATURE_LOCKS).then(() => {
      this.notify('Unlocked all digital committee features.');
    });
  };

  addDaisPostMember = () => {
    const committeeID = this.props.match.params.committeeID;
    const members = this.props.committee.members || {};
    const exists = Object.values(members).some(m => m && isDaisMember(m));
    if (exists) {
      this.notify('A Dais (non-voting) member already exists in this committee.');
      return;
    }
    pushMember(committeeID, {
      name: 'Dais',
      rank: Rank.Dais,
      present: false,
      voting: false,
      password: '',
    });
    this.notify('Added "Dais" as a non-voting member for posts and notifications.');
  };

  setAllMembersField = (field: 'present' | 'voting', value: boolean) => {
    const members = this.props.committee.members || {};
    const updates: Record<string, boolean> = {};
    Object.keys(members).forEach(id => {
      if (isDaisMember(members[id])) return;
      updates[`${id}/${field}`] = value;
    });
    this.props.fref
      .child('members')
      .update(updates)
      .then(() => {
        this.notify(`Updated all delegates: ${field} = ${value ? 'Yes' : 'No'}.`);
      });
  };

  setAllCaucusesPublicQueue = (isPublic: boolean) => {
    const caucuses = this.props.committee.caucuses || {};
    const updates: Record<string, boolean> = {};
    Object.keys(caucuses).forEach(cid => {
      updates[`${cid}/queueIsPublic`] = isPublic;
    });
    this.props.fref.child('caucuses').update(updates).then(() => {
      this.notify(
        isPublic
          ? 'Unlocked speaking queues across all caucuses.'
          : 'Locked speaking queues across all caucuses.'
      );
    });
  };

  setAllResolutionsPublicAmendments = (isPublic: boolean) => {
    const resolutions = this.props.committee.resolutions || {};
    const updates: Record<string, boolean> = {};
    Object.keys(resolutions).forEach(rid => {
      updates[`${rid}/amendmentsArePublic`] = isPublic;
    });
    this.props.fref.child('resolutions').update(updates).then(() => {
      this.notify(
        isPublic
          ? 'Enabled public delegate amendments on all resolutions.'
          : 'Locked public delegate amendments on all resolutions.'
      );
    });
  };

  clearAllSpeakingQueues = () => {
    const caucuses = this.props.committee.caucuses || {};
    const updates: Record<string, null> = {};
    Object.keys(caucuses).forEach(cid => {
      updates[`${cid}/queue`] = null;
      updates[`${cid}/speaking`] = null;
    });
    this.props.fref.child('caucuses').update(updates).then(() => {
      this.notify('Cleared all speaking queues and active speakers.');
    });
  };

  resetUnmodTimer = () => {
    this.props.fref
      .child('timer')
      .set({ ...DEFAULT_TIMER, remaining: DEFAULT_CAUCUS_TIME_SECONDS })
      .then(() => {
        this.notify('Reset unmoderated caucus timer.');
      });
  };

  render() {
    const { committee, fref } = this.props;
    const { user, admins, users, newModEmail, newHeadEmail, statusMessage } = this.state;

    const isStaff = isCommitteeStaff(user, committee, admins);
    const isAdmin = isConferenceAdmin(user, admins);
    const locks = recoverFeatureLocks(committee);
    const settings = recoverSettings(committee);
    const moderators = committee.moderators || {};
    const motions = committee.motions || {};
    const resolutions = committee.resolutions || {};
    const strawpolls = committee.strawpolls || {};
    const files = committee.files || {};

    const userDropdownOptions = Object.values(users)
      .filter(u => u && u.email)
      .map(u => ({
        key: u.uid,
        text: `${u.email}`,
        value: u.email,
      }));

    if (!user) {
      return (
        <Container text style={{ padding: '2em 0em' }}>
          <Message warning>
            <Message.Header>Staff Authentication Required</Message.Header>
            <p>Please log in with a Committee Head, Moderator, or Conference Admin account.</p>
          </Message>
          <Login allowNewCommittee={false} />
        </Container>
      );
    }

    if (!isStaff) {
      return (
        <Container text style={{ padding: '2em 0em' }}>
          <Message negative icon>
            <Icon name="lock" />
            <Message.Content>
              <Message.Header>Committee Moderation Access Restricted</Message.Header>
              <p>
                Signed in as <strong>{user.email}</strong>. Only the Committee Head, assigned
                Committee Moderators, or Conference Admins can access this panel.
              </p>
              <Button
                as="a"
                href="/admin"
                style={{
                  backgroundColor: 'var(--wumun-navy)',
                  color: 'var(--wumun-text-light)',
                  marginTop: '0.5em',
                }}
              >
                <Icon name="shield alternate" /> Go to Conference Admin Panel
              </Button>
            </Message.Content>
          </Message>
        </Container>
      );
    }

    return (
      <Container style={{ padding: '1.5em 0em 3em' }}>
        <Helmet>
          <title>{`Mod Panel - ${committee.name || 'Committee'} - WUMUN`}</title>
        </Helmet>

        <Segment>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5em',
            }}
          >
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="sliders horizontal" />
              <Header.Content>
                Committee Moderation Panel — {committee.name || 'Untitled Committee'}
                <Header.Subheader>
                  Committee Head: {committee.creatorEmail || committee.chair || committee.creatorUid || 'Unassigned'}
                  {isAdmin ? ' • Viewing with Conference Admin Privileges' : ''}
                </Header.Subheader>
              </Header.Content>
            </Header>
            <div>
              {isAdmin && (
                <Button
                  as="a"
                  href="/admin"
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-navy)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="shield alternate" /> Overall Conference Admin
                </Button>
              )}
            </div>
          </div>
        </Segment>

        {statusMessage && (
          <Message
            positive
            onDismiss={() => this.setState({ statusMessage: undefined })}
          >
            <Icon name="check circle" /> {statusMessage}
          </Message>
        )}

        <Grid stackable columns={2}>
          <Grid.Row>
            {/* A) Moderators & Staff Management */}
            <Grid.Column width={8}>
              <Header as="h3" attached="top">
                <Icon name="shield" /> Committee Moderators &amp; Head
              </Header>
              <Segment attached="bottom">
                <Form onSubmit={this.addModerator}>
                  <Form.Field>
                    <label>Add Moderator by Email or Registered User</label>
                    {userDropdownOptions.length > 0 && (
                      <Dropdown
                        placeholder="Quick-select registered user..."
                        fluid
                        search
                        selection
                        clearable
                        options={userDropdownOptions}
                        value={newModEmail}
                        onChange={(_, data) =>
                          this.setState({ newModEmail: (data.value as string) || '' })
                        }
                        style={{ marginBottom: '0.5em' }}
                      />
                    )}
                    <Input
                      fluid
                      placeholder="moderator@winthrop.edu"
                      value={newModEmail}
                      onChange={e => this.setState({ newModEmail: e.currentTarget.value })}
                      action={{
                        content: 'Add Mod',
                        icon: 'plus',
                        onClick: this.addModerator,
                        style: {
                          backgroundColor: 'var(--wumun-green)',
                          color: 'var(--wumun-text-light)',
                          fontWeight: 700,
                        },
                      }}
                    />
                  </Form.Field>
                </Form>

                <Header as="h4" style={{ marginTop: '1em' }}>
                  Assigned Committee Moderators ({Object.keys(moderators).length})
                </Header>
                {Object.keys(moderators).length === 0 ? (
                  <p style={{ color: 'var(--wumun-brown)' }}>
                    No additional moderators assigned yet.
                  </p>
                ) : (
                  <List divided relaxed>
                    {Object.entries(moderators).map(([key, mod]) => (
                      <List.Item key={key}>
                        <List.Content floated="right">
                          <Button
                            size="mini"
                            negative
                            icon="trash"
                            content="Remove"
                            onClick={() => this.removeModerator(key, mod.email)}
                          />
                        </List.Content>
                        <Icon name="user" />
                        <List.Content>
                          <List.Header>{mod.email}</List.Header>
                          <List.Description>
                            Added {new Date(mod.addedAt).toLocaleDateString()}
                          </List.Description>
                        </List.Content>
                      </List.Item>
                    ))}
                  </List>
                )}

                <Header as="h4" dividing style={{ marginTop: '1.2em' }}>
                  Transfer Committee Head
                </Header>
                <Form onSubmit={this.transferCommitteeHead}>
                  <Form.Group widths="equal">
                    <Form.Input
                      placeholder="New Head Email (e.g. chair@winthrop.edu)"
                      value={newHeadEmail}
                      onChange={e => this.setState({ newHeadEmail: e.currentTarget.value })}
                    />
                    <Form.Button
                      primary
                      fluid
                      disabled={!newHeadEmail.trim()}
                      style={{
                        backgroundColor: 'var(--wumun-blue)',
                        color: 'var(--wumun-text-light)',
                        fontWeight: 700,
                      }}
                    >
                      Reassign Head
                    </Form.Button>
                  </Form.Group>
                </Form>
              </Segment>
            </Grid.Column>

            {/* B) Feature Locks for Low-Tech / Traditional Committees */}
            <Grid.Column width={8}>
              <Header as="h3" attached="top">
                <Icon name="lock" /> Feature Locks (Low-Tech / Hybrid Committee Mode)
              </Header>
              <Segment attached="bottom">
                <p style={{ marginBottom: '0.8em' }}>
                  Lock specific digital features for committees that aren't fully technology-based
                  while keeping essential chairing utilities active. Locked tabs are hidden from
                  delegates.
                </p>
                <div style={{ display: 'flex', gap: '0.5em', marginBottom: '1em', flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    onClick={this.applyPhysicalModePreset}
                    style={{
                      backgroundColor: 'var(--wumun-navy)',
                      color: 'var(--wumun-text-light)',
                    }}
                  >
                    <Icon name="hand paper outline" /> Enable Physical Mode (Read-Only Floor)
                  </Button>
                  <Button
                    size="small"
                    onClick={this.applyLowTechPreset}
                    style={{
                      backgroundColor: 'var(--wumun-yellow)',
                      color: 'var(--wumun-text-dark)',
                      fontWeight: 700,
                    }}
                  >
                    <Icon name="compress" /> Apply Low-Tech Preset
                  </Button>
                  <Button
                    size="small"
                    onClick={this.applyFullDigitalPreset}
                    style={{
                      backgroundColor: 'var(--wumun-green)',
                      color: 'var(--wumun-text-light)',
                      fontWeight: 700,
                    }}
                  >
                    <Icon name="expand" /> Unlock All Features
                  </Button>
                </div>

                <List divided relaxed>
                  {FEATURE_LOCK_LABELS.map(item => {
                    const isLocked = Boolean(locks[item.key]);
                    return (
                      <List.Item key={item.key}>
                        <List.Content floated="right">
                          <Checkbox
                            toggle
                            checked={isLocked}
                            onChange={() => this.toggleFeatureLock(item.key, isLocked)}
                          />
                        </List.Content>
                        <List.Content>
                          <List.Header>
                            {isLocked ? <Icon name="lock" color="red" /> : <Icon name="unlock" />}
                            {item.label}
                          </List.Header>
                          <List.Description>{item.description}</List.Description>
                        </List.Content>
                      </List.Item>
                    );
                  })}
                </List>
              </Segment>
            </Grid.Column>
          </Grid.Row>

          <Grid.Row>
            {/* C) Delegate Permissions & Committee Status */}
            <Grid.Column width={8}>
              <Header as="h3" attached="top">
                <Icon name="shield" /> Delegate Permissions &amp; Committee Status
              </Header>
              <Segment attached="bottom">
                <List divided relaxed>
                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(locks.physicalMode)}
                        onChange={(_, d) =>
                          fref.child('featureLocks/physicalMode').set(Boolean(d.checked))
                        }
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>
                        <Icon name="hand paper outline" /> Physical Committee Mode (Read-Only Floor Display)
                      </List.Header>
                      <List.Description>
                        Delegates can view timers, active motions, speaking lists, and documents,
                        but must pass physical notes to the Dais to make any changes
                      </List.Description>
                    </List.Content>
                  </List.Item>

                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(locks.disableObservers)}
                        onChange={(_, d) =>
                          fref.child('featureLocks/disableObservers').set(Boolean(d.checked))
                        }
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>
                        <Icon name="user secret" /> Disable Observer Role (Require Delegation Selection)
                      </List.Header>
                      <List.Description>
                        Require unauthenticated visitors to select a Member State rather than
                        joining as an unattached Observer
                      </List.Description>
                    </List.Content>
                  </List.Item>

                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(committee.locked)}
                        onChange={(_, d) => fref.child('locked').set(Boolean(d.checked))}
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>Lock Entire Committee (Read-Only for Delegates)</List.Header>
                      <List.Description>
                        Freeze all delegate submissions in this committee
                      </List.Description>
                    </List.Content>
                  </List.Item>

                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(committee.archived)}
                        onChange={(_, d) => fref.child('archived').set(Boolean(d.checked))}
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>Archive Committee</List.Header>
                      <List.Description>
                        Hide from main Active Committees directory unless "Show archived" is checked
                      </List.Description>
                    </List.Content>
                  </List.Item>

                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(settings.motionsArePublic)}
                        onChange={(_, d) =>
                          fref.child('settings/motionsArePublic').set(Boolean(d.checked))
                        }
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>Allow Delegates to Propose Motions Publicly</List.Header>
                    </List.Content>
                  </List.Item>

                  <List.Item>
                    <List.Content floated="right">
                      <Checkbox
                        toggle
                        checked={Boolean(settings.motionVotes)}
                        onChange={(_, d) =>
                          fref.child('settings/motionVotes').set(Boolean(d.checked))
                        }
                      />
                    </List.Content>
                    <List.Content>
                      <List.Header>Allow Delegates to Vote on Motions</List.Header>
                    </List.Content>
                  </List.Item>
                </List>

                <div style={{ marginTop: '1em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                  <Button size="tiny" onClick={() => this.setAllCaucusesPublicQueue(true)}>
                    Open All Speaking Queues
                  </Button>
                  <Button size="tiny" onClick={() => this.setAllCaucusesPublicQueue(false)}>
                    Lock All Speaking Queues
                  </Button>
                  <Button size="tiny" onClick={() => this.setAllResolutionsPublicAmendments(true)}>
                    Open All Amendments
                  </Button>
                  <Button size="tiny" onClick={() => this.setAllResolutionsPublicAmendments(false)}>
                    Lock All Amendments
                  </Button>
                </div>
              </Segment>
            </Grid.Column>

            {/* D) Bulk Attendance & Floor Actions */}
            <Grid.Column width={8}>
              <Header as="h3" attached="top">
                <Icon name="bolt" /> Quick Floor &amp; Attendance Actions
              </Header>
              <Segment attached="bottom">
                <Header as="h4">Bulk Roll Call Actions</Header>
                <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginBottom: '1em' }}>
                  <Button
                    size="small"
                    positive
                    onClick={() => this.setAllMembersField('present', true)}
                  >
                    <Icon name="check" /> Mark All Present
                  </Button>
                  <Button
                    size="small"
                    onClick={() => this.setAllMembersField('present', false)}
                  >
                    <Icon name="times" /> Mark All Absent
                  </Button>
                  <Button
                    size="small"
                    primary
                    onClick={() => this.setAllMembersField('voting', true)}
                  >
                    <Icon name="hand paper" /> Set All Voting
                  </Button>
                  <Button
                    size="small"
                    onClick={() => this.setAllMembersField('voting', false)}
                  >
                    Set All Non-Voting
                  </Button>
                  <Button size="small" onClick={this.addDaisPostMember} style={{ backgroundColor: 'var(--wumun-plum)', color: 'var(--wumun-text-light)' }}>
                    <Icon name="gavel" /> Add Dais Member (Non-Voting)
                  </Button>
                </div>

                <Header as="h4">Timers &amp; Queues</Header>
                <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    negative
                    onClick={this.clearAllSpeakingQueues}
                  >
                    <Icon name="eraser" /> Clear All Speaking Queues
                  </Button>
                  <Button size="small" onClick={this.resetUnmodTimer}>
                    <Icon name="clock outline" /> Reset Unmod Timer
                  </Button>
                  <Button
                    size="small"
                    negative
                    onClick={() =>
                      fref.child('motions').remove().then(() => this.notify('Cleared all motions.'))
                    }
                  >
                    <Icon name="trash" /> Clear All Motions ({Object.keys(motions).length})
                  </Button>
                </div>
              </Segment>
            </Grid.Column>
          </Grid.Row>

          {/* E) Content Moderation Table */}
          <Grid.Row>
            <Grid.Column width={16}>
              <Header as="h3" attached="top">
                <Icon name="gavel" /> Committee Content Moderation (Motions, Resolutions, Strawpolls, Posts)
              </Header>
              <Segment attached="bottom">
                <Grid stackable columns={2}>
                  <Grid.Column>
                    <Header as="h4">
                      Active Motions ({Object.keys(motions).length})
                    </Header>
                    {Object.keys(motions).length === 0 ? (
                      <p>No motions on the floor.</p>
                    ) : (
                      <Table compact celled>
                        <Table.Header>
                          <Table.Row>
                            <Table.HeaderCell>Proposer</Table.HeaderCell>
                            <Table.HeaderCell>Type / Topic</Table.HeaderCell>
                            <Table.HeaderCell collapsing>Action</Table.HeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {Object.entries(motions).map(([mid, m]) => (
                            <Table.Row key={mid}>
                              <Table.Cell>{m.proposer || 'Unknown'}</Table.Cell>
                              <Table.Cell>
                                <strong>{m.type}</strong>
                                {m.proposal ? ` — ${m.proposal}` : ''}
                              </Table.Cell>
                              <Table.Cell collapsing>
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => fref.child('motions').child(mid).remove()}
                                />
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    )}

                    <Header as="h4" style={{ marginTop: '1em' }}>
                      Strawpolls ({Object.keys(strawpolls).length})
                    </Header>
                    {Object.keys(strawpolls).length === 0 ? (
                      <p>No strawpolls created.</p>
                    ) : (
                      <Table compact celled>
                        <Table.Header>
                          <Table.Row>
                            <Table.HeaderCell>Question</Table.HeaderCell>
                            <Table.HeaderCell collapsing>Action</Table.HeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {Object.entries(strawpolls).map(([sid, s]) => (
                            <Table.Row key={sid}>
                              <Table.Cell>{s.question || 'Untitled Strawpoll'}</Table.Cell>
                              <Table.Cell collapsing>
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => fref.child('strawpolls').child(sid).remove()}
                                />
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    )}
                  </Grid.Column>

                  <Grid.Column>
                    <Header as="h4">
                      Resolutions ({Object.keys(resolutions).length})
                    </Header>
                    {Object.keys(resolutions).length === 0 ? (
                      <p>No resolutions created.</p>
                    ) : (
                      <Table compact celled>
                        <Table.Header>
                          <Table.Row>
                            <Table.HeaderCell>Resolution</Table.HeaderCell>
                            <Table.HeaderCell>Amendments</Table.HeaderCell>
                            <Table.HeaderCell collapsing>Action</Table.HeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {Object.entries(resolutions).map(([rid, r]) => (
                            <Table.Row key={rid}>
                              <Table.Cell>{r.name || 'Untitled'}</Table.Cell>
                              <Table.Cell>
                                <Label size="small">
                                  {Object.keys(r.amendments || {}).length}
                                </Label>
                              </Table.Cell>
                              <Table.Cell collapsing>
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => fref.child('resolutions').child(rid).remove()}
                                />
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    )}

                    <Header as="h4" style={{ marginTop: '1em' }}>
                      Posts &amp; Files ({Object.keys(files).length})
                    </Header>
                    {Object.keys(files).length === 0 ? (
                      <p>No posts or files uploaded.</p>
                    ) : (
                      <Table compact celled>
                        <Table.Header>
                          <Table.Row>
                            <Table.HeaderCell>Sender / Title</Table.HeaderCell>
                            <Table.HeaderCell collapsing>Action</Table.HeaderCell>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {Object.entries(files).map(([fid, f]) => (
                            <Table.Row key={fid}>
                              <Table.Cell>
                                <strong>{f.uploader || 'Delegate'}</strong>:{' '}
                                {f.type === 'file'
                                  ? f.filename
                                  : f.type === 'link'
                                  ? f.name
                                  : f.body?.slice(0, 60)}
                              </Table.Cell>
                              <Table.Cell collapsing>
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => fref.child('files').child(fid).remove()}
                                />
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table>
                    )}
                  </Grid.Column>
                </Grid>
              </Segment>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </Container>
    );
  }
}
