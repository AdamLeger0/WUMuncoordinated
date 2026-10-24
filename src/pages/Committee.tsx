import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import { Route } from 'react-router-dom';
import Caucus from './Caucus';
import Resolution from './Resolution';
import Admin from './Admin';
import CommitteeMod from './CommitteeMod';
import {
  Button,
  Container,
  Dropdown,
  Flag,
  Header,
  Icon,
  Input,
  Label,
  List,
  Menu,
  Message,
  Segment,
  SemanticICONS,
  Sidebar,
} from 'semantic-ui-react';
import Stats from './Stats';
import Motions from './Motions';
import Unmod from './Unmod';
import Notes from './Notes';
import Help from './Help';
import { CaucusStatus, DEFAULT_CAUCUS, putCaucus } from '../models/caucus';
import { URLParameters } from '../types';
import Loading from '../components/Loading';
import Footer from '../components/Footer';
import Settings from './Settings';
import Files from './Files';
import { LoginModal } from '../components/auth';
import { CommitteeShareHint } from '../components/share-hints';
import Notifications from '../components/Notifications';
import { DEFAULT_RESOLUTION, putResolution } from '../models/resolution';
import ConnectionStatus from '../components/ConnectionStatus';
import { fieldHandler } from '../modules/handlers';
import { DEFAULT_STRAWPOLL, putStrawpoll } from '../models/strawpoll';
import Strawpoll from './Strawpoll';
import { logClickSetupCommittee } from '../modules/analytics';
import {
  CommitteeData,
  CommitteeID,
  DEFAULT_COMMITTEE,
  recoverFeatureLocks,
} from '../models/committee';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import GlobalBanner from '../components/GlobalBanner';
import {
  DelegateSession,
  getDelegateSession,
  subscribeDelegateSession,
  validateDelegateSession,
} from '../modules/delegate-session';
import {
  DelegationNavBadge,
  DelegationSelectorModal,
} from '../components/DelegationSelector';
import { nameToFlagCode } from '../modules/member';
import { createMedia } from '@artsy/fresnel';
import { Helmet } from 'react-helmet';

interface DesktopContainerProps {
  menu?: React.ReactNode;
  body?: React.ReactNode;
}

interface DesktopContainerState {}

interface MobileContainerProps {
  menu?: React.ReactNode;
  body?: React.ReactNode;
}

interface MobileContainerState {
  sidebarOpened: boolean;
}

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  session: DelegateSession | null;
  selectorOpen: boolean;
  unsubscribeAuth?: () => void;
  unsubscribeSession?: () => void;
}

const CommitteeMedia = createMedia({
  breakpoints: {
    mobile: 320,
    tablet: 768,
    computer: 992,
    largeScreen: 1200,
    widescreen: 1920,
  },
});

const mediaStyles = CommitteeMedia.createMediaStyle();
const { Media, MediaContextProvider } = CommitteeMedia;

class DesktopContainer extends React.Component<DesktopContainerProps, DesktopContainerState> {
  render() {
    const { body, menu } = this.props;
    return (
      <>
        <style>{mediaStyles}</style>
        <MediaContextProvider>
          <Segment as={Media} basic greaterThanOrEqual="tablet" style={{ padding: 0, margin: 0 }}>
            <Menu fluid size="small">
              {menu}
            </Menu>
            {body}
          </Segment>
        </MediaContextProvider>
      </>
    );
  }
}

class MobileContainer extends React.Component<MobileContainerProps, MobileContainerState> {
  constructor(props: MobileContainerProps) {
    super(props);

    this.state = {
      sidebarOpened: false,
    };
  }

  handlePusherClick = () => {
    const { sidebarOpened } = this.state;

    if (sidebarOpened) {
      this.setState({ sidebarOpened: false });
    }
  };

  handleToggle = () => {
    this.setState({ sidebarOpened: !this.state.sidebarOpened });
  };

