import * as React from 'react';
import firebase from 'firebase/compat/app';
import { RouteComponentProps } from 'react-router';
import {
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  Flag,
  Form,
  Icon,
  Label,
  Message,
  Popup,
  Segment
} from 'semantic-ui-react';
import {
  checkboxHandler,
  stateDropdownHandler,
  stateFieldHandler,
  stateMemberDropdownHandler,
  stateTextAreaHandler,
  stateValidatedNumberFieldHandler
} from '../modules/handlers';
import { implies } from '../utils';
import { TimeSetter } from '../components/TimeSetter';
import {
  canVote,
  isDaisMember,
  nameToFlagCode,
  nameToMemberOption,
  nonNGO
} from '../modules/member';
import {
  CaucusData,
  CaucusStatus,
  closeCaucus,
  DEFAULT_CAUCUS,
  putCaucus,
  putSpeaking,
  Stance
} from '../models/caucus';
import {
  CommitteeData,
  CommitteeID,
  DEFAULT_COMMITTEE,
  extendModTimer,
  extendUnmodTimer,
  putUnmodTimer,
  recoverCaucus,
  recoverFeatureLocks,
  recoverPresentMemberOptions,
  recoverResolution,
  recoverSettings
} from '../models/committee';
import { URLParameters } from '../types';
import { IDENTITCAL_PROPOSER_SECONDER } from './Resolution';
import {
  AmendmentData,
  DEFAULT_AMENDMENT,
  DEFAULT_RESOLUTION,
  putAmendment,
  putResolution,
  ResolutionData
} from '../models/resolution';
import { DEFAULT_STRAWPOLL, putStrawpoll } from '../models/strawpoll';
import { MotionsShareHint } from '../components/share-hints';
import { useVoterID, VoterID } from '../hooks';
import _ from 'lodash';
import { makeCommitteeStats } from '../modules/committee-stats';
import {
  DEFAULT_MOTION,
  MOTION_TYPE_OPTIONS,
  MotionData,
  MotionID,
  MotionType,
  MotionVote
} from '../models/motion';
import {
  actionName,
  approvable,
  detailLabel,
  disruptiveness,
  hasCaucusTarget,
  hasDetail,
  hasDuration,
  hasResolutionTarget,
  hasSeconder,
  hasSpeakers,
  hasTextArea,
  procedural,
  showMotionType
} from '../viewmodels/motion';
import { getSeconds, TimerData, Unit } from '../models/time';
import { SettingsData } from '../models/settings';
import { Helmet } from 'react-helmet';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import {
  DelegateSession,
  getDelegateSession,
  isReadOnlyForUser,
  resolveActiveMember,
  subscribeDelegateSession,
  validateDelegateSession
} from '../modules/delegate-session';

const DIVISIBILITY_ERROR = (
  <Message error content="Speaker time does not evenly divide the caucus time" />
);

interface Props extends RouteComponentProps<URLParameters> {}

interface Hooks {
  voterID: VoterID;
}

interface State {
  newMotion: MotionData;
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  session: DelegateSession | null;
  unsubscribeAuth?: () => void;
  unsubscribeSession?: () => void;
}

export class MotionsComponent extends React.Component<Props & Hooks, State> {
  private adminsRef = firebase.database().ref('conference/admins');

