import * as React from 'react';
import firebase from 'firebase/compat/app';
import { Card, Button, Form, Message, Modal, Icon, List, Segment, Header, Label } from 'semantic-ui-react';
import _ from 'lodash';
import { logCreateAccount, logLogin } from '../modules/analytics';
import { CommitteeData, CommitteeID } from '../models/committee';
import {
  AdminRecord,
  ApprovedUserRecord,
  isApprovedUser,
  isCommitteeStaff,
  isConferenceAdmin,
  syncUserProfile,
} from '../models/conference';
import { appHistory } from '../index';

enum Mode {
  Login = 'Login',
  CreateAccount = 'CreateAccount',
  ForgotPassword = 'ForgotPassword'
}

interface State {
  user: firebase.User | null;
  email: string;
  password: string;
  error?: Error;
  success?: { name?: string; message?: string };
  loggingIn: boolean;
  creating: boolean;
  mode: Mode;
  resetting: boolean;
  unsubscribe?: () => void;
  committees: Record<CommitteeID, CommitteeData>;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
}

interface Props {
  allowNewCommittee?: boolean;
}

export class Login extends React.Component<Props, State> {
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
      email: '',
      password: '',
      mode: Mode.Login,
      loggingIn: false,
      creating: false,
      resetting: false,
      committees: {},
      admins: {},
      approvedUsers: {},
    };
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  onApproved = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ approvedUsers: (snap && snap.val()) || {} });
  };

  onCommittees = (snap: firebase.database.DataSnapshot | null) => {
    const raw: Record<CommitteeID, CommitteeData> = (snap && snap.val()) || {};
    const committees: Record<CommitteeID, CommitteeData> = {};
    Object.entries(raw).forEach(([k, v]) => {
      if (k !== '__wumun_hub__' && v && typeof v === 'object') {
        committees[k] = v as CommitteeData;
      }
    });
    this.setState({ committees });
  };

  authStateChangedCallback = (user: firebase.User | null) => {
    this.setState({ loggingIn: false, creating: false, user: user });

    if (user) {
      syncUserProfile(user);
    }
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
        this.authStateChangedCallback,
        err => {
          this.setState({
            user: null,
            loggingIn: false,
            creating: false,
            error: err as Error,
          });
        }
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

  logout = () => {
    this.setState({ error: undefined, success: undefined });
    firebase
      .auth()
      .signOut()
      .then(() => {
        this.setState({ user: null, loggingIn: false, creating: false });
      })
      .catch(err => {
        this.setState({ error: err });
      });
  };

  login = () => {
    const { email, password } = this.state;

    this.setState({ loggingIn: true, error: undefined });

    firebase
      .auth()
      .signInWithEmailAndPassword(email, password)
      .then(credential => {
        if (credential.user) {
          syncUserProfile(credential.user);
        }
        this.setState({
          user: credential.user,
          loggingIn: false,
          email: '',
          password: '',
        });
        logLogin(credential.user?.uid);
      })
      .catch(err => {
        this.setState({ loggingIn: false, error: err });
      });
  };

  createAccount = () => {
    const { email, password } = this.state;
    this.setState({ creating: true, error: undefined });

    firebase
      .auth()
      .createUserWithEmailAndPassword(email, password)
      .then(credential => {
        if (credential.user) {
          syncUserProfile(credential.user);
        }

        const success = {
          name: 'Account created',
          message: 'Your account was successfully created',
        };

        this.setState({
          user: credential.user,
          creating: false,
          email: '',
          password: '',
          success,
        });
        logCreateAccount(credential.user?.uid);
      })
      .catch(err => {
        this.setState({ creating: false, error: err });
      });
  };

  resetPassword = () => {
    const { email } = this.state;
    this.setState({ resetting: true, error: undefined });

    firebase
      .auth()
      .sendPasswordResetEmail(email)
      .then(() => {
        const success = {
          name: 'Password reset',
          message: `Check your inbox at ${email} for further instructions`,
        };

        this.setState({ resetting: false, success });
      })
      .catch(err => {
        this.setState({ resetting: false, error: err });
      });
  };

  dismissError = () => {
    this.setState({ error: undefined });
  };

  dismissSuccess = () => {
    this.setState({ success: undefined });
  };

  toLoginMode = () => {
    this.setState({
      password: '',
      mode: Mode.Login,
    });
  };

  toCreateAccountMode = () => {
    this.setState({
      mode: Mode.CreateAccount,
    });
  };

  toForgotPasswordMode = () => {
    this.setState({
      password: '',
      mode: Mode.ForgotPassword,
    });
  };

  setEmail = (e: React.FormEvent<HTMLInputElement>) => {
    this.setState({ email: e.currentTarget.value });
  };

  setPassword = (e: React.FormEvent<HTMLInputElement>) => {
    this.setState({ password: e.currentTarget.value });
  };

  renderCommittee = (committeeID: CommitteeID, committee: CommitteeData) => {
    return (
      <List.Item key={committeeID}>
        <List.Content floated="right">
          <Button
            as="a"
            href={`/committees/${committeeID}/mod`}
            size="mini"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              appHistory.push(`/committees/${committeeID}/mod`);
            }}
            style={{
              backgroundColor: 'var(--wumun-navy)',
              color: 'var(--wumun-text-light)',
            }}
          >
            <Icon name="sliders horizontal" /> Mod
          </Button>
          <Button
            as="a"
            href={`/committees/${committeeID}`}
            size="mini"
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              appHistory.push(`/committees/${committeeID}`);
            }}
            style={{
              backgroundColor: 'var(--wumun-blue)',
              color: 'var(--wumun-text-light)',
            }}
          >
            Open
          </Button>
        </List.Content>
        <List.Content>
          <List.Header
            as="a"
            href={`/committees/${committeeID}`}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              appHistory.push(`/committees/${committeeID}`);
            }}
          >
            {committee.name || 'Untitled Committee'}
          </List.Header>
          <List.Description>{committee.topic || 'No topic specified'}</List.Description>
        </List.Content>
      </List.Item>
    );
  };

  renderNewCommitteeButton = () => {
    return (
      <List.Item key={'add'}>
        <List.Content>
          <List.Header
            as="a"
            href={'/onboard'}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault();
              appHistory.push('/onboard');
            }}
          >
            <Icon name="plus" />
            Create new committee
          </List.Header>
        </List.Content>
      </List.Item>
    );
  };

  renderCommittees = (u: firebase.User) => {
    const { renderCommittee } = this;
    const { committees, admins } = this.state;
    const isAdmin = isConferenceAdmin(u, admins);

    const visibleEntries = Object.entries(committees || {}).filter(
      ([k, c]) =>
        k !== '__wumun_hub__' &&
        c &&
        (isAdmin || isCommitteeStaff(u, c, admins))
    );

    return visibleEntries.length > 0 ? (
      <>
        <Header as="h4" style={{ marginBottom: '0.5em' }}>
          {isAdmin
            ? `All Conference Committees (${visibleEntries.length})`
            : `Your Assigned Committees (${visibleEntries.length})`}
        </Header>
        <List divided relaxed>
          {visibleEntries.map(([k, c]) => renderCommittee(k, c))}
        </List>
      </>
    ) : (
      <Header as="h4">
        No committees created yet
        <Header.Subheader>
          Use the form to create a new committee and it will appear here.
        </Header.Subheader>
      </Header>
    );
  };

  renderError = () => {
    const { dismissError } = this;
    const err = this.state.error;
    if (!err) return null;

    return (
      <Message key="error" error onDismiss={dismissError}>
        <Message.Header>{err.name || 'Error'}</Message.Header>
        <Message.Content>{err.message || ''}</Message.Content>
      </Message>
    );
  };

  renderSuccess = () => {
    const { dismissSuccess } = this;
    const succ = this.state.success;
    if (!succ) return null;

    return (
      <Message key="success" success onDismiss={dismissSuccess}>
        <Message.Header>{succ.name || 'Success'}</Message.Header>
        <Message.Content>{succ.message || ''}</Message.Content>
      </Message>
    );
  };

  renderLoggedIn = (u: firebase.User) => {
    const { logout, renderCommittees, renderNewCommitteeButton } = this;
    const { admins, approvedUsers, committees } = this.state;
    const { allowNewCommittee } = this.props;

    const isAdmin = isConferenceAdmin(u, admins);
    const isApproved = isApprovedUser(u, admins, approvedUsers, committees);

    return (
      <Card centered fluid>
        <Card.Content key="main">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4em' }}>
            <div>
              <Card.Header>{u.email}</Card.Header>
              <Card.Meta>Logged in</Card.Meta>
            </div>
            <div>
              {isAdmin ? (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-navy)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="shield alternate" /> Conference Admin
                </Label>
              ) : isApproved ? (
                <Label
                  size="small"
                  style={{
                    backgroundColor: 'var(--wumun-teal)',
                    color: 'var(--wumun-text-light)',
                  }}
                >
                  <Icon name="check circle" /> Approved Chair / Staff
                </Label>
              ) : (
                <Label size="small">Delegate / Viewer</Label>
              )}
            </div>
          </div>
        </Card.Content>

        {isApproved ? (
          <Card.Content
            key="committees"
            style={{
              maxHeight: '50vh',
              overflow: 'auto',
            }}
          >
            {renderCommittees(u)}
          </Card.Content>
        ) : (
          <Card.Content key="viewer-info">
            <p style={{ marginBottom: '0.75em' }}>
              You are signed in with a standard account. You can view and participate in
              active committees from the Committees tab.
            </p>
            <Button
              as="a"
              href="/committees"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                appHistory.push('/committees');
              }}
              primary
              fluid
              style={{
                backgroundColor: 'var(--wumun-blue)',
                color: 'var(--wumun-text-light)',
                fontWeight: 700,
              }}
            >
              <Icon name="users" /> Browse Active Committees
            </Button>
          </Card.Content>
        )}

        {allowNewCommittee && isApproved && (
          <Card.Content key="create">{renderNewCommitteeButton()}</Card.Content>
        )}

        {isAdmin && (
          <Card.Content extra key="admin-link">
            <Button
              as="a"
              href="/admin"
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                appHistory.push('/admin');
              }}
              fluid
              style={{
                backgroundColor: 'var(--wumun-navy)',
                color: 'var(--wumun-text-light)',
              }}
            >
              <Icon name="shield alternate" /> Open Conference Admin Panel
            </Button>
          </Card.Content>
        )}

        <Card.Content extra key="extra">
          <Button basic color="red" fluid type="button" onClick={logout}>
            <Icon name="sign out" /> Logout
          </Button>
        </Card.Content>
      </Card>
    );
  };

  renderLogin = () => {
    const { loggingIn, creating, resetting, email, password, mode } = this.state;

    const renderLogInButton = () => (
      <Button
        primary
        disabled={!email || !password}
        onClick={this.login}
        loading={loggingIn}
        type="submit"
        style={{
          backgroundColor: 'var(--wumun-blue)',
          color: 'var(--wumun-text-light)',
          fontWeight: 700,
        }}
      >
        Log in
      </Button>
    );

    const renderCreateAccountButton = () => (
      <Button
        positive
        type="button"
        onClick={this.toCreateAccountMode}
        style={{
          backgroundColor: 'var(--wumun-green)',
          color: 'var(--wumun-text-light)',
          fontWeight: 700,
        }}
      >
        Create account <Icon name="arrow right" />
      </Button>
    );

    const renderSubmitCreateAccountButton = () => (
      <Button
        positive
        fluid
        onClick={this.createAccount}
        loading={creating}
        disabled={!email || !password}
        type="submit"
        style={{
          backgroundColor: 'var(--wumun-green)',
          color: 'var(--wumun-text-light)',
          fontWeight: 700,
        }}
      >
        Create account
      </Button>
    );

    const renderForgotPasswordButton = () => (
      // eslint-disable-next-line jsx-a11y/anchor-is-valid
      <a onClick={this.toForgotPasswordMode} style={{ cursor: 'pointer' }}>
        Forgot password?
      </a>
    );

    const renderToLoginButton = () => (
      <div style={{ marginBottom: '8px' }}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a
          onClick={this.toLoginMode}
          style={{
            cursor: 'pointer',
          }}
        >
          <Icon name="arrow left" />
          Back to login
        </a>
      </div>
    );

    const renderSendResetEmailButton = () => (
      <Button
        primary
        fluid
        onClick={this.resetPassword}
        loading={resetting}
        disabled={!email}
        type="submit"
        style={{
          backgroundColor: 'var(--wumun-blue)',
          color: 'var(--wumun-text-light)',
          fontWeight: 700,
        }}
      >
        Send reset email
      </Button>
    );

    const err = this.state.error;
    const succ = this.state.success;

    return (
      <React.Fragment>
        {mode === Mode.Login && (
          <Header as="h3" attached="top">
            Login
            <Header.Subheader>
              Sign in to access your WUMUN account.
            </Header.Subheader>
          </Header>
        )}
        {mode === Mode.CreateAccount && (
          <Header as="h3" attached="top">
            Create account
            <Header.Subheader>
              Multiple directors may use the same account simultaneously. Choose a
              password you're willing to share.
            </Header.Subheader>
          </Header>
        )}
        {mode === Mode.ForgotPassword && (
          <Header as="h3" attached="top">
            Reset password
          </Header>
        )}
        <Segment attached="bottom">
          {mode !== Mode.Login && renderToLoginButton()}
          <Form error={!!err} success={!!succ} loading={loggingIn || creating || resetting}>
            <Form.Input
              key="email"
              label="Email"
              error={mode === Mode.CreateAccount && !email}
              required={mode === Mode.CreateAccount}
              placeholder="joe@schmoe.com"
              value={email}
              onChange={this.setEmail}
            >
              <input autoComplete="email" />
            </Form.Input>
            {mode === Mode.Login && (
              <Form.Input
                key="current-password"
                label="Password"
                type="password"
                placeholder="correct horse battery staple"
                value={password}
                onChange={this.setPassword}
              >
                <input autoComplete="current-password" />
              </Form.Input>
            )}
            {mode === Mode.CreateAccount && (
              <Form.Input
                key="new-password"
                label="Password"
                type="password"
                error={!password}
                required
                placeholder="correct horse battery staple"
                value={password}
                onChange={this.setPassword}
              >
                <input autoComplete="new-password" />
              </Form.Input>
            )}
            {this.renderSuccess()}
            {this.renderError()}
            {mode === Mode.Login && (
              <Button.Group fluid widths="2">
                {renderLogInButton()}
                <Button.Or />
                {renderCreateAccountButton()}
              </Button.Group>
            )}
            {mode === Mode.ForgotPassword && renderSendResetEmailButton()}
            {mode === Mode.CreateAccount && renderSubmitCreateAccountButton()}
            {mode === Mode.Login && renderForgotPasswordButton()}
          </Form>
        </Segment>
      </React.Fragment>
    );
  };

  render() {
    const { user } = this.state;

    return user ? this.renderLoggedIn(user) : this.renderLogin();
  }
}

export class LoginModal extends React.Component<
  {},
  {
    user: firebase.User | null;
    unsubscribe?: () => void;
  }
> {
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
    };
  }

  renderModalTrigger() {
    const { user } = this.state;

    const text = user ? user.email : 'Login';

    return (
      <Button className="nav__auth-status">
        <Icon name="lock" />
        {text}
      </Button>
    );
  }

  authStateChangedCallback = (user: firebase.User | null) => {
    this.setState({ user: user });
  };

  componentDidMount() {
    try {
      const unsubscribe = firebase.auth().onAuthStateChanged(
        this.authStateChangedCallback,
        () => this.setState({ user: null })
      );

      this.setState({ unsubscribe });
    } catch (e) {
      this.setState({ user: null });
    }
  }

  componentWillUnmount() {
    if (this.state.unsubscribe) {
      this.state.unsubscribe();
    }
  }

  render() {
    return (
      <Modal
        trigger={this.renderModalTrigger()}
        size="tiny"
        dimmer
        basic={true}
      >
        <Modal.Content>
          <Login allowNewCommittee={true} />
        </Modal.Content>
      </Modal>
    );
  }
}
