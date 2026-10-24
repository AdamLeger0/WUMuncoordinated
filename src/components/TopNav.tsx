import * as React from 'react';
import firebase from 'firebase/compat/app';
import { Button, Container, Icon, Menu } from 'semantic-ui-react';
import GlobalBanner from './GlobalBanner';
import {
  AdminRecord,
  ApprovedUserRecord,
  isApprovedUser,
  isConferenceAdmin,
} from '../models/conference';
import { CommitteeData, CommitteeID } from '../models/committee';
import { appHistory } from '../index';

interface Props {
  activeTab: 'home' | 'committees' | 'onboard' | 'admin';
  fixed?: boolean;
  hideBanner?: boolean;
}

interface State {
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
  committees: Record<CommitteeID, CommitteeData>;
  unsubscribe?: () => void;
}

export default class TopNav extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');
  private approvedRef = firebase.database().ref('conference/approvedUsers');
  private committeesRef = firebase.database().ref('committees');

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
      const unsubscribe = firebase.auth().onAuthStateChanged(
        user => this.setState({ user }),
        () => this.setState({ user: null })
      );
      this.setState({ unsubscribe });
    } catch (e) {
      this.setState({ user: null });
    }
  }

  componentWillUnmount() {
    this.adminsRef.off('value', this.onAdmins);
    this.approvedRef.off('value', this.onApproved);
    this.committeesRef.off('value', this.onCommittees);
    if (this.state.unsubscribe) {
      this.state.unsubscribe();
    }
  }

  go = (path: string) => (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    appHistory.push(path);
  };

  handleLogout = () => {
    firebase
      .auth()
      .signOut()
      .then(() => {
        this.setState({ user: null });
      });
  };

  render() {
    const { activeTab, fixed, hideBanner } = this.props;
    const { user, admins, approvedUsers, committees } = this.state;

    const isAdmin = isConferenceAdmin(user, admins);
    const isApproved = isApprovedUser(user, admins, approvedUsers, committees);

    return (
      <>
        <Menu
          fixed={fixed ? 'top' : undefined}
          inverted
          size="large"
          style={{
            backgroundColor: 'var(--wumun-navy)',
            borderBottom: '1px solid rgba(239, 239, 240, 0.22)',
            margin: 0,
            borderRadius: 0,
          }}
        >
          <Container>
            <Menu.Item
              as="a"
              href="/"
              active={activeTab === 'home'}
              onClick={this.go('/')}
            >
              <Icon name="globe" /> Home
            </Menu.Item>
            <Menu.Item
              as="a"
              href="/committees"
              active={activeTab === 'committees'}
              onClick={this.go('/committees')}
            >
              <Icon name="users" /> Committees
            </Menu.Item>
            {isApproved && (
              <Menu.Item
                as="a"
                href="/onboard"
                active={activeTab === 'onboard'}
                onClick={this.go('/onboard')}
              >
                <Icon name="plus circle" /> Create Committee
              </Menu.Item>
            )}
            {isAdmin && (
              <Menu.Item
                as="a"
                href="/admin"
                active={activeTab === 'admin'}
                onClick={this.go('/admin')}
              >
                <Icon name="shield alternate" /> Conference Admin
              </Menu.Item>
            )}
            <Menu.Item position="right">
              {user ? (
                <>
                  <Button
                    as="a"
                    href="/onboard"
                    inverted
                    size="small"
                    onClick={this.go('/onboard')}
                  >
                    <Icon name="user" /> {user.email}
                  </Button>
                  <Button
                    inverted
                    size="small"
                    onClick={this.handleLogout}
                    style={{ marginLeft: '0.5em' }}
                  >
                    <Icon name="sign out" /> Logout
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    as="a"
                    href="/onboard"
                    inverted
                    size="small"
                    onClick={this.go('/onboard')}
                  >
                    Log in
                  </Button>
                  <Button
                    as="a"
                    href="/onboard"
                    primary
                    size="small"
                    onClick={this.go('/onboard')}
                    style={{
                      marginLeft: '0.5em',
                      backgroundColor: 'var(--wumun-blue)',
                      color: 'var(--wumun-text-light)',
                      fontWeight: 700,
                    }}
                  >
                    Sign up
                  </Button>
                </>
              )}
            </Menu.Item>
          </Container>
        </Menu>
        {!hideBanner && <GlobalBanner />}
      </>
    );
  }
}
