import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import { URLParameters } from '../types';
import { TextArea, Form, Container, Message, Icon } from 'semantic-ui-react';
import { textAreaHandler } from '../modules/handlers';
import Loading from '../components/Loading';
import { CommitteeData } from '../models/committee';
import { Helmet } from 'react-helmet';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import {
  DelegateSession,
  getDelegateSession,
  isReadOnlyForUser,
  subscribeDelegateSession,
} from '../modules/delegate-session';

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  session: DelegateSession | null;
  unsubscribeAuth?: () => void;
  unsubscribeSession?: () => void;
}

export default class Notes extends React.Component<Props, State> {
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
      session: getDelegateSession(match.params.committeeID),
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
    const { committeeID } = this.props.match.params;
    this.state.committeeFref.on('value', this.firebaseCallback);
    this.adminsRef.on('value', this.onAdmins);

    const unsubscribeSession = subscribeDelegateSession(committeeID, session =>
      this.setState({ session })
    );

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

  render() {
    const { committee, committeeFref, user, admins, session } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const readOnly = isReadOnlyForUser(isStaff, committee, session);

    return committee ? (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`Notes - WUMUN`}</title>
        </Helmet>
        {readOnly && (
          <Message size="small" info>
            <Icon name="eye" /> Viewing shared committee notes in read-only mode.
          </Message>
        )}
        <Form>
          <TextArea
            value={committee ? committee.notes : ''}
            onChange={readOnly ? undefined : textAreaHandler<CommitteeData>(committeeFref, 'notes')}
            readOnly={readOnly}
            autoHeight
            placeholder="Notes"
          />
        </Form>
      </Container>
    ) : (
      <Loading />
    );
  }
}
