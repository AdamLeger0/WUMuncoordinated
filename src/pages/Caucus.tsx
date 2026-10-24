import * as React from 'react';
import {
  Button,
  Container,
  Dropdown,
  DropdownProps,
  Feed,
  FeedEvent,
  Flag,
  Form,
  Grid,
  Header,
  Icon,
  Input,
  Label,
  Message,
  Popup,
  Segment,
  TextArea
} from 'semantic-ui-react';
import Timer, { toggleTicking } from '../components/Timer';
import { RouteComponentProps } from 'react-router';
import {
  checkboxHandler,
  dropdownHandler,
  fieldHandler,
  textAreaHandler,
  validatedNumberFieldHandler
} from '../modules/handlers';
import { URLParameters } from '../types';
import { NotFound } from '../components/NotFound';
import {
  CAUCUS_STATUS_OPTIONS,
  CaucusData,
  CaucusID,
  CaucusStatus,
  DEFAULT_CAUCUS,
  Lifecycle,
  recoverDuration,
  recoverUnit,
  runLifecycle,
  SpeakerEvent,
  Stance
} from '../models/caucus';
import {
  CommitteeData,
  recoverCaucus,
  recoverFeatureLocks,
  recoverMembers,
  recoverSettings
} from '../models/committee';
import { TimerData, Unit } from '../models/time';
import _ from 'lodash';
import { useObjectVal } from 'react-firebase-hooks/database';
import {
  MemberData,
  MemberOption,
  membersToPresentOptions,
  nameToFlagCode
} from '../modules/member';
import { TimeSetter } from '../components/TimeSetter';
import firebase from 'firebase/compat/app';
import {
  DragDropContext,
  Draggable,
  DraggableProvided,
  Droppable,
  DropResult
} from 'react-beautiful-dnd';
import { Helmet } from 'react-helmet';
import { getDatabase, ref } from 'firebase/database';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import {
  DelegateSession,
  getDelegateSession,
  isReadOnlyForUser,
  subscribeDelegateSession,
  validateDelegateSession
} from '../modules/delegate-session';

interface Props extends RouteComponentProps<URLParameters> {}

interface State {
  speakerTimer: TimerData;
  caucusTimer: TimerData;
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  loading: boolean;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  session: DelegateSession | null;
  unsubscribeAuth?: () => void;
  unsubscribeSession?: () => void;
}