  render() {
    const { body, menu } = this.props;
    const { sidebarOpened } = this.state;

    return (
      <>
        <style>{mediaStyles}</style>
        <MediaContextProvider>
          <Segment as={Media} basic at="mobile" style={{ padding: 0, margin: 0 }}>
            <Sidebar.Pushable>
              <Sidebar as={Menu} animation="uncover" stackable visible={sidebarOpened}>
                {menu}
              </Sidebar>

              <Sidebar.Pusher
                dimmed={sidebarOpened}
                onClick={this.handlePusherClick}
                style={{ minHeight: '100vh' }}
              >
                <Menu size="large">
                  <Menu.Item onClick={this.handleToggle}>
                    <Icon name="sidebar" />
                  </Menu.Item>
                </Menu>
                {body}
              </Sidebar.Pusher>
            </Sidebar.Pushable>
          </Segment>
        </MediaContextProvider>
      </>
    );
  }
}

interface ResponsiveContainerProps extends RouteComponentProps<URLParameters> {
  children?: React.ReactNode;
  committee?: CommitteeData;
  isStaff: boolean;
  session: DelegateSession | null;
  onOpenDelegationModal: () => void;
}

function ResponsiveNav(props: ResponsiveContainerProps) {
  const committeeID: CommitteeID = props.match.params.committeeID;
  const locks = recoverFeatureLocks(props.committee);
  const { isStaff, session, onOpenDelegationModal } = props;

  const makeMenuItem = (name: string, icon: SemanticICONS, locked?: boolean) => {
    if (locked && !isStaff) {
      return null;
    }
    const destination = `/committees/${committeeID}/${name.toLowerCase()}`;

    return (
      <Menu.Item
        key={name}
        name={name.toLowerCase()}
        active={props.location.pathname === destination}
        onClick={() => props.history.push(destination)}
      >
        {locked && <Icon name="lock" size="small" title="Locked for delegates" />}
        {name}
      </Menu.Item>
    );
  };

  const makeSubmenuButton = (name: string, icon: SemanticICONS, f: () => void) => {
    return (
      <Dropdown.Item
        key={name}
        name={name.toLowerCase()}
        active={false}
        onClick={f}
        icon={icon}
        text={name}
      />
    );
  };

  const makeMenuIcon = (name: string, icon: SemanticICONS) => {
    const destination = `/committees/${committeeID}/${name.toLowerCase()}`;

    return (
      <Menu.Item
        key={name}
        active={props.location.pathname === destination}
        position="right"
        onClick={() => props.history.push(destination)}
        icon={icon}
      />
    );
  };

  const makeSubmenuItem = (
    id: string,
    name: string,
    description: string | undefined,
    type: 'caucuses' | 'resolutions' | 'strawpolls'
  ) => {
    const destination = `/committees/${committeeID}/${type}/${id}`;

    return (
      <Dropdown.Item
        key={id}
        name={name}
        active={props.location.pathname === destination}
        onClick={() => props.history.push(destination)}
        text={name}
      />
    );
  };

  const pushCaucus = () => {
    if (!isStaff) return;
    const ref = putCaucus(committeeID, DEFAULT_CAUCUS);

    props.history.push(`/committees/${committeeID}/caucuses/${ref.key}`);
  };

  const pushResolution = () => {
    if (!isStaff) return;
    const ref = putResolution(committeeID, DEFAULT_RESOLUTION);

    props.history.push(`/committees/${committeeID}/resolutions/${ref.key}`);
  };

  const pushStrawpoll = () => {
    if (!isStaff) return;
    const ref = putStrawpoll(committeeID, DEFAULT_STRAWPOLL);

    props.history.push(`/committees/${committeeID}/strawpolls/${ref.key}`);
  };

  const renderMenuItems = () => {
    const { committee } = props;

    const caucuses = committee ? committee.caucuses : undefined;
    const resolutions = committee ? committee.resolutions : undefined;
    const strawpolls = committee ? committee.strawpolls : undefined;

    const caucusItems = Object.keys(caucuses || {})
      .filter(key => caucuses![key].status !== CaucusStatus.Closed)
      .map(key =>
        makeSubmenuItem(key, caucuses![key].name, caucuses![key].topic, 'caucuses')
      );

    const resolutionItems = Object.keys(resolutions || {}).map(key =>
      makeSubmenuItem(key, resolutions![key].name, undefined, 'resolutions')
    );

    const strawpollItems = Object.keys(strawpolls || {}).map(key =>
      makeSubmenuItem(key, strawpolls![key].question, undefined, 'strawpolls')
    );

    return (
      <React.Fragment>
        <Menu.Item
          key="all-committees"
          title="Back to All Committees"
          onClick={() => props.history.push('/committees')}
        >
          <Icon name="grid layout" /> Committees
        </Menu.Item>
        <Menu.Item
          header
          key="header"
          onClick={() => props.history.push(`/committees/${committeeID}`)}
          active={props.location.pathname === `/committees/${committeeID}`}
        >
          {committee ? committee.name : <Loading small />}
        </Menu.Item>
        {isStaff && makeMenuItem('Setup', 'users')}
        {makeMenuItem('Motions', 'sort numeric descending', locks.lockMotions)}
        {makeMenuItem('Unmod', 'discussions', locks.lockUnmod)}
        {(!locks.lockCaucuses || isStaff) && (
          <Dropdown
            key="caucuses"
            item
            text={locks.lockCaucuses ? '🔒 Caucuses' : 'Caucuses'}
            loading={!committee}
          >
            <Dropdown.Menu>
              {isStaff && makeSubmenuButton('New caucus', 'add', pushCaucus)}
              {caucusItems.length > 0 ? (
                caucusItems
              ) : (
                <Dropdown.Item disabled text="No active caucuses" />
              )}
            </Dropdown.Menu>
          </Dropdown>
        )}
        {(!locks.lockResolutions || isStaff) && (
          <Dropdown
            key="resolutions"
            item
            text={locks.lockResolutions ? '🔒 Resolutions' : 'Resolutions'}
            loading={!committee}
          >
            <Dropdown.Menu>
              {isStaff && makeSubmenuButton('New resolution', 'add', pushResolution)}
              {resolutionItems.length > 0 ? (
                resolutionItems
              ) : (
                <Dropdown.Item disabled text="No resolutions yet" />
              )}
            </Dropdown.Menu>
          </Dropdown>
        )}
        {(!locks.lockStrawpolls || isStaff) && (
          <Dropdown
            key="strawpolls"
            item
            text={locks.lockStrawpolls ? '🔒 Strawpolls' : 'Strawpolls'}
            loading={!committee}
          >
            <Dropdown.Menu>
              {isStaff && makeSubmenuButton('New strawpoll', 'add', pushStrawpoll)}
              {strawpollItems.length > 0 ? (
                strawpollItems
              ) : (
                <Dropdown.Item disabled text="No strawpolls yet" />
              )}
            </Dropdown.Menu>
          </Dropdown>
        )}
        {makeMenuItem('Notes', 'sticky note outline', locks.lockNotes)}
        {makeMenuItem('Posts', 'file outline', locks.lockPosts)}
        {makeMenuItem('Stats', 'chart bar', locks.lockStats)}
        {isStaff && (
          <Menu.Item
            key="mod-panel"
            active={props.location.pathname === `/committees/${committeeID}/mod`}
            onClick={() => props.history.push(`/committees/${committeeID}/mod`)}
            style={{
              backgroundColor: 'var(--wumun-navy)',
              color: 'var(--wumun-text-light)',
            }}
          >
            <Icon name="sliders horizontal" /> Mod Panel
          </Menu.Item>
        )}
        <Menu.Menu key="icon-submenu" position="right">
          <Menu.Item key="delegation-badge">
            <DelegationNavBadge
              isStaff={isStaff}
              session={session}
              physicalMode={locks.physicalMode}
              onClickSwitch={onOpenDelegationModal}
            />
          </Menu.Item>
          {isStaff && makeMenuIcon('Settings', 'settings')}
          {makeMenuIcon('Help', 'help')}
        </Menu.Menu>
        <Menu.Item key="login">
          <LoginModal />
        </Menu.Item>
      </React.Fragment>
    );
  };

  return (
    <React.Fragment>
      <DesktopContainer body={props.children} menu={renderMenuItems()} />
      <MobileContainer body={props.children} menu={renderMenuItems()} />
    </React.Fragment>
  );
}

