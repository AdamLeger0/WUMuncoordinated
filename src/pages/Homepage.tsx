import * as React from 'react';
import firebase from 'firebase/compat/app';
import {
  Button,
  Container,
  Grid,
  Header,
  Icon,
  Image,
  List,
  Segment,
} from 'semantic-ui-react';
import { logClickCreateACommitteeButton } from '../modules/analytics';
import { ShareCapabilities } from '../components/share-hints';
import TopNav from '../components/TopNav';
import {
  AdminRecord,
  ApprovedUserRecord,
  isApprovedUser,
} from '../models/conference';
import { CommitteeData, CommitteeID } from '../models/committee';
import { appHistory } from '../index';

const REPO_LINK = 'https://github.com/adamleger0/wumuncoordinated';

interface HomepageState {
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
  committees: Record<CommitteeID, CommitteeData>;
  unsubscribeAuth?: () => void;
}

export default class Homepage extends React.Component<{}, HomepageState> {
  private adminsRef = firebase.database().ref('conference/admins');
  private approvedRef = firebase.database().ref('conference/approvedUsers');
  private committeesRef = firebase.database().ref('committees');

  constructor(props: {}) {
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
      committees: {},
    };
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  onApproved = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ approvedUsers: (snap && snap.val()) || {} });
  };

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

  componentDidMount() {
    this.adminsRef = firebase.database().ref('conference/admins');
    this.approvedRef = firebase.database().ref('conference/approvedUsers');
    this.committeesRef = firebase.database().ref('committees');
    this.adminsRef.on('value', this.onAdmins);
    this.approvedRef.on('value', this.onApproved);
    this.committeesRef.on('value', this.onCommittees);
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
    this.committeesRef.off('value', this.onCommittees);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  go = (path: string, callback?: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (callback) callback();
    appHistory.push(path);
  };

  render() {
    const { user, admins, approvedUsers, committees } = this.state;
    const isApproved = isApprovedUser(user, admins, approvedUsers, committees);

    return (
      <div>
        <TopNav activeTab="home" />
        <Segment
          inverted
          textAlign="center"
          style={{
            padding: '2.5em 1em 3em',
            width: '100%',
            marginTop: 0,
          }}
          vertical
        >
          <Container text>
            <Header
              as="h1"
              content="Winthrop University Model UN"
              inverted
              style={{
                fontSize: '3.2em',
                fontWeight: 600,
                marginBottom: '0.25em',
                marginTop: 0,
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            />
            <Header
              as="h2"
              content="The collaborative browser-based Model UN committee management app"
              inverted
              style={{
                fontSize: '1.35em',
                fontWeight: 'normal',
                marginTop: '0.25em',
                marginBottom: '1.2em',
                overflowWrap: 'break-word',
                wordBreak: 'break-word',
              }}
            />
            <div>
              <Button
                as="a"
                primary
                size="huge"
                href="/committees"
                onClick={this.go('/committees')}
                style={{
                  backgroundColor: 'var(--wumun-blue)',
                  color: 'var(--wumun-text-light)',
                  fontWeight: 700,
                  margin: '0.25em',
                }}
              >
                <Icon name="users" /> View Committees
              </Button>
              {isApproved && (
                <Button
                  as="a"
                  positive
                  size="huge"
                  href="/onboard"
                  onClick={this.go('/onboard', logClickCreateACommitteeButton)}
                  style={{
                    backgroundColor: 'var(--wumun-green)',
                    color: 'var(--wumun-text-light)',
                    fontWeight: 700,
                    margin: '0.25em',
                  }}
                >
                  Create a committee
                  <Icon name="arrow right" />
                </Button>
              )}
            </div>
          </Container>
        </Segment>

        <Segment style={{ padding: '3em 0em', width: '100%' }} vertical>
          <Container>
            <Grid stackable verticalAlign="middle">
              <Grid.Row>
                <Grid.Column width={8}>
                  <Header as="h3" style={{ fontSize: '2em' }}>
                    Collaborative
                  </Header>
                  <p style={{ fontSize: '1.33em' }}>
                    Using a shareable link delegates can: <br />
                    <ShareCapabilities />
                  </p>
                  <p style={{ fontSize: '1.33em' }}>
                    Everyone will see all updates in real-time, without needing to refresh
                    the page. It's like Google Docs, but for MUN.
                  </p>
                  <p style={{ fontSize: '1.33em' }}>
                    For virtual MUNs, we recommend pairing Winthrop University Model UN
                    with <a href="https://discord.com/">Discord</a>, which allows you to
                    speak, pass notes, &amp; share files and links.
                  </p>
                  <p style={{ fontSize: '1.33em' }}>
                    If you've got a big committee, multiple directors can manage it at the
                    same time, using the same account.
                  </p>
                  <Header as="h3" style={{ fontSize: '2em' }}>
                    Backed up to the cloud
                  </Header>
                  <p style={{ fontSize: '1.33em' }}>
                    You won't have to worry about data loss ever again. All committee
                    activity is automatically saved to the server, so you can start
                    sessions with all data available from the day before.
                  </p>
                </Grid.Column>
                <Grid.Column floated="right" width={8}>
                  <Image bordered rounded fluid src="/promo.png" />
                </Grid.Column>
              </Grid.Row>
              <Grid.Row>
                <Grid.Column width={8}>
                  <Header as="h3" style={{ fontSize: '2em' }}>
                    A comprehensive feature set
                  </Header>
                  <div style={{ fontSize: '1.33em' }}>
                    Winthrop University Model UN supports: <br />
                    <List as="ul">
                      <List.Item as="li">Moderated and unmoderated caucuses</List.Item>
                      <List.Item as="li">Resolutions and amendments</List.Item>
                      <List.Item as="li">Motions</List.Item>
                      <List.Item as="li">Roll-call voting</List.Item>
                      <List.Item as="li">Custom delegations</List.Item>
                      <List.Item as="li">Strawpolls</List.Item>
                      <List.Item as="li">File uploads</List.Item>
                      <List.Item as="li">Delegate performance statistics</List.Item>
                    </List>
                  </div>
                  <Header as="h3" style={{ fontSize: '2em' }}>
                    Free and open-source
                  </Header>
                  <p style={{ fontSize: '1.33em' }}>
                    All of Winthrop University Model UN's features are available for free,
                    not locked behind paywalls.
                  </p>
                  <p style={{ fontSize: '1.33em' }}>
                    It's also{' '}
                    <a href="https://github.com/MaxwellBo/Muncoordinated-2">open-source</a>
                    , so you're free to customize it to your needs and liking.
                  </p>
                </Grid.Column>
                <Grid.Column floated="right" width={8}>
                  <Image centered bordered rounded size="medium" src="/mobile6.png" />
                </Grid.Column>
              </Grid.Row>
            </Grid>
          </Container>
        </Segment>
        <Segment inverted vertical style={{ padding: '5em 0em' }}>
          <Container>
            <Grid divided inverted stackable>
              <Grid.Row>
                <Grid.Column width={3}>
                  <Header inverted as="h4" content="About" />
                  <List link inverted>
                    <List.Item as="a" href={REPO_LINK}>
                      Source
                    </List.Item>
                    <List.Item
                      as="a"
                      href="https://github.com/MaxwellBo/Muncoordinated-2/blob/master/LICENSE"
                    >
                      License
                    </List.Item>
                  </List>
                </Grid.Column>
                <Grid.Column width={3}>
                  <Header inverted as="h4" content="Services" />
                  <List link inverted>
                    <List.Item
                      as="a"
                      href="https://github.com/MaxwellBo/Muncoordinated-2/discussions"
                    >
                      Forum
                    </List.Item>
                    <List.Item
                      as="a"
                      href="https://github.com/MaxwellBo/Muncoordinated-2/issues"
                    >
                      Support
                    </List.Item>
                    <List.Item as="a" href="https://www.helpmymun.com/">
                      MUN Resources
                    </List.Item>
                  </List>
                </Grid.Column>
                <Grid.Column width={7}>
                  <Header as="h4" inverted>
                    Info
                  </Header>
                  <p>
                    Made with{' '}
                    <span role="img" aria-label="love">
                      💖
                    </span>{' '}
                    by <a href="https://github.com/MaxwellBo">Max Bo</a>, with assistance
                    from the{' '}
                    <a href="https://www.facebook.com/UQUNSA/">
                      UQ United Nations Student Association
                    </a>
                  </p>
                  <p>Copyright © 2026</p>
                </Grid.Column>
              </Grid.Row>
            </Grid>
          </Container>
        </Segment>
      </div>
    );
  }
}
