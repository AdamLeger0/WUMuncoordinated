import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import {
  Button,
  Card,
  Checkbox,
  Container,
  Grid,
  Header,
  Icon,
  Input,
  Label,
  Message,
  Segment,
  Statistic,
} from 'semantic-ui-react';
import { Helmet } from 'react-helmet';
import TopNav from '../components/TopNav';
import ConnectionStatus from '../components/ConnectionStatus';
import { CommitteeData, CommitteeID, recoverFeatureLocks } from '../models/committee';
import {
  AdminRecord,
  ApprovedUserRecord,
  ConferenceSettings,
  DEFAULT_CONFERENCE_SETTINGS,
  isApprovedUser,
  isCommitteeStaff,
  isConferenceAdmin,
} from '../models/conference';
import { CaucusStatus } from '../models/caucus';
import { isDaisMember } from '../modules/member';

interface Props extends RouteComponentProps {}

interface State {
  committees: Record<CommitteeID, CommitteeData>;
  settings: ConferenceSettings;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
  user: firebase.User | null;
  searchQuery: string;
  showArchived: boolean;
  unsubscribeAuth?: () => void;
}

export default class CommitteesDirectory extends React.Component<Props, State> {
  private committeesRef = firebase.database().ref('committees');
  private settingsRef = firebase.database().ref('conference/settings');
  private adminsRef = firebase.database().ref('conference/admins');
  private approvedRef = firebase.database().ref('conference/approvedUsers');

  constructor(props: Props) {
    super(props);
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    this.state = {
      committees: {},
      settings: DEFAULT_CONFERENCE_SETTINGS,
      admins: {},
      approvedUsers: {},
      user: initialUser,
      searchQuery: '',
      showArchived: false,
    };
  }

