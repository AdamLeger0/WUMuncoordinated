import * as React from 'react';
import { RouteComponentProps } from 'react-router';
import firebase from 'firebase/compat/app';
import {
  Form,
  Grid,
  Header,
  InputOnChangeData,
  DropdownProps,
  Message,
  Popup,
  Container,
  Segment,
  Icon,
} from 'semantic-ui-react';
import { Login } from '../components/auth';
import { URLParameters } from '../types';
import { makeDropdownOption, meetId } from '../utils';
import ConnectionStatus from '../components/ConnectionStatus';
import { logCreateCommittee } from '../modules/analytics';
import {
  CommitteeData,
  CommitteeID,
  DEFAULT_COMMITTEE,
  pushTemplateMembers,
  putCommittee,
  Template,
} from '../models/committee';
import { TemplatePreview } from '../components/template';
import { Helmet } from 'react-helmet';
import TopNav from '../components/TopNav';
import {
  AdminRecord,
  ApprovedUserRecord,
  DEFAULT_CONFERENCE_SETTINGS,
  isApprovedUser,
} from '../models/conference';

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  name: string;
  topic: string;
  chair: string;
  conference: string;
  user: firebase.User | null;
  template?: Template;
  committeesFref: firebase.database.Reference;
  admins: Record<string, AdminRecord | boolean>;
  approvedUsers: Record<string, ApprovedUserRecord | boolean>;
  committees: Record<CommitteeID, CommitteeData>;
  unsubscribe?: () => void;
}

