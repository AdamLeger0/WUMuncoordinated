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
  Statistic,
  Table,
} from 'semantic-ui-react';
import { Helmet } from 'react-helmet';
import TopNav from '../components/TopNav';
import ConnectionStatus from '../components/ConnectionStatus';
import { Login } from '../components/auth';
import {
  CommitteeData,
  CommitteeID,
  CommitteeModerator,
  DEFAULT_COMMITTEE,
  pushTemplateMembers,
  putCommittee,
  recoverFeatureLocks,
  Template,
} from '../models/committee';
import {
  AdminRecord,
  ApprovedUserRecord,
  ConferenceSettings,
  DEFAULT_ADMIN_EMAILS,
  DEFAULT_CONFERENCE_SETTINGS,
  getNotificationPalette,
  GlobalNotification,
  isConferenceAdmin,
  NOTIFICATION_PALETTES,
  NotificationSeverity,
  sanitizeEmailKey,
  UserProfile,
} from '../models/conference';
import { isDaisMember } from '../modules/member';
import { makeDropdownOption, meetId } from '../utils';
import { CaucusStatus } from '../models/caucus';

interface Props extends RouteComponentProps {}

interface State {
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
  users: Record<string, UserProfile>;
  settings: ConferenceSettings;
  notifications: Record<string, GlobalNotification>;
  committees: Record<CommitteeID, CommitteeData>;
  // Notification form
  notifTitle: string;
  notifMessage: string;
  notifSeverity: NotificationSeverity;
  notifTarget: string;
  // New committee quick-create
  newCommName: string;
  newCommTopic: string;
  newCommChair: string;
  newCommTemplate?: Template;
  // Moderator management in overall admin panel
  selectedCommitteeForMod: string;
  modEmailInput: string;
  // Admin & Approved User management
  newAdminEmail: string;
  newApprovedEmail: string;
  statusMessage?: string;
  unsubscribeAuth?: () => void;
}

const SEVERITY_OPTIONS: { key: string; text: string; value: NotificationSeverity }[] =
  Object.values(NOTIFICATION_PALETTES).map(p => ({
    key: p.severity,
    text: p.label,
    value: p.severity,
  }));