  onCommittees = (snap: firebase.database.DataSnapshot | null) => {
    const raw = (snap && snap.val()) || {};
    const committees: Record<CommitteeID, CommitteeData> = {};
    Object.entries(raw).forEach(([k, v]) => {
      if (k !== '__wumun_hub__' && v && typeof v === 'object') {
        committees[k] = v as CommitteeData;
      }
    });
    this.setState({ committees });
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

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  onApproved = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ approvedUsers: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    this.committeesRef = firebase.database().ref('committees');
    this.settingsRef = firebase.database().ref('conference/settings');
    this.adminsRef = firebase.database().ref('conference/admins');
    this.approvedRef = firebase.database().ref('conference/approvedUsers');

    this.committeesRef.on('value', this.onCommittees);
    this.settingsRef.on('value', this.onSettings);
    this.adminsRef.on('value', this.onAdmins);
    this.approvedRef.on('value', this.onApproved);

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
    this.committeesRef.off('value', this.onCommittees);
    this.settingsRef.off('value', this.onSettings);
    this.adminsRef.off('value', this.onAdmins);
    this.approvedRef.off('value', this.onApproved);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  renderCommitteeCard = (id: CommitteeID, c: CommitteeData) => {
    const { user, admins, settings } = this.state;
    const members = Object.values(c.members || {}).filter(m => m && !isDaisMember(m));
    const presentCount = members.filter(m => m && m.present).length;
    const caucuses = Object.values(c.caucuses || {}).filter(
      ca => ca && ca.status !== CaucusStatus.Closed
    );
    const resolutionsCount = Object.keys(c.resolutions || {}).length;
    const modsCount = Object.keys(c.moderators || {}).length;
    const locks = recoverFeatureLocks(c);
    const hasFeatureLocks = Object.values(locks).some(Boolean);
    const isStaff = isCommitteeStaff(user, c, admins);
    const isLocked = Boolean(c.locked || settings.allCommitteesLocked);

    return (
      <Card key={id} fluid>
        <Card.Content>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '0.5em',
            }}
          >
            <div>
              <Card.Header
                as="a"
                href={`/committees/${id}`}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  this.props.history.push(`/committees/${id}`);
                }}
                style={{ fontSize: '1.3em', color: 'var(--wumun-navy)' }}
              >
                {c.name || 'Untitled Committee'}
              </Card.Header>
              <Card.Meta style={{ marginTop: '0.25em', color: 'var(--wumun-brown)' }}>
                {c.topic ? `Topic: ${c.topic}` : 'No topic specified'}
                {c.chair ? ` • Chair: ${c.chair}` : ''}
              </Card.Meta>
            </div>
            <div style={{ display: 'flex', gap: '0.35em', flexWrap: 'wrap' }}>
              {c.archived ? (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-brown)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="archive" /> Archived
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
                  <Icon name="check circle" /> Active
                </Label>
              )}
              {isLocked && (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-red)',
                    color: 'var(--wumun-text-light)',
                    fontWeight: 700,
                  }}
                >
                  <Icon name="lock" /> Locked
                </Label>
              )}
              {locks.physicalMode && (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-navy)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="hand paper outline" /> Physical Mode (Read-Only Floor)
                </Label>
              )}
              {hasFeatureLocks && (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-yellow)',
                    color: 'var(--wumun-text-dark)',
                    fontWeight: 700,
                  }}
                >
                  <Icon name="sliders horizontal" /> Custom Feature Locks
                </Label>
              )}
              {isStaff && (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-teal)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="shield" /> Staff / Mod Access
                </Label>
              )}
            </div>
          </div>

          <Card.Description style={{ marginTop: '0.85em' }}>
            <Label basic>
              <Icon name="users" /> {presentCount} / {members.length} Present
            </Label>
            <Label basic>
              <Icon name="comments" /> {caucuses.length} Open Caucuses
            </Label>
            <Label basic>
              <Icon name="file alternate outline" /> {resolutionsCount} Resolutions
            </Label>
            <Label basic>
              <Icon name="shield" /> {modsCount + 1} Staff/Mods
            </Label>
          </Card.Description>
        </Card.Content>
        <Card.Content extra>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5em',
            }}
          >
            <Button
              as="a"
              href={`/committees/${id}`}
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                this.props.history.push(`/committees/${id}`);
              }}
              primary
              size="small"
              style={{
                backgroundColor: 'var(--wumun-blue)',
                color: 'var(--wumun-text-light)',
                fontWeight: 700,
              }}
            >
              Enter Committee <Icon name="arrow right" />
            </Button>
            {isStaff && (
              <Button
                as="a"
                href={`/committees/${id}/mod`}
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  this.props.history.push(`/committees/${id}/mod`);
                }}
                size="small"
                style={{
                  backgroundColor: 'var(--wumun-navy)',
                  color: 'var(--wumun-text-light)',
                }}
              >
                <Icon name="sliders horizontal" /> Committee Mod Panel
              </Button>
            )}
          </div>
        </Card.Content>
      </Card>
    );
  };

  render() {
    const {
      committees,
      settings,
      admins,
      approvedUsers,
      user,
      searchQuery,
      showArchived,
    } = this.state;

    const isAdmin = isConferenceAdmin(user, admins);
    const isApproved = isApprovedUser(user, admins, approvedUsers, committees);

    const entries = Object.entries(committees || {}).filter(([, c]) => {
      if (!c) return false;
      if (!showArchived && c.archived) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.topic || '').toLowerCase().includes(q) ||
        (c.chair || '').toLowerCase().includes(q)
      );
    });

    const allActive = Object.values(committees || {}).filter(c => c && !c.archived);
    const totalDelegates = allActive.reduce(
      (acc, c) =>
        acc +
        Object.values(c.members || {}).filter(m => m && !isDaisMember(m)).length,
      0
    );
    const totalResolutions = allActive.reduce(
      (acc, c) => acc + Object.keys(c.resolutions || {}).length,
      0
    );

    return (
      <>
        <TopNav activeTab="committees" />
        <Container style={{ padding: '1.5em 0em 3em' }}>
          <Helmet>
            <title>{`Committees - ${settings.conferenceName}`}</title>
          </Helmet>
          <ConnectionStatus />

          <Segment>
            <Grid stackable verticalAlign="middle">
              <Grid.Row>
                <Grid.Column width={10}>
                  <Header as="h1" style={{ marginBottom: '0.2em' }}>
                    <Icon name="users" />
                    <Header.Content>
                      {settings.conferenceName} — Active Committees
                      <Header.Subheader>
                        {settings.subtitle} ({settings.dates})
                      </Header.Subheader>
                    </Header.Content>
                  </Header>
                </Grid.Column>
                <Grid.Column width={6} textAlign="right">
                  {isApproved && (
                    <Button
                      as="a"
                      href="/onboard"
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        this.props.history.push('/onboard');
                      }}
                      positive
                      style={{
                        backgroundColor: 'var(--wumun-green)',
                        color: 'var(--wumun-text-light)',
                        fontWeight: 700,
                      }}
                    >
                      <Icon name="plus" /> Create Committee
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      as="a"
                      href="/admin"
                      onClick={(e: React.MouseEvent) => {
                        e.preventDefault();
                        this.props.history.push('/admin');
                      }}
                      style={{
                        backgroundColor: 'var(--wumun-navy)',
                        color: 'var(--wumun-text-light)',
                        marginLeft: '0.5em',
                      }}
                    >
                      <Icon name="shield alternate" /> Admin Panel
                    </Button>
                  )}
                </Grid.Column>
              </Grid.Row>
            </Grid>

            <Statistic.Group widths="three" size="small" style={{ marginTop: '1em' }}>
              <Statistic>
                <Statistic.Value>{allActive.length}</Statistic.Value>
                <Statistic.Label>Active Committees</Statistic.Label>
              </Statistic>
              <Statistic>
                <Statistic.Value>{totalDelegates}</Statistic.Value>
                <Statistic.Label>Registered Delegates</Statistic.Label>
              </Statistic>
              <Statistic>
                <Statistic.Value>{totalResolutions}</Statistic.Value>
                <Statistic.Label>Active Resolutions</Statistic.Label>
              </Statistic>
            </Statistic.Group>
          </Segment>

          <Segment>
            <Grid stackable verticalAlign="middle">
              <Grid.Row>
                <Grid.Column width={11}>
                  <Input
                    icon="search"
                    fluid
                    placeholder="Search committees by name, topic, or chair..."
                    value={searchQuery}
                    onChange={e => this.setState({ searchQuery: e.currentTarget.value })}
                  />
                </Grid.Column>
                <Grid.Column width={5} textAlign="right">
                  <Checkbox
                    toggle
                    label="Show archived committees"
                    checked={showArchived}
                    onChange={(_, data) =>
                      this.setState({ showArchived: Boolean(data.checked) })
                    }
                  />
                </Grid.Column>
              </Grid.Row>
            </Grid>
          </Segment>

          {entries.length === 0 ? (
            <Message info>
              <Message.Header>No committees found</Message.Header>
              <p>
                No active committees match your filter for {settings.conferenceName}.
              </p>
            </Message>
          ) : (
            <Card.Group itemsPerRow={1}>
              {entries.map(([id, c]) => this.renderCommitteeCard(id, c))}
            </Card.Group>
          )}
        </Container>
      </>
    );
  }
}
