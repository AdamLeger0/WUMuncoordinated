import * as React from 'react';
import firebase from 'firebase/compat/app';
import { Container } from 'semantic-ui-react';
import { RouteComponentProps } from 'react-router';
import Timer from '../components/Timer';
import { URLParameters } from '../types';
import { TimerData, Unit } from '../models/time';
import { Helmet } from 'react-helmet';
import { CommitteeData } from '../models/committee';
import { AdminRecord, isCommitteeStaff } from '../models/conference';

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  timer?: TimerData;
  committee?: CommitteeData;
  timerFref: firebase.database.Reference;
  committeeRef: firebase.database.Reference;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  unsubscribeAuth?: () => void;
}

export default class Unmod extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');

  constructor(props: Props) {
    super(props);

    const { match } = props;
    const committeeRef = firebase.database().ref('committees').child(match.params.committeeID);
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    this.state = {
      committeeRef,
      timerFref: committeeRef.child('timer'),
      user: initialUser,
      admins: {},
    };
  }

  onCommittee = (snap: firebase.database.DataSnapshot | null) => {
    if (snap) {
      this.setState({ committee: snap.val() || undefined });
    }
  };

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  componentDidMount() {
    this.state.committeeRef.on('value', this.onCommittee);
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
    this.state.committeeRef.off('value', this.onCommittee);
    this.adminsRef.off('value', this.onAdmins);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  render() {
    const { timerFref, committee, user, admins } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);

    return (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`Unmoderated Caucus - WUMUN`}</title>
        </Helmet>
        <Timer
          name="Unmoderated caucus"
          timerFref={timerFref}
          onChange={(x: TimerData) => x}
          defaultDuration={10}
          defaultUnit={Unit.Minutes}
          readOnly={!isStaff}
        />
      </Container>
    );
  }
}