export default class Committee extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');

  constructor(props: Props) {
    super(props);

    const committeeID: CommitteeID = this.props.match.params.committeeID;
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    this.state = {
      committeeFref: firebase.database().ref('committees').child(committeeID),
      user: initialUser,
      admins: {},
      session: getDelegateSession(committeeID),
      selectorOpen: false,
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      this.setState({ committee: committee.val() });
    }
  };

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    const { committeeID } = this.props.match.params;
    this.state.committeeFref.on('value', this.firebaseCallback);
    this.adminsRef.on('value', this.onAdmins);

    const unsubscribeSession = subscribeDelegateSession(committeeID, session => {
      this.setState({ session });
    });

    let unsubscribeAuth: (() => void) | undefined;
    try {
      unsubscribeAuth = firebase.auth().onAuthStateChanged(
        user => this.setState({ user }),
        () => this.setState({ user: null })
      );
    } catch (e) {
      this.setState({ user: null });
    }

    this.setState({ unsubscribeAuth, unsubscribeSession });
  }

  componentWillUnmount() {
    this.state.committeeFref.off('value', this.firebaseCallback);
    this.adminsRef.off('value', this.onAdmins);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
    if (this.state.unsubscribeSession) {
      this.state.unsubscribeSession();
    }
  }

  gotoSetup = () => {
    const { committeeID } = this.props.match.params;

    this.props.history.push(`/committees/${committeeID}/setup`);

    logClickSetupCommittee();
  };

  renderAdmin = () => {
    return (
      <Admin
        {...this.props}
        committee={this.state.committee || DEFAULT_COMMITTEE}
        fref={this.state.committeeFref}
      />
    );
  };

  renderMod = () => {
    return (
      <CommitteeMod
        {...this.props}
        committee={this.state.committee || DEFAULT_COMMITTEE}
        fref={this.state.committeeFref}
      />
    );
  };

  renderLockedFeature = (featureName: string) => {
    return (
      <Container text style={{ padding: '2em 0em' }}>
        <Message warning icon>
          <Icon name="lock" />
          <Message.Content>
            <Message.Header>{featureName} Disabled for This Committee</Message.Header>
            <p>
              The Committee Head or Conference Administration has locked {featureName} for
              this committee session.
            </p>
          </Message.Content>
        </Message>
      </Container>
    );
  };

  renderWelcome = () => {
    const { committee, committeeFref, user, admins, session } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const committeeID = this.props.match.params.committeeID;

    if (!isStaff) {
      return (
        <Container text style={{ padding: '1.5em 0em' }}>
          <Helmet>
            <title>{`${committee?.name || 'Committee'} - Winthrop University Model UN`}</title>
          </Helmet>
          <Segment>
            <Header as="h1" style={{ marginBottom: '0.3em' }}>
              {committee?.name || 'Committee'}
              {committee?.topic && (
                <Header.Subheader style={{ marginTop: '0.35em', fontSize: '1.05rem' }}>
                  <strong>Topic:</strong> {committee.topic}
                </Header.Subheader>
              )}
            </Header>
            <p style={{ color: 'var(--wumun-brown)', marginBottom: '1em' }}>
              <strong>Conference:</strong> {committee?.conference || 'Winthrop University Model UN'}
            </p>

            {validSession ? (
              <Message info>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5em',
                  }}
                >
                  <div>
                    {validSession.role === 'delegate' && validSession.memberName ? (
                      <>
                        Acting as Delegation:{' '}
                        <strong>
                          <Flag name={nameToFlagCode(validSession.memberName)} />
                          {validSession.memberName}
                        </strong>
                      </>
                    ) : (
                      <>
                        Viewing as: <strong>Observer (Read-Only)</strong>
                      </>
                    )}
                  </div>
                  <Button
                    size="tiny"
                    onClick={() => this.setState({ selectorOpen: true })}
                    style={{
                      backgroundColor: 'var(--wumun-navy)',
                      color: 'var(--wumun-text-light)',
                    }}
                  >
                    <Icon name="exchange" /> Switch Delegation
                  </Button>
                </div>
              </Message>
            ) : (
              <Button
                primary
                fluid
                onClick={() => this.setState({ selectorOpen: true })}
                style={{ marginBottom: '1em' }}
              >
                <Icon name="globe" /> Select Your Delegation
              </Button>
            )}

            <div style={{ display: 'flex', gap: '0.6em', flexWrap: 'wrap', marginTop: '1em' }}>
              <Button
                primary
                size="large"
                onClick={() =>
                  this.props.history.push(`/committees/${committeeID}/caucuses/gsl`)
                }
              >
                General Speakers' List <Icon name="arrow right" />
              </Button>
              <Button
                size="large"
                onClick={() =>
                  this.props.history.push(`/committees/${committeeID}/motions`)
                }
                style={{
                  backgroundColor: 'var(--wumun-teal)',
                  color: 'var(--wumun-text-light)',
                }}
              >
                <Icon name="sort numeric descending" /> View Motions
              </Button>
            </div>
          </Segment>
        </Container>
      );
    }

    return (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`${committee?.name || 'Committee'} - Winthrop University Model UN`}</title>
        </Helmet>
        <Header as="h1">
          <Input
            value={committee ? committee.name : ''}
            onChange={fieldHandler<CommitteeData>(committeeFref, 'name')}
            fluid
            error={committee ? !committee.name : false}
            placeholder="Committee name"
          />
        </Header>
        <List>
          <List.Item>
            <Input
              label="Topic"
              value={committee ? committee.topic : ''}
              onChange={fieldHandler<CommitteeData>(committeeFref, 'topic')}
              fluid
              loading={!committee}
              placeholder="Committee topic"
            />
          </List.Item>
          <List.Item>
            <Input
              label="Conference"
              value={committee ? committee.conference : ''}
              onChange={fieldHandler<CommitteeData>(committeeFref, 'conference')}
              fluid
              loading={!committee}
              placeholder="Conference name"
            />
          </List.Item>
        </List>
        <CommitteeShareHint committeeID={this.props.match.params.committeeID} />
        <Segment textAlign="center" basic style={{ padding: 0 }}>
          <Button as="a" primary size="large" onClick={this.gotoSetup}>
            Setup committee
            <Icon name="arrow right" />
          </Button>
          {isStaff && (
            <Button
              as="a"
              size="large"
              onClick={() =>
                this.props.history.push(
                  `/committees/${this.props.match.params.committeeID}/mod`
                )
              }
              style={{
                backgroundColor: 'var(--wumun-navy)',
                color: 'var(--wumun-text-light)',
                marginLeft: '0.5em',
              }}
            >
              <Icon name="sliders horizontal" /> Committee Mod Panel
            </Button>
          )}
        </Segment>
      </Container>
    );
  };

  render() {
    const { renderAdmin, renderMod, renderWelcome } = this;
    const { committee, user, admins, session, selectorOpen } = this.state;
    const committeeID = this.props.match.params.committeeID;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const locks = recoverFeatureLocks(committee);
    const validSession = validateDelegateSession(session, committee);

    // Require delegation or observer selection when a non-staff visitor enters a loaded committee
    const needsSelection = Boolean(committee && !isStaff && !validSession);
    const modalOpen = selectorOpen || needsSelection;

    return (
      <React.Fragment>
        <Notifications {...this.props} />
        <DelegationSelectorModal
          committeeID={committeeID}
          committee={committee}
          currentSession={validSession}
          open={modalOpen}
          canClose={!needsSelection}
          onClose={() => this.setState({ selectorOpen: false })}
        />
        <ResponsiveNav
          {...this.props}
          committee={this.state.committee}
          isStaff={isStaff}
          session={validSession}
          onOpenDelegationModal={() => this.setState({ selectorOpen: true })}
        >
          <GlobalBanner committeeID={committeeID} />
          {locks.physicalMode && (
            <Container style={{ marginTop: '0.75em' }}>
              <Message
                size="small"
                style={{
                  backgroundColor: 'var(--wumun-navy)',
                  color: 'var(--wumun-text-light)',
                  border: '1px solid var(--wumun-yellow)',
                }}
              >
                <Icon name="hand paper outline" />
                <strong>Physical Committee Mode Active:</strong>{' '}
                {isStaff
                  ? 'Delegates are viewing a live read-only floor display. All timers, queues, and motions are controlled by the Dais.'
                  : 'Read-only floor display. View live timers, speaking lists, and motions below — pass physical notes to the Dais in person for floor requests.'}
              </Message>
            </Container>
          )}
          <Container text>
            <ConnectionStatus />
          </Container>
          <Route exact={true} path="/committees/:committeeID" render={renderWelcome} />
          <Route exact={true} path="/committees/:committeeID/setup" render={renderAdmin} />
          <Route exact={true} path="/committees/:committeeID/mod" render={renderMod} />
          <Route
            exact={true}
            path="/committees/:committeeID/stats"
            component={
              locks.lockStats && !isStaff
                ? () => this.renderLockedFeature('Delegate Statistics')
                : Stats
            }
          />
          <Route
            exact={true}
            path="/committees/:committeeID/unmod"
            component={
              locks.lockUnmod && !isStaff
                ? () => this.renderLockedFeature('Unmoderated Caucus Timer')
                : Unmod
            }
          />
          <Route
            exact={true}
            path="/committees/:committeeID/motions"
            component={
              locks.lockMotions && !isStaff
                ? () => this.renderLockedFeature('Digital Motions')
                : Motions
            }
          />
          <Route
            exact={true}
            path="/committees/:committeeID/notes"
            component={
              locks.lockNotes && !isStaff
                ? () => this.renderLockedFeature('Shared Notes')
                : Notes
            }
          />
          <Route
            exact={true}
            path="/committees/:committeeID/posts"
            component={
              locks.lockPosts && !isStaff
                ? () => this.renderLockedFeature('Posts & File Sharing')
                : Files
            }
          />
          <Route exact={true} path="/committees/:committeeID/settings" component={Settings} />
          <Route exact={true} path="/committees/:committeeID/help" component={Help} />
          <Route
            path="/committees/:committeeID/caucuses/:caucusID"
            component={
              locks.lockCaucuses && !isStaff
                ? () => this.renderLockedFeature('Caucuses & Speakers Lists')
                : Caucus
            }
          />
          <Route
            path="/committees/:committeeID/resolutions/:resolutionID/:tab?"
            component={
              locks.lockResolutions && !isStaff
                ? () => this.renderLockedFeature('Resolutions & Amendments')
                : Resolution
            }
          />
          <Route
            path="/committees/:committeeID/strawpolls/:strawpollID"
            component={
              locks.lockStrawpolls && !isStaff
                ? () => this.renderLockedFeature('Strawpolls')
                : Strawpoll
            }
          />
          <Footer />
        </ResponsiveNav>
      </React.Fragment>
    );
  }
}