export default class Onboard extends React.Component<Props, State> {
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
      name: '',
      topic: '',
      chair: '',
      conference: DEFAULT_CONFERENCE_SETTINGS.conferenceName,
      user: initialUser,
      committeesFref: firebase.database().ref('committees'),
      admins: {},
      approvedUsers: {},
      committees: {},
    };
  }

  authStateChangedCallback = (user: firebase.User | null) => {
    this.setState({ user: user });
  };

  onConferenceSettings = (snap: firebase.database.DataSnapshot | null) => {
    const val = snap && snap.val();
    if (val && val.conferenceName && !this.state.conference) {
      this.setState({ conference: val.conferenceName });
    }
  };

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
    this.settingsRef = firebase.database().ref('conference/settings');
    this.adminsRef = firebase.database().ref('conference/admins');
    this.approvedRef = firebase.database().ref('conference/approvedUsers');
    const committeesFref = firebase.database().ref('committees');
    this.setState({ committeesFref });
    try {
      const unsubscribe = firebase.auth().onAuthStateChanged(
        this.authStateChangedCallback,
        () => this.setState({ user: null })
      );

      this.setState({ unsubscribe });
    } catch (e) {
      this.setState({ user: null });
    }
    this.settingsRef.on('value', this.onConferenceSettings);
    this.adminsRef.on('value', this.onAdmins);
    this.approvedRef.on('value', this.onApproved);
    committeesFref.on('value', this.onCommittees);
  }

  componentWillUnmount() {
    if (this.state.unsubscribe) {
      this.state.unsubscribe();
    }
    this.settingsRef.off('value', this.onConferenceSettings);
    this.adminsRef.off('value', this.onAdmins);
    this.approvedRef.off('value', this.onApproved);
    this.state.committeesFref.off('value', this.onCommittees);
  }

  handleInput = (
    event: React.SyntheticEvent<HTMLInputElement>,
    data: InputOnChangeData
  ): void => {
    // @ts-ignore
    this.setState({ [data.name]: data.value });
  };

  onChangeTemplateDropdown = (
    event: React.SyntheticEvent<HTMLElement, Event>,
    data: DropdownProps
  ): void => {
    this.setState(old => ({
      template: data.value as Template,
      name: (data.value as string) || old.name,
    }));
  };

  handleSubmit = () => {
    const {
      name,
      topic,
      chair,
      conference,
      template,
      user,
      admins,
      approvedUsers,
      committees,
    } = this.state;

    if (user && isApprovedUser(user, admins, approvedUsers, committees)) {
      const newCommittee: CommitteeData = {
        ...DEFAULT_COMMITTEE,
        name,
        topic,
        chair,
        conference: conference || DEFAULT_CONFERENCE_SETTINGS.conferenceName,
        creatorUid: user.uid,
        creatorEmail: user.email || undefined,
      };

      if (template) {
        newCommittee.template = template;
      }

      const newCommitteeRef = putCommittee(meetId(), newCommittee);
      this.props.history.push(`/committees/${newCommitteeRef.key}`);
      logCreateCommittee(newCommitteeRef.key ?? undefined);

      if (template) {
        pushTemplateMembers(newCommitteeRef.key!, template);
      }
    }
  };

  renderNewCommitteeForm = () => {
    const { user, template } = this.state;

    return (
      <React.Fragment>
        <Header as="h3" attached="top">
          Create a New Committee
        </Header>
        <Segment attached="bottom">
          <Form onSubmit={this.handleSubmit}>
            <Form.Group unstackable>
              <Form.Dropdown
                label="Template"
                name="template"
                width={14}
                search
                clearable
                selection
                placeholder="Template to skip manual member creation (optional)"
                options={Object.values(Template).map(makeDropdownOption)}
                onChange={this.onChangeTemplateDropdown}
              />
              <Popup
                basic
                pinned
                hoverable
                position="bottom left"
                trigger={
                  <Form.Button
                    type="button"
                    icon="question circle outline"
                    width={1}
                  />
                }
              >
                <Popup.Content>
                  <TemplatePreview template={template} />
                </Popup.Content>
              </Popup>
            </Form.Group>
            <Form.Input
              label="Name"
              name="name"
              fluid
              value={this.state.name}
              required
              error={!this.state.name}
              placeholder="Committee name"
              onChange={this.handleInput}
            />
            <Form.Input
              label="Topic"
              name="topic"
              value={this.state.topic}
              fluid
              placeholder="Committee topic"
              onChange={this.handleInput}
            />
            <Form.Input
              label="Chair / Committee Head"
              name="chair"
              value={this.state.chair}
              fluid
              placeholder="Chair name (optional)"
              onChange={this.handleInput}
            />
            <Form.Input
              label="Conference"
              name="conference"
              value={this.state.conference}
              fluid
              placeholder="Conference name"
              onChange={this.handleInput}
            />
            <Form.Button
              primary
              fluid
              disabled={!user || this.state.name === ''}
              style={{
                backgroundColor: 'var(--wumun-blue)',
                color: 'var(--wumun-text-light)',
                fontWeight: 700,
              }}
            >
              Create committee
              <Icon name="arrow right" />
            </Form.Button>
          </Form>
        </Segment>
      </React.Fragment>
    );
  };

  render() {
    const { user, admins, approvedUsers, committees } = this.state;
    const isApproved = isApprovedUser(user, admins, approvedUsers, committees);

    return (
      <>
        <TopNav activeTab="onboard" />
        <Container style={{ padding: '1.5em 0em' }}>
          <Helmet>
            <title>{`Account & Login - Winthrop University Model UN`}</title>
            <meta
              name="description"
              content="Login or access your Winthrop University Model UN account."
            />
          </Helmet>
          <ConnectionStatus />
          <Grid columns="equal" stackable centered>
            <Grid.Row>
              <Grid.Column width={isApproved ? 16 : 10}>
                <Header as="h1" textAlign="center">
                  Winthrop University Model UN
                </Header>
                <Message>
                  <Message.Header>Browser compatibility notice</Message.Header>
                  <p>
                    Winthrop University Model UN works best with newer versions of{' '}
                    <a href="https://www.google.com/chrome/">Google Chrome</a>.
                    Use of other/older browsers has caused bugs and data loss.
                  </p>
                </Message>
              </Grid.Column>
            </Grid.Row>
            <Grid.Row>
              <Grid.Column width={isApproved ? 8 : 10}>
                <Login allowNewCommittee={false} />
              </Grid.Column>
              {isApproved && (
                <Grid.Column width={8}>
                  {this.renderNewCommitteeForm()}
                </Grid.Column>
              )}
            </Grid.Row>
          </Grid>
        </Container>
      </>
    );
  }
}
