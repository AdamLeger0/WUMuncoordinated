import firebase from 'firebase/compat/app';
import * as React from 'react';
import { RouteComponentProps } from 'react-router';
import { URLParameters } from '../types';
import {
  DEFAULT_STRAWPOLL_OPTION,
  StrawpollData,
  StrawpollMedium,
  StrawpollOptionData,
  StrawpollOptionID,
  StrawpollStage,
  StrawpollType,
} from '../models/strawpoll';
import {
  Button,
  Checkbox,
  CheckboxProps,
  Container,
  Dropdown,
  DropdownProps,
  Form,
  Header,
  Icon,
  Input,
  List,
  Message,
  Modal,
  Progress,
} from 'semantic-ui-react';
import {
  checkboxHandler,
  clearableZeroableValidatedNumberFieldHandler,
  fieldHandler,
} from '../modules/handlers';
import { useAuthState } from 'react-firebase-hooks/auth';
import { StrawpollShareHint } from '../components/share-hints';
import { NotFound } from '../components/NotFound';
import { useVoterID } from '../hooks';
import { Helmet } from 'react-helmet';
import { CommitteeData } from '../models/committee';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import {
  DelegateSession,
  getDelegateSession,
  isReadOnlyForUser,
  resolveActiveMember,
  subscribeDelegateSession,
  validateDelegateSession,
} from '../modules/delegate-session';
import { isDaisMember } from '../modules/member';

export interface StrawpollProps extends RouteComponentProps<URLParameters> {}

export interface ModalProps {
  open: boolean;
  onChangeOpenState: (open: boolean) => void;
  onConfirm: Function;
  trigger: React.ReactElement<Button>;
}

function getNumberOfVotes(option: StrawpollOptionData, medium: StrawpollMedium) {
  if (medium === StrawpollMedium.Manual) {
    return option.tally || 0;
  } else {
    let votes = 0;
    Object.keys(option.votes || {}).forEach(() => {
      votes += 1;
    });
    return votes;
  }
}

export function DeleteStrawpollModal(props: ModalProps) {
  const onYesClick = () => {
    props.onConfirm();
    props.onChangeOpenState(false);
  };

  const onNoClick = () => {
    props.onChangeOpenState(false);
  };

  return (
    <Modal
      size={'mini'}
      centered={false}
      open={props.open}
      onClose={() => props.onChangeOpenState(false)}
      onOpen={() => props.onChangeOpenState(true)}
      trigger={props.trigger}
    >
      <Modal.Header>Delete strawpoll?</Modal.Header>
      <Modal.Content>
        <Modal.Description>
          Are you sure that you want to delete this strawpoll?
        </Modal.Description>
      </Modal.Content>
      <Modal.Actions>
        <Button negative onClick={onYesClick}>
          Yes
        </Button>
        <Button onClick={onNoClick}>No</Button>
      </Modal.Actions>
    </Modal>
  );
}