export function NextSpeaking(props: {
  caucus?: CaucusData;
  speakerTimer: TimerData;
  fref: firebase.database.Reference;
  autoNextSpeaker: boolean;
  isStaff: boolean;
  readOnly: boolean;
  session: DelegateSession | null;
}) {
  const { isStaff, readOnly, session } = props;

  const handleKeyDown = (ev: KeyboardEvent) => {
    if (!isStaff) return;
    if (ev.keyCode === 78 && ev.altKey) {
      nextSpeaker();
    }
  };

  const interlace = () => {
    if (!props.caucus || !isStaff) {
      return;
    }

    const q = props.caucus.queue || {};

    const vs: SpeakerEvent[] = _.values(q);

    const fors = vs.filter(se => se.stance === Stance.For);
    const againsts = vs.filter(se => se.stance === Stance.Against);
    const neutrals = vs.filter(se => se.stance === Stance.Neutral);

    const interlaced = _.flatten(_.zip(fors, againsts, neutrals));

    props.fref.child('queue').set({});

    interlaced.forEach((se: SpeakerEvent | undefined) => {
      if (se) {
        props.fref.child('queue').push().set(se);
      }
    });
  };

  const nextSpeaker = () => {
    if (!props.caucus || !isStaff) {
      return;
    }

    const q = props.caucus.queue || {};

    const queueHeadKey = Object.keys(q)[0];

    let queueHeadDetails = {};

    if (queueHeadKey) {
      queueHeadDetails = {
        queueHeadData: q[queueHeadKey],
        queueHead: props.fref.child('queue').child(queueHeadKey)
      };
    }

    const duration = recoverDuration(props.caucus);

    const speakerSeconds: number = duration
      ? duration * (recoverUnit(props.caucus) === Unit.Minutes ? 60 : 1)
      : 60;

    const lifecycle: Lifecycle = {
      history: props.fref.child('history'),
      speakingData: props.caucus.speaking,
      speaking: props.fref.child('speaking'),
      timerData: props.speakerTimer,
      timer: props.fref.child('speakerTimer'),
      yielding: false,
      timerResetSeconds: speakerSeconds
    };

    runLifecycle({ ...lifecycle, ...queueHeadDetails });
  };

  const db = getDatabase();
  const [skew] = useObjectVal<number>(ref(db, '.info/serverTimeOffset'));

  const startTimer = () => {
    if (!isStaff) return;
    toggleTicking({
      timerFref: props.fref.child('speakerTimer'),
      timer: props.speakerTimer,
      skew
    });
  };

  const { caucus } = props;
  const { ticking } = props.speakerTimer;

  const queue = caucus ? caucus.queue : {};
  const hasNowSpeaking = caucus ? !!caucus.speaking : false;
  const queueLength = _.values(queue).length;
  const hasNextSpeaking = queueLength > 0;
  const interlaceable = queueLength > 1;
  const nextable = hasNowSpeaking || hasNextSpeaking;

  const stageButton = (
    <Button basic icon primary disabled={!nextable} onClick={nextSpeaker}>
      <Icon name="arrow up" />
      Stage
    </Button>
  );

  const startButton = (
    <Button basic icon positive disabled={!nextable} onClick={startTimer}>
      <Icon name="hourglass start" />
      Start
    </Button>
  );

  const nextButton = (
    <Button basic icon primary disabled={!nextable} onClick={nextSpeaker}>
      <Icon name="arrow up" />
      Next
    </Button>
  );

  const stopButton = (
    <Button basic icon negative disabled={!nextable} onClick={nextSpeaker}>
      <Icon name="hourglass end" />
      Stop
    </Button>
  );

  const interlaceButton = (
    <Button icon disabled={!interlaceable} basic color="purple" onClick={interlace}>
      <Icon name="random" />
      Order
    </Button>
  );

  let button = nextButton;

  if (!hasNowSpeaking) {
    button = stageButton;
  } else if (hasNowSpeaking && !ticking) {
    button = startButton;
  } else if (hasNowSpeaking && ticking && hasNextSpeaking) {
    button = nextButton;
  } else if (hasNowSpeaking && ticking && !hasNextSpeaking) {
    button = stopButton;
  }

  React.useEffect(() => {
    document.addEventListener<'keydown'>('keydown', handleKeyDown);

    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Segment textAlign="center" loading={!caucus}>
      <Label attached="top left" size="large">
        Next speaking ({queueLength})
      </Label>
      {isStaff && (
        <>
          {button}
          <Popup
            trigger={interlaceButton}
            content="Orders the list so that speakers are 'For', then 'Against', then 'Neutral', then 'For', etc."
          />
        </>
      )}
      <SpeakerFeed
        data={caucus ? caucus.queue : undefined}
        queueFref={props.fref.child('queue')}
        speaking={caucus ? caucus.speaking : undefined}
        speakerTimer={props.speakerTimer}
        isStaff={isStaff}
        readOnly={readOnly}
        session={session}
      />
    </Segment>
  );
}

function StanceIcon(props: { stance: Stance }) {
  switch (props.stance) {
    case Stance.For:
      return <Icon name="thumbs up outline" />;
    case Stance.Against:
      return <Icon name="thumbs down outline" />;
    default:
      return <Icon name="hand point right outline" />;
  }
}

class SpeakerFeedEntry extends React.PureComponent<{
  data?: SpeakerEvent;
  speaking?: SpeakerEvent;
  fref: firebase.database.Reference;
  speakerTimer: TimerData;
  draggableProvided?: DraggableProvided;
  isStaff: boolean;
  canRemoveSelf?: boolean;
}> {
  yieldHandler = () => {
    const { fref, data, speakerTimer, speaking, isStaff } = this.props;
    if (!isStaff) return;

    const queueHeadDetails = {
      queueHeadData: data,
      queueHead: fref
    };

    const caucusRef = (fref.parent as firebase.database.Reference)
      .parent as firebase.database.Reference;

    const lifecycle: Lifecycle = {
      history: caucusRef.child('history'),
      speaking: caucusRef.child('speaking'),
      speakingData: speaking,
      timerData: speakerTimer,
      timer: caucusRef.child('speakerTimer'),
      yielding: true,
      timerResetSeconds: 0
    };

    runLifecycle({ ...lifecycle, ...queueHeadDetails });
  };

  renderContent() {
    const { data, speaking, fref, isStaff, canRemoveSelf } = this.props;

    return (
      <Feed.Content>
        <Feed.Summary>
          <Feed.User>
            {data && <Flag name={nameToFlagCode(data.who)} />}
            {data ? data.who : ''}
          </Feed.User>
          <Feed.Date>{data ? data.duration.toString() + ' seconds' : ''}</Feed.Date>
        </Feed.Summary>
        <Feed.Meta>
          <Feed.Like>
            {data && <StanceIcon stance={data.stance} />}
            {data ? data.stance : ''}
          </Feed.Like>
          {data && (isStaff || canRemoveSelf) && (
            <Label size="mini" as="a" onClick={() => fref.remove()}>
              Remove
            </Label>
          )}
          {data && speaking && isStaff && (
            <Label size="mini" as="a" onClick={this.yieldHandler}>
              Yield
            </Label>
          )}
        </Feed.Meta>
      </Feed.Content>
    );
  }

  render() {
    const { draggableProvided, isStaff } = this.props;

    return draggableProvided ? (
      <div
        className="event"
        ref={draggableProvided.innerRef}
        {...draggableProvided.draggableProps}
      >
        {this.renderContent()}
        {isStaff && (
          <div {...draggableProvided.dragHandleProps} style={{ paddingLeft: '120px' }}>
            {' '}
            ⠿
          </div>
        )}
      </div>
    ) : (
      <FeedEvent>{this.renderContent()}</FeedEvent>
    );
  }
}

function SpeakerFeed(props: {
  data?: Record<string, SpeakerEvent>;
  queueFref: firebase.database.Reference;
  speaking?: SpeakerEvent;
  speakerTimer: TimerData;
  isStaff: boolean;
  readOnly: boolean;
  session: DelegateSession | null;
}) {
  const { data, queueFref, speaking, speakerTimer, isStaff, readOnly, session } = props;

  const events = data || {};

  const eventItems = Object.keys(events).map((key, index) => {
    const ev = events[key];
    const canRemoveSelf = Boolean(
      !readOnly &&
        session?.role === 'delegate' &&
        session.memberName &&
        ev &&
        ev.who === session.memberName
    );

    return (
      <Draggable key={key} draggableId={key} index={index} isDragDisabled={!isStaff}>
        {provided => (
          <SpeakerFeedEntry
            draggableProvided={provided}
            key={key}
            data={ev}
            fref={queueFref.child(key)}
            speaking={speaking}
            speakerTimer={speakerTimer}
            isStaff={isStaff}
            canRemoveSelf={canRemoveSelf}
          />
        )}
      </Draggable>
    );
  });

  const reorder = <T,>(list: T[], startIndex: number, endIndex: number) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);

    return result;
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !isStaff) {
      return;
    }

    const events = data || {};

    const reorderedKeys = reorder(
      Object.keys(events),
      result.source.index,
      result.destination.index
    );

    queueFref.set({});

    reorderedKeys.forEach(key => {
      const se = (data || {})[key];

      if (se) {
        queueFref.push().set(se);
      }
    });
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="droppable" isDropDisabled={!isStaff}>
        {provided => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <Feed size="large">
              {eventItems}
              {provided.placeholder}
            </Feed>
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

function Queuer(props: {
  caucus?: CaucusData;
  members?: Record<string, MemberData>;
  caucusFref: firebase.database.Reference;
  isStaff: boolean;
  readOnly: boolean;
  physicalMode: boolean;
  session: DelegateSession | null;
}) {
  const { members, caucus, caucusFref, isStaff, readOnly, physicalMode, session } = props;
  const [queueMember, setQueueMember] = React.useState<MemberOption | undefined>(undefined);
  const memberOptions = membersToPresentOptions(members);

  const duration = recoverDuration(caucus);

  // If non-staff, handle delegate / observer / physical mode restrictions
  if (!isStaff) {
    if (physicalMode) {
      return (
        <Segment textAlign="center">
          <Label attached="top left" size="large">
            Queue
          </Label>
          <Message size="small" info style={{ marginTop: '1em' }}>
            <Icon name="hand paper outline" />
            <strong>Physical Committee Mode:</strong> Pass a note in person to the Dais to be added
            to the speaking list.
          </Message>
        </Segment>
      );
    }

    if (readOnly || !session || session.role !== 'delegate' || !session.memberName) {
      return (
        <Segment textAlign="center">
          <Label attached="top left" size="large">
            Queue
          </Label>
          <Message size="small" style={{ marginTop: '1em' }}>
            <Icon name="eye" /> You are viewing as an Observer. Select a delegation in the top bar
            to join the speaking queue.
          </Message>
        </Segment>
      );
    }

    if (!caucus?.queueIsPublic) {
      return (
        <Segment textAlign="center">
          <Label attached="top left" size="large">
            Queue
          </Label>
          <Message size="small" warning style={{ marginTop: '1em' }}>
            <Icon name="lock" /> The speaking queue is currently closed to delegates by the Dais.
          </Message>
        </Segment>
      );
    }

    const delegateName = session.memberName;
    const isPresent = memberOptions.some(o => o.text === delegateName);
    const setDelegateStance = (stance: Stance) => () => {
      const dur = Number(recoverDuration(caucus)) || 60;
      const newEvent: SpeakerEvent = {
        who: delegateName,
        stance,
        duration: recoverUnit(caucus) === Unit.Minutes ? dur * 60 : dur
      };
      caucusFref.child('queue').push().set(newEvent);
    };

    return (
      <Segment textAlign="center">
        <Label attached="top left" size="large">
          Queue as Delegation
        </Label>
        <div style={{ margin: '1em 0 0.8em' }}>
          <Label size="large" style={{ backgroundColor: 'var(--wumun-navy)', color: 'var(--wumun-text-light)' }}>
            <Flag name={nameToFlagCode(delegateName)} />
            {delegateName}
          </Label>
          <div style={{ marginTop: '0.4em', fontSize: '0.9em', color: 'var(--wumun-brown)' }}>
            Speaking time: {duration || 60} {recoverUnit(caucus)}
          </div>
        </div>
        {!isPresent && (
          <Message size="tiny" warning>
            Your delegation is currently marked Absent in Roll Call. Ask the Dais to mark you
            Present.
          </Message>
        )}
        <Button.Group size="large" fluid>
          <Button
            content="For"
            disabled={!isPresent}
            onClick={setDelegateStance(Stance.For)}
          />
          <Button.Or />
          <Button
            content="Neutral"
            disabled={!isPresent}
            onClick={setDelegateStance(Stance.Neutral)}
          />
          <Button.Or />
          <Button
            content="Against"
            disabled={!isPresent}
            onClick={setDelegateStance(Stance.Against)}
          />
        </Button.Group>
      </Segment>
    );
  }

  const setStance = (stance: Stance) => () => {
    const dur = Number(recoverDuration(caucus));

    if (dur && queueMember) {
      const newEvent: SpeakerEvent = {
        who: queueMember.text,
        stance: stance,
        duration: recoverUnit(caucus) === Unit.Minutes ? dur * 60 : dur
      };

      props.caucusFref.child('queue').push().set(newEvent);
    }
  };

  const setMember = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps): void => {
    setQueueMember(memberOptions.filter(c => c.value === data.value)[0]);
  };

  const disableButtons = !queueMember || !duration;

  return (
    <Segment textAlign="center">
      <Label attached="top left" size="large">
        Queue
      </Label>
      <Form>
        <Form.Dropdown
          icon="search"
          value={queueMember ? queueMember.value : undefined}
          search
          selection
          loading={!caucus}
          error={!queueMember}
          onChange={setMember}
          options={memberOptions}
          placeholder="Select delegation to queue"
        />
        <TimeSetter
          loading={!caucus}
          unitValue={recoverUnit(caucus)}
          placeholder="Speaking time"
          durationValue={duration ? duration.toString() : undefined}
          onDurationChange={validatedNumberFieldHandler(caucusFref, 'speakerDuration')}
          onUnitChange={dropdownHandler(caucusFref, 'speakerUnit')}
        />
        <Form.Checkbox
          label="Delegates can queue"
          indeterminate={!caucus}
          toggle
          checked={caucus ? caucus.queueIsPublic : false}
          onChange={checkboxHandler<CaucusData>(caucusFref, 'queueIsPublic')}
        />
        <Button.Group size="large" fluid>
          <Button content="For" disabled={disableButtons} onClick={setStance(Stance.For)} />
          <Button.Or />
          <Button
            disabled={disableButtons}
            content="Neutral"
            onClick={setStance(Stance.Neutral)}
          />
          <Button.Or />
          <Button
            disabled={disableButtons}
            content="Against"
            onClick={setStance(Stance.Against)}
          />
        </Button.Group>
      </Form>
    </Segment>
  );
}