export default class ConferenceAdmin extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');
  private approvedRef = firebase.database().ref('conference/approvedUsers');
  private settingsRef = firebase.database().ref('conference/settings');
  private notifsRef = firebase.database().ref('conference/notifications');
  private committeesRef = firebase.database().ref('committees');
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
      approvedUsers: {},
      users: {},
      settings: DEFAULT_CONFERENCE_SETTINGS,
      notifications: {},
      committees: {},
      notifTitle: '',
      notifMessage: '',
      notifSeverity: 'info',
      notifTarget: 'all',
      newCommName: '',
      newCommTopic: '',
      newCommChair: '',
      newCommTemplate: undefined,
      selectedCommitteeForMod: '',
      modEmailInput: '',
      newAdminEmail: '',
      newApprovedEmail: '',
    };
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  onApproved = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ approvedUsers: (snap && snap.val()) || {} });
  };

  onSettings = (snap: firebase.database.DataSnapshot | null) => {
    const val = snap && snap.val();
    this.setState({
      settings: {
        ...DEFAULT_CONFERENCE_SETTINGS,
        ...(val || {}),
      },
    });
  };

  onNotifs = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ notifications: (snap && snap.val()) || {} });
  };

  onCommittees = (snap: firebase.database.DataSnapshot | null) => {
    const raw = (snap && snap.val()) || {};
    const committees: Record<CommitteeID, CommitteeData> = {};
    Object.entries(raw).forEach(([k, v]) => {
      if (k !== '__wumun_hub__' && v && typeof v === 'object') {
        committees[k] = v as CommitteeData;
      }
    });
    this.setState(prev => ({
      committees,
      selectedCommitteeForMod:
        prev.selectedCommitteeForMod && committees[prev.selectedCommitteeForMod]
          ? prev.selectedCommitteeForMod
          : Object.keys(committees)[0] || '',
    }));
  };

  onUsers = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ users: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    this.adminsRef = firebase.database().ref('conference/admins');
    this.approvedRef = firebase.database().ref('conference/approvedUsers');
    this.settingsRef = firebase.database().ref('conference/settings');
    this.notifsRef = firebase.database().ref('conference/notifications');
    this.committeesRef = firebase.database().ref('committees');
    this.usersRef = firebase.database().ref('users');

    this.adminsRef.on('value', this.onAdmins);
    this.approvedRef.on('value', this.onApproved);
    this.settingsRef.on('value', this.onSettings);
    this.notifsRef.on('value', this.onNotifs);
    this.committeesRef.on('value', this.onCommittees);
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
    this.approvedRef.off('value', this.onApproved);
    this.settingsRef.off('value', this.onSettings);
    this.notifsRef.off('value', this.onNotifs);
    this.committeesRef.off('value', this.onCommittees);
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

  addAdminByEmail = () => {
    const email = this.state.newAdminEmail.trim().toLowerCase();
    if (!email) return;

    const matchedUser = Object.values(this.state.users).find(
      u => u && u.email && u.email.toLowerCase() === email
    );
    const key = matchedUser ? matchedUser.uid : sanitizeEmailKey(email);
    const record: AdminRecord = {
      uid: matchedUser ? matchedUser.uid : key,
      email,
      addedAt: Date.now(),
    };
    this.adminsRef
      .child(key)
      .set(record)
      .then(() => {
        this.setState({ newAdminEmail: '' });
        this.notify(`Promoted ${email} to Conference Admin.`);
      });
  };

  removeAdmin = (key: string, label: string) => {
    this.adminsRef
      .child(key)
      .remove()
      .then(() => {
        this.notify(`Removed ${label} from Conference Admins.`);
      });
  };

  addApprovedUserByEmail = () => {
    const email = this.state.newApprovedEmail.trim().toLowerCase();
    if (!email) return;

    const matchedUser = Object.values(this.state.users).find(
      u => u && u.email && u.email.toLowerCase() === email
    );
    const key = matchedUser ? matchedUser.uid : sanitizeEmailKey(email);
    const record: ApprovedUserRecord = {
      uid: matchedUser ? matchedUser.uid : undefined,
      email,
      addedAt: Date.now(),
      addedBy: this.state.user?.email || 'Admin',
    };
    this.approvedRef
      .child(key)
      .set(record)
      .then(() => {
        this.setState({ newApprovedEmail: '' });
        this.notify(`Approved ${email} to create and manage committees.`);
      });
  };

  removeApprovedUser = (key: string, email: string) => {
    this.approvedRef
      .child(key)
      .remove()
      .then(() => {
        this.notify(`Revoked committee creation approval for ${email}.`);
      });
  };

  saveConferenceSettings = () => {
    this.settingsRef.set(this.state.settings).then(() => {
      this.notify('Saved conference settings.');
    });
  };

  broadcastNotification = () => {
    const { notifTitle, notifMessage, notifSeverity, notifTarget, user } = this.state;
    if (!notifMessage.trim()) return;

    const payload: GlobalNotification = {
      title: notifTitle.trim() || 'WUMUN Conference Announcement',
      message: notifMessage.trim(),
      severity: notifSeverity,
      targetCommitteeID: notifTarget || 'all',
      active: true,
      createdAt: Date.now(),
      authorEmail: user?.email || 'Conference Admin',
    };

    this.notifsRef
      .push(payload)
      .then(() => {
        this.setState({ notifTitle: '', notifMessage: '' });
        this.notify('Broadcasted global conference notification.');
      });
  };

  createCommitteeFromAdmin = () => {
    const {
      newCommName,
      newCommTopic,
      newCommChair,
      newCommTemplate,
      settings,
      user,
    } = this.state;
    if (!user || !newCommName.trim()) return;

    const newCommittee: CommitteeData = {
      ...DEFAULT_COMMITTEE,
      name: newCommName.trim(),
      topic: newCommTopic.trim(),
      chair: newCommChair.trim(),
      conference: settings.conferenceName,
      creatorUid: user.uid,
      creatorEmail: user.email || undefined,
    };
    if (newCommTemplate) {
      newCommittee.template = newCommTemplate;
    }

    const id = meetId();
    const ref = putCommittee(id, newCommittee);
    if (newCommTemplate && ref.key) {
      pushTemplateMembers(ref.key, newCommTemplate);
    }
    this.setState({
      newCommName: '',
      newCommTopic: '',
      newCommChair: '',
      newCommTemplate: undefined,
      selectedCommitteeForMod: id,
    });
    this.notify(`Created committee "${newCommittee.name}".`);
  };

  addModeratorToSelectedCommittee = () => {
    const { selectedCommitteeForMod, modEmailInput, users, user } = this.state;
    const email = modEmailInput.trim().toLowerCase();
    if (!selectedCommitteeForMod || !email) return;

    const matchedUser = Object.values(users).find(
      u => u && u.email && u.email.toLowerCase() === email
    );
    const key = matchedUser ? matchedUser.uid : sanitizeEmailKey(email);
    const modRecord: CommitteeModerator = {
      uid: matchedUser ? matchedUser.uid : undefined,
      email,
      addedAt: Date.now(),
      addedBy: user?.email || user?.uid,
    };

    this.committeesRef
      .child(selectedCommitteeForMod)
      .child('moderators')
      .child(key)
      .set(modRecord)
      .then(() => {
        this.setState({ modEmailInput: '' });
        this.notify(`Added ${email} as moderator.`);
      });
  };

  removeModeratorFromCommittee = (committeeID: string, modKey: string, email: string) => {
    this.committeesRef
      .child(committeeID)
      .child('moderators')
      .child(modKey)
      .remove()
      .then(() => {
        this.notify(`Removed ${email} from committee moderators.`);
      });
  };

  exportConferenceData = () => {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      settings: this.state.settings,
      admins: this.state.admins,
      approvedUsers: this.state.approvedUsers,
      notifications: this.state.notifications,
      committees: this.state.committees,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wumun-conference-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  render() {
    const {
      user,
      admins,
      approvedUsers,
      settings,
      notifications,
      committees,
      notifTitle,
      notifMessage,
      notifSeverity,
      notifTarget,
      newCommName,
      newCommTopic,
      newCommChair,
      newCommTemplate,
      selectedCommitteeForMod,
      modEmailInput,
      newAdminEmail,
      newApprovedEmail,
      statusMessage,
    } = this.state;

    const userIsAdmin = isConferenceAdmin(user, admins);
    const committeeEntries = Object.entries(committees || {});

    // Cross-committee stats (excluding non-voting Dais members)
    const totalCommittees = committeeEntries.length;
    const totalDelegates = committeeEntries.reduce(
      (sum, [, c]) =>
        sum +
        Object.values((c && c.members) || {}).filter(m => m && !isDaisMember(m)).length,
      0
    );
    const totalPresent = committeeEntries.reduce(
      (sum, [, c]) =>
        sum +
        Object.values((c && c.members) || {}).filter(
          m => m && m.present && !isDaisMember(m)
        ).length,
      0
    );
    const totalOpenCaucuses = committeeEntries.reduce(
      (sum, [, c]) =>
        sum +
        Object.values((c && c.caucuses) || {}).filter(
          ca => ca && ca.status !== CaucusStatus.Closed
        ).length,
      0
    );
    const totalResolutions = committeeEntries.reduce(
      (sum, [, c]) => sum + Object.keys((c && c.resolutions) || {}).length,
      0
    );

    const committeeOptions = [
      { key: 'all', text: 'All Committees (Conference-Wide)', value: 'all' },
      ...committeeEntries.map(([id, c]) => ({
        key: id,
        text: c.name || id,
        value: id,
      })),
    ];

    const selectedCommData = selectedCommitteeForMod
      ? committees[selectedCommitteeForMod]
      : undefined;
    const previewPalette = getNotificationPalette(notifSeverity);

    return (
      <>
        <TopNav activeTab="admin" />
        <Container style={{ padding: '1.5em 0em 3em' }}>
          <Helmet>
            <title>{`Conference Admin - ${settings.conferenceName}`}</title>
          </Helmet>
          <ConnectionStatus />

          {!user ? (
            <Grid stackable centered>
              <Grid.Column width={10}>
                <Message warning>
                  <Message.Header>Conference Administration Login Required</Message.Header>
                  <p>Please sign in with an authorized Conference Admin account.</p>
                </Message>
                <Login allowNewCommittee={false} />
              </Grid.Column>
            </Grid>
          ) : !userIsAdmin ? (
            <Grid stackable centered>
              <Grid.Column width={10}>
                <Message negative icon>
                  <Icon name="lock" />
                  <Message.Content>
                    <Message.Header>Conference Admin Access Restricted</Message.Header>
                    <p>
                      Signed in as <strong>{user.email}</strong>. Only authorized Conference
                      Administrators can view or manage this panel.
                    </p>
                    <Button
                      as="a"
                      href="/committees"
                      primary
                      style={{
                        backgroundColor: 'var(--wumun-blue)',
                        color: 'var(--wumun-text-light)',
                        fontWeight: 700,
                        marginTop: '0.5em',
                      }}
                    >
                      <Icon name="users" /> Return to Active Committees
                    </Button>
                  </Message.Content>
                </Message>
              </Grid.Column>
            </Grid>
          ) : (
            <>
              <Header as="h1">
                <Icon name="shield alternate" />
                <Header.Content>
                  {settings.conferenceName} — Conference Administration &amp; Overall Mod Panel
                  <Header.Subheader>
                    Manage global conference settings, notifications, approved accounts, committees, and moderators.
                  </Header.Subheader>
                </Header.Content>
              </Header>

              {statusMessage && (
                <Message
                  positive
                  onDismiss={() => this.setState({ statusMessage: undefined })}
                >
                  <Icon name="check circle" /> {statusMessage}
                </Message>
              )}

              {/* Cross-Committee Live Overview */}
              <Segment>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5em',
                    marginBottom: '1em',
                  }}
                >
                  <Header as="h3" style={{ margin: 0 }}>
                    <Icon name="chart bar" /> Live Conference Overview
                  </Header>
                  <div>
                    <Button
                      size="small"
                      onClick={this.exportConferenceData}
                      style={{
                        backgroundColor: 'var(--wumun-teal)',
                        color: 'var(--wumun-text-light)',
                      }}
                    >
                      <Icon name="download" /> Export Conference JSON
                    </Button>
                  </div>
                </div>
                <Statistic.Group widths="four" size="small">
                  <Statistic>
                    <Statistic.Value>{totalCommittees}</Statistic.Value>
                    <Statistic.Label>Total Committees</Statistic.Label>
                  </Statistic>
                  <Statistic>
                    <Statistic.Value>
                      {totalPresent} / {totalDelegates}
                    </Statistic.Value>
                    <Statistic.Label>Present / Total Delegates</Statistic.Label>
                  </Statistic>
                  <Statistic>
                    <Statistic.Value>{totalOpenCaucuses}</Statistic.Value>
                    <Statistic.Label>Open Caucuses</Statistic.Label>
                  </Statistic>
                  <Statistic>
                    <Statistic.Value>{totalResolutions}</Statistic.Value>
                    <Statistic.Label>Resolutions</Statistic.Label>
                  </Statistic>
                </Statistic.Group>
              </Segment>

              <Grid stackable columns={2}>
                <Grid.Row>
                  {/* 1. Global Notification System */}
                  <Grid.Column width={8}>
                    <Header as="h3" attached="top">
                      <Icon name="bullhorn" /> Global Notification System
                    </Header>
                    <Segment attached="bottom">
                      <Form onSubmit={this.broadcastNotification}>
                        <Form.Input
                          label="Announcement Title"
                          placeholder="e.g. Opening Ceremonies Starting in 10 Minutes"
                          value={notifTitle}
                          onChange={e =>
                            this.setState({ notifTitle: e.currentTarget.value })
                          }
                        />
                        <Form.TextArea
                          label="Notification Message"
                          required
                          placeholder="Enter message to broadcast across the conference..."
                          value={notifMessage}
                          onChange={e =>
                            this.setState({
                              notifMessage: (e.currentTarget as HTMLTextAreaElement).value,
                            })
                          }
                        />
                        <Form.Group widths="equal">
                          <Form.Dropdown
                            label="Banner Color & Contrast Theme"
                            selection
                            options={SEVERITY_OPTIONS}
                            value={notifSeverity}
                            onChange={(_, d) =>
                              this.setState({
                                notifSeverity: (d.value as NotificationSeverity) || 'info',
                              })
                            }
                          />
                          <Form.Dropdown
                            label="Target Audience"
                            selection
                            options={committeeOptions}
                            value={notifTarget}
                            onChange={(_, d) =>
                              this.setState({
                                notifTarget: (d.value as string) || 'all',
                              })
                            }
                          />
                        </Form.Group>

                        {/* Live Banner Color & Text Contrast Preview */}
                        <div
                          className={`wumun-notification-banner wumun-severity-${previewPalette.severity}`}
                          style={{
                            backgroundColor: previewPalette.backgroundColor,
                            color: previewPalette.textColor,
                            border: `2px solid ${previewPalette.borderColor}`,
                            borderRadius: '6px',
                            padding: '0.65em 0.9em',
                            marginBottom: '0.85em',
                            fontSize: '0.92em',
                          }}
                        >
                          <div style={{ fontWeight: 800, color: previewPalette.textColor }}>
                            <Icon name="eye" style={{ color: previewPalette.textColor }} />{' '}
                            Banner Preview:{' '}
                            {notifTitle.trim() || 'WUMUN Conference Announcement'}
                          </div>
                          <div style={{ color: previewPalette.textColor, fontWeight: 600 }}>
                            {notifMessage.trim() ||
                              'Your notification will stand out across the site with this exact palette color and high-contrast text.'}
                          </div>
                        </div>

                        <Form.Button
                          primary
                          fluid
                          disabled={!notifMessage.trim()}
                          style={{
                            backgroundColor: 'var(--wumun-blue)',
                            color: 'var(--wumun-text-light)',
                            fontWeight: 700,
                          }}
                        >
                          <Icon name="send" /> Broadcast Notification Across Site
                        </Form.Button>
                      </Form>

                      <Header as="h4" dividing style={{ marginTop: '1.2em' }}>
                        Active &amp; Recent Broadcasts ({Object.keys(notifications).length})
                      </Header>
                      {Object.keys(notifications).length === 0 ? (
                        <p>No global notifications broadcasted yet.</p>
                      ) : (
                        <List divided relaxed>
                          {Object.entries(notifications)
                            .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
                            .map(([id, n]) => {
                              const itemPalette = getNotificationPalette(n.severity);
                              return (
                                <List.Item key={id}>
                                  <List.Content floated="right">
                                    <Checkbox
                                      toggle
                                      checked={Boolean(n.active)}
                                      onChange={(_, d) =>
                                        this.notifsRef
                                          .child(id)
                                          .child('active')
                                          .set(Boolean(d.checked))
                                      }
                                      style={{ marginRight: '0.5em' }}
                                    />
                                    <Button
                                      size="mini"
                                      negative
                                      icon="trash"
                                      onClick={() => this.notifsRef.child(id).remove()}
                                    />
                                  </List.Content>
                                  <List.Content>
                                    <List.Header>
                                      <Label
                                        size="mini"
                                        style={{
                                          backgroundColor: itemPalette.backgroundColor,
                                          color: itemPalette.textColor,
                                          border: `1px solid ${itemPalette.borderColor}`,
                                          fontWeight: 700,
                                          marginRight: '0.4em',
                                        }}
                                      >
                                        {itemPalette.severity.toUpperCase()}
                                      </Label>
                                      {n.title}{' '}
                                      <Label
                                        size="mini"
                                        style={{
                                          backgroundColor: 'var(--wumun-navy)',
                                          color: 'var(--wumun-text-light)',
                                        }}
                                      >
                                        {n.targetCommitteeID === 'all' || !n.targetCommitteeID
                                          ? 'All Committees'
                                          : committees[n.targetCommitteeID]?.name ||
                                            n.targetCommitteeID}
                                      </Label>
                                    </List.Header>
                                    <List.Description>{n.message}</List.Description>
                                  </List.Content>
                                </List.Item>
                              );
                            })}
                        </List>
                      )}
                    </Segment>
                  </Grid.Column>

                  {/* 2. Conference Settings & Approved Users / Admins */}
                  <Grid.Column width={8}>
                    <Header as="h3" attached="top">
                      <Icon name="cog" /> Conference Settings &amp; Approved Accounts
                    </Header>
                    <Segment attached="bottom">
                      <Form onSubmit={this.saveConferenceSettings}>
                        <Form.Input
                          label="Conference Name"
                          value={settings.conferenceName}
                          onChange={e =>
                            this.setState({
                              settings: {
                                ...settings,
                                conferenceName: e.currentTarget.value,
                              },
                            })
                          }
                        />
                        <Form.Group widths="equal">
                          <Form.Input
                            label="Subtitle / Theme"
                            value={settings.subtitle}
                            onChange={e =>
                              this.setState({
                                settings: {
                                  ...settings,
                                  subtitle: e.currentTarget.value,
                                },
                              })
                            }
                          />
                          <Form.Input
                            label="Session Dates"
                            value={settings.dates}
                            onChange={e =>
                              this.setState({
                                settings: {
                                  ...settings,
                                  dates: e.currentTarget.value,
                                },
                              })
                            }
                          />
                        </Form.Group>
                        <Form.Field>
                          <Checkbox
                            toggle
                            label="Lock All Committees Conference-Wide (Freeze Delegate Changes)"
                            checked={Boolean(settings.allCommitteesLocked)}
                            onChange={(_, d) =>
                              this.setState(
                                {
                                  settings: {
                                    ...settings,
                                    allCommitteesLocked: Boolean(d.checked),
                                  },
                                },
                                () => this.saveConferenceSettings()
                              )
                            }
                          />
                        </Form.Field>
                        <Form.Button
                          positive
                          fluid
                          style={{
                            backgroundColor: 'var(--wumun-green)',
                            color: 'var(--wumun-text-light)',
                            fontWeight: 700,
                          }}
                        >
                          <Icon name="save" /> Save Conference Settings
                        </Form.Button>
                      </Form>

                      <Header as="h4" dividing style={{ marginTop: '1.5em' }}>
                        <Icon name="check circle" /> Approved Accounts (Can Create Committees)
                      </Header>
                      <Form onSubmit={this.addApprovedUserByEmail}>
                        <Input
                          fluid
                          placeholder="Approve chair/staff email (e.g. chair@winthrop.edu)"
                          value={newApprovedEmail}
                          onChange={e =>
                            this.setState({ newApprovedEmail: e.currentTarget.value })
                          }
                          action={{
                            content: 'Approve Account',
                            icon: 'check',
                            onClick: this.addApprovedUserByEmail,
                            style: {
                              backgroundColor: 'var(--wumun-teal)',
                              color: 'var(--wumun-text-light)',
                            },
                          }}
                        />
                      </Form>
                      <List divided relaxed style={{ marginTop: '0.6em' }}>
                        {Object.entries(approvedUsers).map(([key, rec]) => {
                          const email =
                            typeof rec === 'object' && rec.email ? rec.email : key;
                          return (
                            <List.Item key={key}>
                              <List.Content floated="right">
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => this.removeApprovedUser(key, email)}
                                />
                              </List.Content>
                              <Icon name="user" />
                              <List.Content>
                                <List.Header>{email}</List.Header>
                                <List.Description>Approved Committee Creator</List.Description>
                              </List.Content>
                            </List.Item>
                          );
                        })}
                        {Object.keys(approvedUsers).length === 0 && (
                          <List.Item>
                            <List.Content>
                              <List.Description>
                                No extra approved accounts yet (Conference Admins can always
                                create committees).
                              </List.Description>
                            </List.Content>
                          </List.Item>
                        )}
                      </List>

                      <Header as="h4" dividing style={{ marginTop: '1.2em' }}>
                        <Icon name="user secret" /> Conference Admins
                      </Header>
                      <Form onSubmit={this.addAdminByEmail}>
                        <Input
                          fluid
                          placeholder="Add Conference Admin by email"
                          value={newAdminEmail}
                          onChange={e =>
                            this.setState({ newAdminEmail: e.currentTarget.value })
                          }
                          action={{
                            content: 'Promote Admin',
                            icon: 'plus',
                            onClick: this.addAdminByEmail,
                            style: {
                              backgroundColor: 'var(--wumun-navy)',
                              color: 'var(--wumun-text-light)',
                            },
                          }}
                        />
                      </Form>
                      <List divided relaxed style={{ marginTop: '0.6em' }}>
                        {DEFAULT_ADMIN_EMAILS.map(defaultEmail => (
                          <List.Item key={defaultEmail}>
                            <Icon name="shield alternate" />
                            <List.Content>
                              <List.Header>{defaultEmail}</List.Header>
                              <List.Description>Default Primary Conference Admin</List.Description>
                            </List.Content>
                          </List.Item>
                        ))}
                        {Object.entries(admins).map(([key, adm]) => {
                          const email =
                            typeof adm === 'object' && adm.email ? adm.email : key;
                          if (DEFAULT_ADMIN_EMAILS.includes(email.toLowerCase())) {
                            return null;
                          }
                          return (
                            <List.Item key={key}>
                              <List.Content floated="right">
                                <Button
                                  size="mini"
                                  negative
                                  icon="trash"
                                  onClick={() => this.removeAdmin(key, email)}
                                />
                              </List.Content>
                              <Icon name="shield alternate" />
                              <List.Content>
                                <List.Header>{email}</List.Header>
                                <List.Description>Conference Admin</List.Description>
                              </List.Content>
                            </List.Item>
                          );
                        })}
                      </List>
                    </Segment>
                  </Grid.Column>
                </Grid.Row>

                {/* 3. Overall Committee Moderator Assignment & Quick Create */}
                <Grid.Row>
                  <Grid.Column width={8}>
                    <Header as="h3" attached="top">
                      <Icon name="shield" /> Assign / Remove Committee Moderators
                    </Header>
                    <Segment attached="bottom">
                      {committeeEntries.length === 0 ? (
                        <p>Create a committee first to assign committee moderators.</p>
                      ) : (
                        <>
                          <Form.Field style={{ marginBottom: '0.8em' }}>
                            <label>Select Committee</label>
                            <Dropdown
                              fluid
                              selection
                              options={committeeEntries.map(([id, c]) => ({
                                key: id,
                                text: `${c.name || id} (${
                                  Object.keys(c.moderators || {}).length
                                } mods)`,
                                value: id,
                              }))}
                              value={selectedCommitteeForMod}
                              onChange={(_, d) =>
                                this.setState({
                                  selectedCommitteeForMod: (d.value as string) || '',
                                })
                              }
                            />
                          </Form.Field>

                          <Form onSubmit={this.addModeratorToSelectedCommittee}>
                            <Input
                              fluid
                              placeholder="Enter moderator email (e.g. dais@winthrop.edu)"
                              value={modEmailInput}
                              onChange={e =>
                                this.setState({ modEmailInput: e.currentTarget.value })
                              }
                              action={{
                                content: 'Add Moderator',
                                icon: 'plus',
                                onClick: this.addModeratorToSelectedCommittee,
                                style: {
                                  backgroundColor: 'var(--wumun-green)',
                                  color: 'var(--wumun-text-light)',
                                  fontWeight: 700,
                                },
                              }}
                            />
                          </Form>

                          {selectedCommData && (
                            <div style={{ marginTop: '1em' }}>
                              <p>
                                <strong>Committee Head:</strong>{' '}
                                {selectedCommData.creatorEmail ||
                                  selectedCommData.chair ||
                                  selectedCommData.creatorUid ||
                                  'Unassigned'}
                              </p>
                              <List divided relaxed>
                                {Object.entries(selectedCommData.moderators || {}).map(
                                  ([mKey, mod]) => (
                                    <List.Item key={mKey}>
                                      <List.Content floated="right">
                                        <Button
                                          size="mini"
                                          negative
                                          icon="trash"
                                          content="Remove"
                                          onClick={() =>
                                            this.removeModeratorFromCommittee(
                                              selectedCommitteeForMod,
                                              mKey,
                                              mod.email
                                            )
                                          }
                                        />
                                      </List.Content>
                                      <Icon name="user" />
                                      <List.Content>
                                        <List.Header>{mod.email}</List.Header>
                                      </List.Content>
                                    </List.Item>
                                  )
                                )}
                              </List>
                              {Object.keys(selectedCommData.moderators || {}).length === 0 && (
                                <p style={{ color: 'var(--wumun-brown)' }}>
                                  No additional moderators assigned to{' '}
                                  {selectedCommData.name}.
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </Segment>
                  </Grid.Column>

                  <Grid.Column width={8}>
                    <Header as="h3" attached="top">
                      <Icon name="plus circle" /> Quick-Create Committee
                    </Header>
                    <Segment attached="bottom">
                      <Form onSubmit={this.createCommitteeFromAdmin}>
                        <Form.Dropdown
                          label="Country Template (Optional)"
                          selection
                          clearable
                          search
                          placeholder="Optional preset delegation list"
                          options={Object.values(Template).map(makeDropdownOption)}
                          value={newCommTemplate}
                          onChange={(_, d) =>
                            this.setState({
                              newCommTemplate: d.value as Template | undefined,
                              newCommName:
                                (d.value as string) || this.state.newCommName,
                            })
                          }
                        />
                        <Form.Input
                          label="Committee Name"
                          required
                          placeholder="e.g. UN Security Council"
                          value={newCommName}
                          onChange={e =>
                            this.setState({ newCommName: e.currentTarget.value })
                          }
                        />
                        <Form.Group widths="equal">
                          <Form.Input
                            label="Topic"
                            placeholder="Committee topic"
                            value={newCommTopic}
                            onChange={e =>
                              this.setState({ newCommTopic: e.currentTarget.value })
                            }
                          />
                          <Form.Input
                            label="Chair / Head Name"
                            placeholder="Chair name"
                            value={newCommChair}
                            onChange={e =>
                              this.setState({ newCommChair: e.currentTarget.value })
                            }
                          />
                        </Form.Group>
                        <Form.Button
                          primary
                          fluid
                          disabled={!newCommName.trim()}
                          style={{
                            backgroundColor: 'var(--wumun-blue)',
                            color: 'var(--wumun-text-light)',
                            fontWeight: 700,
                          }}
                        >
                          <Icon name="plus" /> Launch Committee
                        </Form.Button>
                      </Form>
                    </Segment>
                  </Grid.Column>
                </Grid.Row>

                {/* 4. Master Committees Table */}
                <Grid.Row>
                  <Grid.Column width={16}>
                    <Header as="h3" attached="top">
                      <Icon name="table" /> All Conference Committees ({committeeEntries.length})
                    </Header>
                    <Segment attached="bottom">
                      {committeeEntries.length === 0 ? (
                        <p>No committees created yet.</p>
                      ) : (
                        <Table celled compact stackable>
                          <Table.Header>
                            <Table.Row>
                              <Table.HeaderCell>Committee</Table.HeaderCell>
                              <Table.HeaderCell>Head &amp; Moderators</Table.HeaderCell>
                              <Table.HeaderCell>Delegates</Table.HeaderCell>
                              <Table.HeaderCell>Mode / Locks</Table.HeaderCell>
                              <Table.HeaderCell>Status</Table.HeaderCell>
                              <Table.HeaderCell>Actions</Table.HeaderCell>
                            </Table.Row>
                          </Table.Header>
                          <Table.Body>
                            {committeeEntries.map(([id, c]) => {
                              const members = Object.values(c.members || {}).filter(
                                m => m && !isDaisMember(m)
                              );
                              const present = members.filter(m => m && m.present).length;
                              const mods = Object.values(c.moderators || {});
                              const locks = recoverFeatureLocks(c);
                              const lockedCount = Object.values(locks).filter(Boolean).length;

                              return (
                                <Table.Row key={id}>
                                  <Table.Cell>
                                    <strong>
                                      <a
                                        href={`/committees/${id}`}
                                        onClick={e => {
                                          e.preventDefault();
                                          this.props.history.push(`/committees/${id}`);
                                        }}
                                      >
                                        {c.name || 'Untitled'}
                                      </a>
                                    </strong>
                                    <div style={{ fontSize: '0.88em', color: 'var(--wumun-brown)' }}>
                                      {c.topic || 'No topic'}
                                    </div>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <div>
                                      <strong>Head:</strong>{' '}
                                      {c.creatorEmail || c.chair || 'Creator'}
                                    </div>
                                    <div style={{ fontSize: '0.88em' }}>
                                      <strong>Mods ({mods.length}):</strong>{' '}
                                      {mods.map(m => m.email).join(', ') || 'None'}
                                    </div>
                                  </Table.Cell>
                                  <Table.Cell>
                                    {present} / {members.length} Present
                                  </Table.Cell>
                                  <Table.Cell>
                                    {locks.physicalMode ? (
                                      <Label
                                        size="small"
                                        style={{
                                          backgroundColor: 'var(--wumun-navy)',
                                          color: 'var(--wumun-text-light)',
                                        }}
                                      >
                                        Physical Mode
                                      </Label>
                                    ) : lockedCount > 0 ? (
                                      <Label
                                        size="small"
                                        style={{
                                          backgroundColor: 'var(--wumun-yellow)',
                                          color: 'var(--wumun-text-dark)',
                                          fontWeight: 700,
                                        }}
                                      >
                                        {lockedCount} Features Locked
                                      </Label>
                                    ) : (
                                      <Label
                                        size="small"
                                        style={{
                                          backgroundColor: 'var(--wumun-green)',
                                          color: 'var(--wumun-text-light)',
                                          fontWeight: 700,
                                        }}
                                      >
                                        Full Digital
                                      </Label>
                                    )}
                                  </Table.Cell>
                                  <Table.Cell>
                                    <Checkbox
                                      label="Locked"
                                      checked={Boolean(c.locked)}
                                      onChange={(_, d) =>
                                        this.committeesRef
                                          .child(id)
                                          .child('locked')
                                          .set(Boolean(d.checked))
                                      }
                                      style={{ marginRight: '0.75em' }}
                                    />
                                    <Checkbox
                                      label="Archived"
                                      checked={Boolean(c.archived)}
                                      onChange={(_, d) =>
                                        this.committeesRef
                                          .child(id)
                                          .child('archived')
                                          .set(Boolean(d.checked))
                                      }
                                    />
                                  </Table.Cell>
                                  <Table.Cell collapsing>
                                    <Button
                                      as="a"
                                      href={`/committees/${id}/mod`}
                                      onClick={(e: React.MouseEvent) => {
                                        e.preventDefault();
                                        this.props.history.push(`/committees/${id}/mod`);
                                      }}
                                      size="tiny"
                                      style={{
                                        backgroundColor: 'var(--wumun-navy)',
                                        color: 'var(--wumun-text-light)',
                                      }}
                                    >
                                      <Icon name="sliders horizontal" /> Mod Panel
                                    </Button>
                                    <Button
                                      as="a"
                                      href={`/committees/${id}`}
                                      onClick={(e: React.MouseEvent) => {
                                        e.preventDefault();
                                        this.props.history.push(`/committees/${id}`);
                                      }}
                                      size="tiny"
                                      primary
                                      style={{
                                        backgroundColor: 'var(--wumun-blue)',
                                        color: 'var(--wumun-text-light)',
                                        fontWeight: 700,
                                      }}
                                    >
                                      Open
                                    </Button>
                                    <Button
                                      size="tiny"
                                      negative
                                      icon="trash"
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `Delete committee "${c.name}" permanently?`
                                          )
                                        ) {
                                          this.committeesRef.child(id).remove();
                                        }
                                      }}
                                    />
                                  </Table.Cell>
                                </Table.Row>
                              );
                            })}
                          </Table.Body>
                        </Table>
                      )}
                    </Segment>
                  </Grid.Column>
                </Grid.Row>
              </Grid>
            </>
          )}
        </Container>
      </>
    );
  }
}