  constructor(props: Props & Hooks) {
    super(props);

    const { match } = props;
    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    const session = getDelegateSession(match.params.committeeID);

    this.state = {
      committeeFref: firebase.database().ref('committees').child(match.params.committeeID),
      newMotion: {
        ...DEFAULT_MOTION,
        proposer: session?.role === 'delegate' && session.memberName ? session.memberName : ''
      },
      user: initialUser,
      admins: {},
      session
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
      this.setState(prev => ({
        session,
        newMotion: {
          ...prev.newMotion,
          proposer:
            session?.role === 'delegate' && session.memberName
              ? session.memberName
              : prev.newMotion.proposer
        }
      }));
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

  getEffectiveProposer = (): string => {
    const { committee, user, admins, session, newMotion } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    if (!isStaff && validSession?.role === 'delegate' && validSession.memberName) {
      return validSession.memberName;
    }
    return newMotion.proposer || '';
  };

  handlePushMotion = (): void => {
    const { newMotion, committee, user, admins, session } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
    const { motionsArePublic } = recoverSettings(committee);

    if (!isStaff && (readOnly || !motionsArePublic)) {
      return;
    }

    const effectiveProposer = this.getEffectiveProposer();
    if (!effectiveProposer) return;

    const motionToPush: MotionData = {
      ...newMotion,
      proposer: effectiveProposer
    };

    this.state.committeeFref.child('motions').push().set(motionToPush);

    const duration =
      newMotion.caucusUnit === 'min'
        ? (newMotion.caucusDuration || 0) + 1
        : newMotion.caucusDuration;

    this.setState(prevState => {
      const { proposer, seconder, ...rest } = {
        ...prevState.newMotion,
        caucusDuration: duration,
        proposal: ''
      };

      return {
        newMotion: {
          ...rest,
          proposer: !isStaff && validSession?.memberName ? validSession.memberName : ''
        }
      };
    });
  };

  handleClearMotions = (): void => {
    const { committee, committeeFref, user, admins } = this.state;
    if (!isCommitteeStaff(user, committee, admins)) return;

    const motions = committee
      ? committee.motions || ({} as Record<string, MotionData>)
      : ({} as Record<string, MotionData>);

    Object.keys(motions).forEach(key => {
      committeeFref.child('motions').child(key).child('deleted').set(true);
    });
  };

  handleClearAdder = () => {
    this.setState({
      newMotion: DEFAULT_MOTION
    });
  };

  handleApproveMotion = (
    motionFref: firebase.database.Reference,
    motionData: MotionData
  ): void => {
    const { committee, user, admins } = this.state;
    if (!isCommitteeStaff(user, committee, admins)) return;

    const committeeID: CommitteeID = this.props.match.params.committeeID;

    const {
      proposer,
      speakerDuration,
      speakerUnit,
      caucusDuration,
      caucusUnit,
      seconder,
      proposal
    } = motionData;

    const caucusID = motionData.caucusTarget;
    const resolutionID = motionData.resolutionTarget;

    motionFref.child('deleted').set(true);

    if (
      motionData.type === MotionType.OpenModeratedCaucus &&
      speakerDuration &&
      caucusDuration &&
      proposer
    ) {
      const speakerSeconds = getSeconds(speakerDuration, speakerUnit);
      const caucusSeconds = getSeconds(caucusDuration, caucusUnit);

      const newCaucus: CaucusData = {
        ...DEFAULT_CAUCUS,
        name: proposal,
        speakerTimer: {
          ...DEFAULT_CAUCUS.speakerTimer,
          remaining: speakerSeconds
        },
        caucusTimer: {
          ...DEFAULT_CAUCUS.caucusTimer,
          remaining: caucusSeconds
        },
        speaking: {
          who: proposer,
          stance: Stance.For,
          duration: speakerSeconds
        },
        speakerDuration: speakerDuration,
        speakerUnit: speakerUnit
      };

      const caucusRef = putCaucus(committeeID, newCaucus);

      this.props.history.push(`/committees/${committeeID}/caucuses/${caucusRef.key}`);
    } else if (
      (motionData.type === MotionType.OpenUnmoderatedCaucus ||
        motionData.type === MotionType.AddWorkingPaper) &&
      caucusDuration
    ) {
      this.props.history.push(`/committees/${committeeID}/unmod`);

      const caucusSeconds = getSeconds(caucusDuration, caucusUnit);

      const newTimer: TimerData = {
        ...DEFAULT_COMMITTEE.timer,
        remaining: caucusSeconds
      };

      putUnmodTimer(committeeID, newTimer);
    } else if (
      motionData.type === MotionType.IntroduceDraftResolution &&
      proposer &&
      seconder
    ) {
      const newResolution: ResolutionData = {
        ...DEFAULT_RESOLUTION,
        name: proposal,
        proposer: proposer,
        seconder: seconder
      };

      const resolutionRef = putResolution(committeeID, newResolution);

      this.props.history.push(
        `/committees/${committeeID}/resolutions/${resolutionRef.key}`
      );
    } else if (motionData.type === MotionType.ExtendUnmoderatedCaucus && caucusDuration) {
      this.props.history.push(`/committees/${committeeID}/unmod`);

      const caucusSeconds = getSeconds(caucusDuration, caucusUnit);

      extendUnmodTimer(committeeID, caucusSeconds);
    } else if (
      motionData.type === MotionType.ExtendModeratedCaucus &&
      caucusDuration &&
      caucusID &&
      proposer &&
      committee
    ) {
      this.props.history.push(`/committees/${committeeID}/caucuses/${caucusID}`);

      const caucusSeconds = getSeconds(caucusDuration, caucusUnit);

      extendModTimer(committeeID, caucusID, caucusSeconds);

      // @ts-ignore Assert that this exists
      const caucus: CaucusData = committee.caucuses[caucusID];
      const speakerSeconds = getSeconds(caucus.speakerDuration, caucus.speakerUnit);

      putSpeaking(committeeID, caucusID, {
        who: proposer,
        stance: Stance.For,
        duration: speakerSeconds
      });
    } else if (motionData.type === MotionType.CloseModeratedCaucus && caucusID) {
      this.props.history.push(`/committees/${committeeID}/caucuses/${caucusID}`);

      closeCaucus(committeeID, caucusID);
    } else if (
      motionData.type === MotionType.IntroduceAmendment &&
      resolutionID &&
      proposer
    ) {
      this.props.history.push(
        `/committees/${committeeID}/resolutions/${resolutionID}/amendments`
      );

      const newAmendment: AmendmentData = {
        ...DEFAULT_AMENDMENT,
        text: proposal,
        proposer: proposer
      };

      putAmendment(committeeID, resolutionID, newAmendment);
    } else if (motionData.type === MotionType.VoteOnResolution && resolutionID) {
      this.props.history.push(
        `/committees/${committeeID}/resolutions/${resolutionID}/voting`
      );
    } else if (motionData.type === MotionType.ProposeStrawpoll) {
      const strawpollRef = putStrawpoll(committeeID, {
        ...DEFAULT_STRAWPOLL,
        question: proposal
      });

      this.props.history.push(
        `/committees/${committeeID}/strawpolls/${strawpollRef.key}`
      );
    }
  };

  renderMotion = (
    id: MotionID,
    motionData: MotionData,
    motionFref: firebase.database.Reference
  ) => {
    const { handleApproveMotion } = this;
    const { committee, user, admins, session } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
    const activeMember = resolveActiveMember(validSession, committee);

    const {
      proposer,
      proposal,
      type,
      caucusUnit,
      caucusDuration,
      speakerUnit,
      speakerDuration,
      seconder,
      caucusTarget,
      resolutionTarget
    } = motionData;

    const caucus = recoverCaucus(committee, caucusTarget || '');
    const caucusTargetText = caucus ? caucus.name : caucusTarget;

    const resolution = recoverResolution(committee, resolutionTarget || '');
    const resolutionTargetText = resolution ? resolution.name : resolutionTarget;

    // Determine if this user is allowed to cast a vote on motions:
    // Dais / Staff and Dais rank members NEVER interact with voting.
    // Only an active present delegation with voting eligibility can vote when not in Physical/Read-Only mode.
    const isProc = procedural(motionData.type);
    const memberCanVoteOnMotion = Boolean(
      !isStaff &&
        !readOnly &&
        activeMember &&
        !isDaisMember(activeMember.member) &&
        activeMember.member.present &&
        (isProc ? nonNGO(activeMember.member) : canVote(activeMember.member))
    );
    const effectiveVoterKey = activeMember ? activeMember.memberID : this.props.voterID;

    const renderVoteCount = () => {
      const votes = motionData.votes ?? {};

      const vote = (v: MotionVote) => {
        if (!memberCanVoteOnMotion) return;
        if (votes[effectiveVoterKey] === v) {
          motionFref.child('votes').child(effectiveVoterKey).remove();
        } else {
          motionFref.child('votes').child(effectiveVoterKey).set(v);
        }
      };

      const counts = _.countBy(Object.values(votes));

      return (
        <Button.Group className="thirdwidth">
          <Popup
            content={
              memberCanVoteOnMotion
                ? 'Vote Against'
                : isStaff
                ? 'Dais / Staff do not vote on motions'
                : 'Select a present voting delegation to vote'
            }
            trigger={
              <Button
                color="red"
                disabled={!memberCanVoteOnMotion}
                active={votes[effectiveVoterKey] === MotionVote.Against}
                onClick={() => vote(MotionVote.Against)}
              >
                <Icon
                  name={
                    votes[effectiveVoterKey] === MotionVote.Against
                      ? 'thumbs down'
                      : 'thumbs down outline'
                  }
                />
                {counts[MotionVote.Against] ?? 0}
              </Button>
            }
          />
          {procedural(motionData.type) && (
            <Popup
              content={
                memberCanVoteOnMotion
                  ? 'Abstain'
                  : isStaff
                  ? 'Dais / Staff do not vote on motions'
                  : 'Select a present voting delegation to vote'
              }
              trigger={
                <Button
                  color="yellow"
                  disabled={!memberCanVoteOnMotion}
                  active={votes[effectiveVoterKey] === MotionVote.Abstain}
                  onClick={() => vote(MotionVote.Abstain)}
                >
                  <Icon
                    name={
                      votes[effectiveVoterKey] === MotionVote.Abstain
                        ? 'circle'
                        : 'circle outline'
                    }
                  />
                  {counts[MotionVote.Abstain] ?? 0}
                </Button>
              }
            />
          )}
          <Popup
            content={
              memberCanVoteOnMotion
                ? 'Vote In Favour'
                : isStaff
                ? 'Dais / Staff do not vote on motions'
                : 'Select a present voting delegation to vote'
            }
            trigger={
              <Button
                color="green"
                disabled={!memberCanVoteOnMotion}
                active={votes[effectiveVoterKey] === MotionVote.For}
                onClick={() => vote(MotionVote.For)}
              >
                <Icon
                  name={
                    votes[effectiveVoterKey] === MotionVote.For
                      ? 'thumbs up'
                      : 'thumbs up outline'
                  }
                />
                {counts[MotionVote.For] ?? 0}
              </Button>
            }
          />
        </Button.Group>
      );
    };

    const descriptionTree = (
      <Card.Description>
        <Label horizontal>{detailLabel(type)}</Label>
        {proposal}
      </Card.Description>
    );

    const proposerTree = (
      <div>
        <Label horizontal>Proposer</Label>
        <Flag name={nameToFlagCode(proposer || '')} /> {proposer}
      </div>
    );

    const seconderTree = (
      <div>
        <Label horizontal>Seconder</Label>
        <Flag name={nameToFlagCode(seconder || '')} /> {seconder}
      </div>
    );

    const caucusTargetTree = (
      <div>
        <Label horizontal>Target caucus</Label>
        {caucusTargetText}
      </div>
    );

    const resolutionTargetTree = (
      <div>
        <Label horizontal>Target resolution</Label>
        {resolutionTargetText}
      </div>
    );

    const time = hasDuration(type)
      ? hasSpeakers(type)
        ? `${caucusDuration || 0} ${caucusUnit} / ${speakerDuration || 0} ${speakerUnit} `
        : `${caucusDuration || 0} ${caucusUnit} `
      : '';

    const canDeleteMotion = Boolean(
      isStaff ||
        (!readOnly &&
          validSession?.role === 'delegate' &&
          validSession.memberName &&
          proposer === validSession.memberName)
    );

    const showMotionVotes = recoverSettings(committee).motionVotes;

    return (
      <Card className="motion" key={id}>
        <Card.Content>
          <Card.Header>{showMotionType(type, time)}</Card.Header>
          <Card.Meta>
            {proposerTree}
            {hasSeconder(type) && seconderTree}
            {hasCaucusTarget(type) && caucusTargetTree}
            {hasResolutionTarget(type) && resolutionTargetTree}
          </Card.Meta>
          {hasDetail(type) && descriptionTree}
        </Card.Content>
        {(canDeleteMotion || showMotionVotes || (isStaff && approvable(type))) && (
          <Button.Group fluid attached="bottom">
            {canDeleteMotion && (
              <Button
                className="thirdwidth"
                basic
                negative
                onClick={() => motionFref.child('deleted').set(true)}
              >
                Delete
              </Button>
            )}
            {showMotionVotes && renderVoteCount()}
            {isStaff && approvable(type) && (
              <Button
                className="thirdwidth"
                disabled={motionData.proposer === ''}
                basic
                positive
                onClick={() => handleApproveMotion(motionFref, motionData)}
              >
                {actionName(type)}
              </Button>
            )}
          </Button.Group>
        )}
      </Card>
    );
  };

  hasDivisiblityError = () => {
    const { type, caucusDuration, caucusUnit, speakerDuration, speakerUnit } =
      this.state.newMotion;

    const caucusSeconds = getSeconds(caucusDuration || 0, caucusUnit);
    const speakerSeconds = getSeconds(speakerDuration || 0, speakerUnit);

    const doesNotEvenlyDivide = caucusSeconds % speakerSeconds !== 0;

    return hasSpeakers(type) && hasDuration(type) && doesNotEvenlyDivide;
  };

  hasIdenticalProposerSeconder = () => {
    const proposer = this.getEffectiveProposer();
    const { seconder } = this.state.newMotion;

    return proposer && seconder ? proposer === seconder : false;
  };

  renderAdder = (committee?: CommitteeData): JSX.Element => {
    const { newMotion, user, admins, session } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
    const locks = recoverFeatureLocks(committee);
    const { motionsArePublic } = recoverSettings(committee);

    if (!isStaff) {
      if (locks.physicalMode) {
        return (
          <Message info icon>
            <Icon name="hand paper outline" />
            <Message.Content>
              <Message.Header>Physical Committee Mode</Message.Header>
              Active motions on the floor are shown below. To propose a motion, please send a note
              in person to the Dais.
            </Message.Content>
          </Message>
        );
      }

      if (readOnly || !validSession || validSession.role !== 'delegate' || !validSession.memberName) {
        return (
          <Message size="small" info>
            <Icon name="eye" /> Viewing motions in read-only mode. Select a delegation in the top
            bar to propose or vote on motions when open.
          </Message>
        );
      }

      if (!motionsArePublic) {
        return (
          <Message size="small" warning>
            <Icon name="lock" /> Floor motion proposals are currently closed to delegates by the
            Dais.
          </Message>
        );
      }
    }

    const effectiveProposer = this.getEffectiveProposer();
    const {
      proposal,
      type,
      caucusUnit,
      caucusDuration,
      speakerUnit,
      speakerDuration,
      seconder,
      caucusTarget,
      resolutionTarget
    } = newMotion;

    const boxForAmmendments = (
      <Form.TextArea
        value={proposal}
        autoHeight
        onChange={stateTextAreaHandler<Props, State>(this, 'newMotion', 'proposal')}
        rows={2}
        label={detailLabel(newMotion.type)}
        placeholder={detailLabel(newMotion.type)}
      />
    );

    const boxForNames = (
      <Form.Input
        label="Name"
        placeholder="Name"
        value={proposal}
        onChange={stateFieldHandler<Props, State>(this, 'newMotion', 'proposal')}
        fluid
      />
    );

    const description = (
      <Form.Group widths="equal">
        {hasTextArea(newMotion.type) ? boxForAmmendments : boxForNames}
      </Form.Group>
    );

    const speakerSetter = (
      <TimeSetter
        error={this.hasDivisiblityError()}
        unitValue={speakerUnit}
        durationValue={speakerDuration ? speakerDuration.toString() : undefined}
        onUnitChange={stateDropdownHandler<Props, State>(this, 'newMotion', 'speakerUnit')}
        onDurationChange={stateValidatedNumberFieldHandler<Props, State>(
          this,
          'newMotion',
          'speakerDuration'
        )}
        label="Speaking time"
      />
    );

    const durationSetter = (
      <TimeSetter
        error={this.hasDivisiblityError()}
        unitValue={caucusUnit}
        durationValue={caucusDuration ? caucusDuration.toString() : undefined}
        onUnitChange={stateDropdownHandler<Props, State>(this, 'newMotion', 'caucusUnit')}
        onDurationChange={stateValidatedNumberFieldHandler<Props, State>(
          this,
          'newMotion',
          'caucusDuration'
        )}
        label="Duration"
      />
    );

    const resolutions: Record<string, ResolutionData> =
      this.state.committee?.resolutions || {};
    const caucuses: Record<string, CaucusData> = this.state.committee?.caucuses || {};

    const caucusOptions = Object.keys(caucuses || {})
      .filter(key => caucuses![key].status === CaucusStatus.Open.toString())
      .map(key => ({ key: key, value: key, text: caucuses![key].name }));

    const resolutionOptions = Object.keys(resolutions || {}).map(key => ({
      key: key,
      value: key,
      text: resolutions![key].name
    }));

    const caucusTargetSetter = (
      <Form.Dropdown
        key="caucusTarget"
        value={caucusTarget}
        search
        selection
        fluid
        error={!caucusTarget}
        loading={!committee}
        onChange={stateDropdownHandler<Props, State>(this, 'newMotion', 'caucusTarget')}
        options={caucusOptions}
        icon="search"
        label="Target caucus"
      />
    );

    const resolutionTargetSetter = (
      <Form.Dropdown
        key="resolutionTarget"
        value={resolutionTarget}
        search
        selection
        fluid
        error={!resolutionTarget}
        loading={!committee}
        onChange={stateDropdownHandler<Props, State>(this, 'newMotion', 'resolutionTarget')}
        options={resolutionOptions}
        icon="search"
        label="Target resolution"
      />
    );

    const setters = (
      <Form.Group widths="equal">
        {hasCaucusTarget(type) && caucusTargetSetter}
        {hasResolutionTarget(type) && resolutionTargetSetter}
        {hasDuration(type) && durationSetter}
        {hasSpeakers(type) && speakerSetter}
      </Form.Group>
    );

    const memberOptions = recoverPresentMemberOptions(this.state.committee);

    const proposerTree = isStaff ? (
      <Form.Dropdown
        icon="search"
        key="proposer"
        value={effectiveProposer ? nameToMemberOption(effectiveProposer).key : false}
        search
        error={!effectiveProposer || this.hasIdenticalProposerSeconder()}
        loading={!committee}
        selection
        fluid
        onChange={stateMemberDropdownHandler<Props, State>(
          this,
          'newMotion',
          'proposer',
          memberOptions
        )}
        options={memberOptions}
        label="Proposer"
      />
    ) : (
      <Form.Field key="proposer-locked">
        <label>Proposer (Your Delegation)</label>
        <Segment compact style={{ margin: 0, padding: '0.6em 0.9em' }}>
          <Flag name={nameToFlagCode(effectiveProposer)} />
          <strong>{effectiveProposer}</strong>
        </Segment>
      </Form.Field>
    );

    const seconderTree = (
      <Form.Dropdown
        icon="search"
        key="seconder"
        error={!seconder || this.hasIdenticalProposerSeconder()}
        value={seconder ? nameToMemberOption(seconder).key : false}
        loading={!committee}
        search
        selection
        fluid
        onChange={stateMemberDropdownHandler<Props, State>(
          this,
          'newMotion',
          'seconder',
          memberOptions
        )}
        options={memberOptions}
        label="Seconder"
      />
    );

    const hasError = this.hasDivisiblityError() || this.hasIdenticalProposerSeconder();

    return (
      <Form error={hasError}>
        <Form.Dropdown
          placeholder="Select type"
          search
          selection
          fluid
          label="Type"
          icon="search"
          options={MOTION_TYPE_OPTIONS}
          onChange={stateDropdownHandler<Props, State>(this, 'newMotion', 'type')}
          value={type}
        />
        {hasDetail(type) && description}
        <Form.Group widths="equal">
          {proposerTree}
          {hasSeconder(type) && seconderTree}
        </Form.Group>
        {(hasSpeakers(type) ||
          hasDuration(type) ||
          hasCaucusTarget(type) ||
          hasResolutionTarget(type)) &&
          setters}
        {this.hasDivisiblityError() && DIVISIBILITY_ERROR}
        {this.hasIdenticalProposerSeconder() && IDENTITCAL_PROPOSER_SECONDER}
        <Button
          icon="plus"
          basic
          primary
          fluid
          disabled={
            !effectiveProposer ||
            !implies(hasSeconder(type), !!seconder) ||
            !implies(hasCaucusTarget(type), !!caucusTarget) ||
            !implies(hasResolutionTarget(type), !!resolutionTarget) ||
            hasError
          }
          onClick={this.handlePushMotion}
        />
      </Form>
    );
  };

  renderMotions = (motions: Record<MotionID, MotionData>) => {
    const { renderMotion } = this;
    const { committeeFref } = this.state;

    return Object.keys(motions)
      .filter(key => !motions[key].deleted)
      .sort((a, b) => {
        const ma: MotionData = motions[a];
        const mb: MotionData = motions[b];
        const ca = disruptiveness(ma.type);
        const cb = disruptiveness(mb.type);

        if (ca < cb) {
          return -1;
        } else if (ca === cb) {
          const sa =
            (ma.caucusDuration || 0) * (ma.caucusUnit === Unit.Minutes ? 60 : 1);
          const sb =
            (mb.caucusDuration || 0) * (mb.caucusUnit === Unit.Minutes ? 60 : 1);

          if (sa < sb) {
            return 1;
          } else if (sa === sb) {
            return 0;
          } else {
            return -1;
          }
        } else {
          return 1;
        }
      })
      .map(key => {
        return renderMotion(key, motions[key], committeeFref.child('motions').child(key));
      });
  };

  render() {
    const { renderMotions, renderAdder } = this;
    const { committee, committeeFref, user, admins } = this.state;
    const { committeeID } = this.props.match.params;
    const { operative } = makeCommitteeStats(this.state.committee);
    const { motionVotes, motionsArePublic } = recoverSettings(committee);
    const isStaff = isCommitteeStaff(user, committee, admins);

    const renderedMotions = committee
      ? renderMotions(committee.motions || ({} as Record<string, MotionData>))
      : [];

    return (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`Motions - WUMUN`}</title>
        </Helmet>
        {renderAdder(committee)}
        {isStaff && (
          <>
            <Divider hidden />
            <Checkbox
              style={{ paddingRight: '50px' }}
              label="Delegates can propose motions"
              toggle
              checked={motionsArePublic}
              onChange={checkboxHandler<SettingsData>(
                committeeFref.child('settings'),
                'motionsArePublic'
              )}
            />
            <Checkbox
              label="Delegates can vote on motions"
              toggle
              checked={motionVotes}
              onChange={checkboxHandler<SettingsData>(
                committeeFref.child('settings'),
                'motionVotes'
              )}
            />
            {(motionVotes || motionsArePublic) && (
              <MotionsShareHint
                committeeID={committeeID}
                canVote={motionVotes}
                canPropose={motionsArePublic}
              />
            )}
          </>
        )}
        <Divider />
        <Icon name="sort numeric ascending" /> Sorted from most to least disruptive.{' '}
        {operative} votes required to pass a motion
        {isStaff && (
          <Button
            negative
            disabled={renderedMotions.length <= 0}
            floated="right"
            icon="eraser"
            content="Clear"
            compact
            basic
            onClick={this.handleClearMotions}
          />
        )}
        <Divider hidden />
        <Card.Group itemsPerRow={1}>{renderedMotions}</Card.Group>
      </Container>
    );
  }
}

export default function Motions(props: Props) {
  const [voterID] = useVoterID();

  return <MotionsComponent {...props} voterID={voterID} />;
}
