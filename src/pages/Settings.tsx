import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import { URLParameters } from '../types';
import { Button, Checkbox, Container, Header, Icon, Message, Segment } from 'semantic-ui-react';
import { checkboxHandler } from '../modules/handlers';
import { CommitteeData } from '../models/committee';
import { DEFAULT_SETTINGS, SettingsData } from '../models/settings';
import { Helmet } from 'react-helmet';
import { AdminRecord, isCommitteeStaff } from '../models/conference';

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  unsubscribeAuth?: () => void;
}

export default class Settings extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');

  constructor(props: Props) {
    super(props);

    const { match } = props;
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    this.state = {
      committeeFref: firebase.database().ref('committees').child(match.params.committeeID),
      user: initialUser,
      admins: {},
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      this.setState({ committee: committee.val() });
    }
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    this.state.committeeFref.on('value', this.firebaseCallback);
    this.adminsRef.on('value', this.onAdmins);
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
    this.state.committeeFref.off('value', this.firebaseCallback);
    this.adminsRef.off('value', this.onAdmins);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  renderSetting = (setting: keyof SettingsData, label: string) => {
    const { committee, committeeFref } = this.state;

    const settingsFref = committeeFref.child('settings');

    const value = committee ? committee.settings?.[setting] : DEFAULT_SETTINGS[setting];

    return (
      <Checkbox
        slider
        indeterminate={value === undefined}
        checked={value || false}
        onChange={checkboxHandler<SettingsData>(settingsFref, setting)}
        label={label}
      />
    );
  }

  render() {
    const { renderSetting } = this;
    const { committee, user, admins } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);

    if (committee && !isStaff) {
      return (
        <Container text style={{ padding: '2em 0em' }}>
          <Message warning icon>
            <Icon name="lock" />
            <Message.Content>
              <Message.Header>Dais / Staff Access Only</Message.Header>
              <p>Committee layout settings can only be changed by the Dais.</p>
              <Button
                primary
                onClick={() =>
                  this.props.history.push(`/committees/${this.props.match.params.committeeID}`)
                }
              >
                <Icon name="arrow left" /> Return to Committee Floor
              </Button>
            </Message.Content>
          </Message>
        </Container>
      );
    }

    return (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`Settings - WUMUN`}</title>
        </Helmet>
        <Header as="h3" attached="top">
          Settings
        </Header>
        <Segment attached="bottom" loading={!committee}>
          {renderSetting('moveQueueUp', "'Queue' should appear above 'Next speaking'")}
          {renderSetting(
            'timersInSeparateColumns',
            "Alternate arrangement with 'Speaker timer' and 'Caucus timer' in separate columns"
          )}
        </Segment>
      </Container>
    );
  }
}