export default class Caucus extends React.Component<Props, State> {
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
      caucusTimer: DEFAULT_CAUCUS.caucusTimer,
      speakerTimer: DEFAULT_CAUCUS.speakerTimer,
      loading: true,
      user: initialUser,
      admins: {},
      session: getDelegateSession(match.params.committeeID)
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      this.setState({ committee: committee.val(), loading: false });
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

  recoverCaucusFref = () => {
    const caucusID: CaucusID = this.props.match.params.caucusID;

    return this.state.committeeFref.child('caucuses').child(caucusID);
  };

  renderHeader = (caucus?: CaucusData, isStaff?: boolean) => {
    const caucusFref = this.recoverCaucusFref();

    if (!isStaff) {
      return (
        <Segment>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5em'
            }}
          >
            <Header as="h1" style={{ margin: 0 }}>
              {caucus ? caucus.name : 'Caucus'}
            </Header>
            <Label
              size="large"
              style={{
                backgroundColor: 'var(--wumun-blue)',
                color: 'var(--wumun-text-light)'
              }}
            >
              {caucus ? caucus.status : CaucusStatus.Open}
            </Label>
          </div>
          {caucus?.topic && (
            <p style={{ marginTop: '0.6em', marginBottom: 0, fontSize: '1.05em' }}>
              {caucus.topic}
            </p>
          )}
        </Segment>
      );
    }

    const statusDropdown = (
      <Dropdown
        value={caucus ? caucus.status : CaucusStatus.Open}
        options={CAUCUS_STATUS_OPTIONS}
        onChange={dropdownHandler<CaucusData>(caucusFref, 'status')}
      />
    );

    return (
      <>
        <Input
          label={statusDropdown}
          labelPosition="right"
          value={caucus ? caucus.name : ''}
          onChange={fieldHandler<CaucusData>(caucusFref, 'name')}
          loading={!caucus}
          attatched="top"
          size="massive"
          fluid
          placeholder="Set caucus name"
        />
        <Form loading={!caucus}>
          <TextArea
            value={caucus ? caucus.topic : ''}
            autoHeight
            onChange={textAreaHandler<CaucusData>(caucusFref, 'topic')}
            attatched="top"
            rows={1}
            placeholder="Set caucus details"
          />
        </Form>
      </>
    );
  };

  renderNowSpeaking = (caucus?: CaucusData, isStaff?: boolean) => {
    const { speakerTimer } = this.state;

    const caucusFref = this.recoverCaucusFref();

    const entryData = caucus ? caucus.speaking : undefined;

    return (
      <Segment loading={!caucus}>
        <Label attached="top left" size="large">
          Now speaking
        </Label>
        <Feed size="large">
          <SpeakerFeedEntry
            data={entryData}
            fref={caucusFref.child('speaking')}
            speakerTimer={speakerTimer}
            isStaff={Boolean(isStaff)}
          />
        </Feed>
      </Segment>
    );
  };

  setSpeakerTimer = (timer: TimerData) => {
    this.setState({ speakerTimer: timer });
  };

  setCaucusTimer = (timer: TimerData) => {
    this.setState({ caucusTimer: timer });
  };

  renderCaucus = (caucus?: CaucusData) => {
    const { renderNowSpeaking, renderHeader, recoverCaucusFref } = this;
    const { speakerTimer, committee, user, admins, session } = this.state;

    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
    const locks = recoverFeatureLocks(committee);

    const { caucusID } = this.props.match.params;
    const caucusFref = recoverCaucusFref();

    const members = recoverMembers(committee);

    const renderedSpeakerTimer = (
      <Timer
        name="Speaker timer"
        timerFref={caucusFref.child('speakerTimer')}
        key={caucusID + 'speakerTimer'}
        onChange={this.setSpeakerTimer}
        toggleKeyCode={83}
        defaultUnit={recoverUnit(caucus)}
        defaultDuration={recoverDuration(caucus) || 60}
        readOnly={!isStaff}
      />
    );

    const renderedCaucusTimer = (
      <Timer
        name="Caucus timer"
        timerFref={caucusFref.child('caucusTimer')}
        key={caucusID + 'caucusTimer'}
        onChange={this.setCaucusTimer}
        toggleKeyCode={67}
        defaultUnit={Unit.Minutes}
        defaultDuration={10}
        readOnly={!isStaff}
      />
    );

    const {
      autoNextSpeaker,
      timersInSeparateColumns,
      moveQueueUp
    } = recoverSettings(committee);

    const header = (
      <Grid.Row>
        <Grid.Column>{renderHeader(caucus, isStaff)}</Grid.Column>
      </Grid.Row>
    );

    const renderedCaucusQueuer = (
      <Queuer
        caucus={caucus}
        members={members}
        caucusFref={caucusFref}
        isStaff={isStaff}
        readOnly={readOnly}
        physicalMode={locks.physicalMode}
        session={validSession}
      />
    );

    const renderedCaucusNextSpeaking = (
      <NextSpeaking
        caucus={caucus}
        fref={caucusFref}
        speakerTimer={speakerTimer}
        autoNextSpeaker={autoNextSpeaker}
        isStaff={isStaff}
        readOnly={readOnly}
        session={validSession}
      />
    );

    const body = !timersInSeparateColumns ? (
      <Grid.Row>
        <Grid.Column>
          {renderNowSpeaking(caucus, isStaff)}
          {moveQueueUp && renderedCaucusQueuer}
          {renderedCaucusNextSpeaking}
          {!moveQueueUp && renderedCaucusQueuer}
        </Grid.Column>
        <Grid.Column>
          {renderedSpeakerTimer}
          {renderedCaucusTimer}
        </Grid.Column>
      </Grid.Row>
    ) : (
      <Grid.Row>
        <Grid.Column>
          {renderedSpeakerTimer}
          {renderNowSpeaking(caucus, isStaff)}
          {renderedCaucusNextSpeaking}
        </Grid.Column>
        <Grid.Column>
          {renderedCaucusTimer}
          {renderedCaucusQueuer}
        </Grid.Column>
      </Grid.Row>
    );

    return (
      <Container style={{ paddingBottom: '2em' }}>
        <Helmet>
          <title>{`${caucus?.name || 'Caucus'} - WUMUN`}</title>
        </Helmet>
        <Grid columns="equal" stackable>
          {header}
          {body}
        </Grid>
      </Container>
    );
  };

  render() {
    const { committee, loading } = this.state;
    const caucusID: CaucusID = this.props.match.params.caucusID;

    const caucus = recoverCaucus(committee, caucusID);

    if (!loading && !caucus) {
      return (
        <Container text style={{ paddingBottom: '2em' }}>
          <NotFound item="caucus" id={caucusID} />
        </Container>
      );
    } else {
      return this.renderCaucus(caucus);
    }
  }
}