export default function Strawpoll(props: StrawpollProps) {
  const { committeeID, strawpollID } = props.match.params;
  const committeeFref = React.useMemo(
    () => firebase.database().ref('committees').child(committeeID),
    [committeeID]
  );
  const strawpollFref = React.useMemo(
    () => committeeFref.child('strawpolls').child(strawpollID),
    [committeeFref, strawpollID]
  );

  const [committee, setCommittee] = React.useState<CommitteeData | undefined>(undefined);
  const [admins, setAdmins] = React.useState<Record<string, AdminRecord | boolean>>({});
  const [strawpoll, setStrawpoll] = React.useState<StrawpollData | undefined>(undefined);
  const [session, setSession] = React.useState<DelegateSession | null>(() =>
    getDelegateSession(committeeID)
  );

  React.useEffect(() => {
    const cb = (snap: firebase.database.DataSnapshot | null) => {
      setStrawpoll(snap ? snap.val() || undefined : undefined);
    };
    const commCb = (snap: firebase.database.DataSnapshot | null) => {
      setCommittee(snap ? snap.val() || undefined : undefined);
    };
    const admRef = firebase.database().ref('conference/admins');
    const admCb = (snap: firebase.database.DataSnapshot | null) => {
      setAdmins((snap && snap.val()) || {});
    };

    strawpollFref.on('value', cb);
    committeeFref.on('value', commCb);
    admRef.on('value', admCb);
    const unsubSession = subscribeDelegateSession(committeeID, setSession);

    return () => {
      strawpollFref.off('value', cb);
      committeeFref.off('value', commCb);
      admRef.off('value', admCb);
      unsubSession();
    };
  }, [strawpollFref, committeeFref, committeeID]);

  const [user] = useAuthState(firebase.auth() as any);
  const [voterID] = useVoterID();
  const [modalOpen, setOpen] = React.useState(false);

  if (!strawpoll) {
    return (
      <Container text>
        <NotFound id={strawpollID} item="strawpoll" />
      </Container>
    );
  }

  const isStaff = isCommitteeStaff(user as any, committee, admins);
  const validSession = validateDelegateSession(session, committee);
  const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
  const activeMember = resolveActiveMember(validSession, committee);

  // Dais / Staff do not vote; only an active non-Dais delegation can vote when not in Physical/Read-Only mode
  const canVoteInPoll = Boolean(
    !isStaff &&
      !readOnly &&
      activeMember &&
      !isDaisMember(activeMember.member) &&
      activeMember.member.present
  );
  const effectiveVoterID = activeMember ? activeMember.memberID : voterID;

  const type: StrawpollType = strawpoll.type || StrawpollType.Checkbox;
  const stage: StrawpollStage = strawpoll.stage || StrawpollStage.Preparing;
  const medium: StrawpollMedium = strawpoll.medium || StrawpollMedium.Link;
  const options: Record<StrawpollOptionID, StrawpollOptionData> = strawpoll.options || {};

  let totalVotes = 0;
  Object.keys(options).forEach(oid => {
    totalVotes += getNumberOfVotes(options[oid], medium);
  });

  const canModifyOptions = Boolean(
    isStaff || (!readOnly && strawpoll.optionsArePublic && validSession?.role === 'delegate')
  );

  const addOption = () => {
    if (!canModifyOptions) return;
    strawpollFref.child('options').push(DEFAULT_STRAWPOLL_OPTION);
  };

  const togglePollType = (event: React.SyntheticEvent, data: DropdownProps) => {
    if (!isStaff) return;
    strawpollFref.child('type').set(data.value);
    Object.keys(options).forEach(oid => {
      const votes = options[oid].votes;
      if (votes) {
        strawpollFref.child('options').child(oid).child('votes').set({});
      }
    });
  };

  const deleteStrawpoll = () => {
    if (!isStaff) return;
    strawpollFref.remove();
  };

  const createSharablePoll = () => {
    if (!isStaff) return;
    strawpollFref.child('stage').set(StrawpollStage.Voting);
    strawpollFref.child('medium').set(StrawpollMedium.Link);
  };

  const createManualPoll = () => {
    if (!isStaff) return;
    strawpollFref.child('stage').set(StrawpollStage.Voting);
    strawpollFref.child('medium').set(StrawpollMedium.Manual);
  };

  const reopenVoting = () => {
    if (!isStaff) return;
    strawpollFref.child('stage').set(StrawpollStage.Voting);
  };

  const editOptions = () => {
    if (!isStaff) return;
    strawpollFref.child('stage').set(StrawpollStage.Preparing);
  };

  const viewResults = () => {
    if (!isStaff) return;
    strawpollFref.child('stage').set(StrawpollStage.Results);
  };

  const onCheck =
    (oid: StrawpollOptionID) =>
    (event: React.FormEvent<HTMLInputElement>, data: CheckboxProps) => {
      if (!canVoteInPoll) return;
      if (type === StrawpollType.Checkbox) {
        if (data.checked) {
          strawpollFref.child(`options/${oid}/votes/${effectiveVoterID}`).set(true);
        } else {
          strawpollFref.child(`options/${oid}/votes/${effectiveVoterID}`).remove();
        }
      } else if (type === StrawpollType.Radio) {
        if (data.checked) {
          Object.keys(options).forEach(id =>
            strawpollFref.child(`options/${id}/votes/${effectiveVoterID}`).remove()
          );
          strawpollFref.child(`options/${oid}/votes/${effectiveVoterID}`).set(true);
        }
      }
    };

  const renderOption = (optionID: StrawpollOptionID, option: StrawpollOptionData) => {
    const strawpollOptionFref = strawpollFref.child('options').child(optionID);

    const isChecked = option.votes
      ? option.votes[effectiveVoterID]
        ? !!option.votes[effectiveVoterID]
        : false
      : false;

    const votes = getNumberOfVotes(option, medium);

    switch (stage) {
      case StrawpollStage.Preparing:
        return (
          <List.Item key={optionID}>
            <Input
              value={option.text}
              readOnly={!canModifyOptions}
              onChange={
                canModifyOptions
                  ? fieldHandler<StrawpollOptionData>(strawpollOptionFref, 'text')
                  : undefined
              }
              fluid
              placeholder="Enter poll option"
              action={isStaff}
            >
              <input />
              {isStaff && (
                <Button
                  negative
                  icon="trash"
                  basic
                  onClick={() => strawpollOptionFref.remove()}
                />
              )}
            </Input>
          </List.Item>
        );
      case StrawpollStage.Voting:
        return medium === StrawpollMedium.Link ? (
          <Form.Field key={optionID}>
            <Checkbox
              label={option.text}
              name="checkboxRadioGroup"
              radio={type === StrawpollType.Radio || undefined}
              value={option.text}
              disabled={!canVoteInPoll}
              checked={isChecked}
              onChange={onCheck(optionID)}
            />
          </Form.Field>
        ) : (
          <List.Item key={optionID}>
            <Input
              fluid
              readOnly={!isStaff}
              placeholder="Number of votes received"
              label={option.text}
              value={(!!option.tally || option.tally === 0 ? option.tally : '').toString()}
              error={option.tally === undefined}
              onChange={
                isStaff
                  ? clearableZeroableValidatedNumberFieldHandler<StrawpollOptionData>(
                      strawpollOptionFref,
                      'tally'
                    )
                  : undefined
              }
            />
          </List.Item>
        );
      case StrawpollStage.Results:
        return (
          <List.Item key={optionID}>
            <b>{option.text}</b> {votes} votes
            <Progress progress="value" value={votes} total={totalVotes} />
          </List.Item>
        );
      default:
        return undefined;
    }
  };

  const renderOptions = () => {
    return (
      <List>
        {Object.keys(options).map(key => {
          return renderOption(key, options[key]);
        })}
        {stage === StrawpollStage.Preparing && canModifyOptions && (
          <List.Item>
            <Button basic fluid onClick={addOption}>
              <Icon name="plus" />
              Add option
            </Button>
          </List.Item>
        )}
      </List>
    );
  };

  const renderMetaButtons = () => {
    if (!isStaff) {
      if (stage === StrawpollStage.Voting && !canVoteInPoll) {
        return (
          <Message size="small" info>
            <Icon name="info circle" />{' '}
            {readOnly
              ? 'Viewing strawpoll in read-only mode.'
              : 'Your delegation must be marked Present to vote in this strawpoll.'}
          </Message>
        );
      }
      return undefined;
    }

    switch (stage) {
      case StrawpollStage.Preparing:
        return (
          <List>
            <List.Item>
              <Button.Group fluid>
                <Dropdown
                  basic
                  button
                  className="purple centered"
                  upward={false}
                  options={[
                    {
                      key: StrawpollType.Checkbox,
                      value: StrawpollType.Checkbox,
                      text: 'Choose many',
                      icon: 'check square',
                    },
                    {
                      key: StrawpollType.Radio,
                      value: StrawpollType.Radio,
                      text: 'Choose one',
                      icon: 'radio',
                    },
                  ]}
                  onChange={togglePollType}
                  value={type}
                />
                <DeleteStrawpollModal
                  open={modalOpen}
                  onChangeOpenState={setOpen}
                  onConfirm={deleteStrawpoll}
                  trigger={
                    <Button color="red" basic onClick={() => setOpen(true)}>
                      <Icon name="delete" />
                      Delete strawpoll?
                    </Button>
                  }
                />
              </Button.Group>
            </List.Item>
            <List.Item>
              <Checkbox
                label="Delegates can add options"
                toggle
                checked={strawpoll.optionsArePublic || false}
                onClick={checkboxHandler<StrawpollData>(
                  strawpollFref,
                  'optionsArePublic'
                )}
              />
            </List.Item>
          </List>
        );
      case StrawpollStage.Voting:
        return (
          medium === StrawpollMedium.Link && (
            <StrawpollShareHint committeeID={committeeID} strawpollID={strawpollID} />
          )
        );
      default:
        return undefined;
    }
  };

  const renderNavButtons = () => {
    if (!isStaff) return null;

    switch (stage) {
      case StrawpollStage.Preparing:
        return (
          <Button.Group fluid>
            <Button primary basic onClick={createSharablePoll}>
              Create shareable poll
              <Icon name="arrow right" />
            </Button>
            <Button.Or />
            <Button primary basic onClick={createManualPoll}>
              Create manual poll
              <Icon name="arrow right" />
            </Button>
          </Button.Group>
        );
      case StrawpollStage.Voting:
        return (
          <Button.Group fluid>
            <Button basic secondary onClick={editOptions}>
              <Icon name="arrow left" />
              Edit options
            </Button>
            <Button primary basic onClick={viewResults}>
              View results
              <Icon name="arrow right" />
            </Button>
          </Button.Group>
        );
      case StrawpollStage.Results:
        return (
          <Button fluid secondary basic onClick={reopenVoting}>
            <Icon name="arrow left" />
            Reopen voting
          </Button>
        );
      default:
        return <div />;
    }
  };

  return (
    <Container text style={{ padding: '1em 0em' }}>
      <Helmet>
        <title>{`${strawpoll.question} - Winthrop University Model UN`}</title>
      </Helmet>
      {isStaff ? (
        <Header as="h2">
          <Input
            value={strawpoll.question}
            onChange={fieldHandler<StrawpollData>(strawpollFref, 'question')}
            fluid
            placeholder="Type your question here"
          />
        </Header>
      ) : (
        <Header as="h2">{strawpoll.question || 'Strawpoll'}</Header>
      )}
      {renderMetaButtons()}
      {renderOptions()}
      {renderNavButtons()}
    </Container>
  );
}
