import * as React from 'react';
import firebase from 'firebase/compat/app';
import {
  MemberData,
  MemberID,
  Rank,
  canonicalCountryName,
  isDaisMember,
  nameToFlagCode,
  nameToMemberOption,
  MemberOption,
  searchCountryOptions
} from '../modules/member';
import {
  Dropdown,
  Flag,
  Table,
  Button,
  Checkbox,
  CheckboxProps,
  DropdownProps,
  ButtonProps,
  Container,
  Message,
  Icon,
  Grid,
  Input,
  Label,
  Segment,
} from 'semantic-ui-react';
import { checkboxHandler, dropdownHandler, fieldHandler } from '../modules/handlers';
import { makeDropdownOption } from '../utils';
import _ from 'lodash';
import { URLParameters } from '../types';
import { RouteComponentProps } from 'react-router';
import { logClickGeneralSpeakersList } from '../modules/analytics';
import { CommitteeStatsTable } from '../modules/committee-stats';
import { CommitteeData, CommitteeID, pushMember, Template } from '../models/committee';
import { TemplateAdder } from '../components/template';
import { COUNTRY_OPTIONS } from '../constants';
import { Helmet } from 'react-helmet';
import { AdminRecord, isCommitteeStaff } from '../models/conference';

interface Props extends RouteComponentProps<URLParameters> {
  committee: CommitteeData;
  fref: firebase.database.Reference;
}

interface State {
  template?: Template;
  member: MemberOption;
  options: MemberOption[];
  rank: Rank;
  voting: MemberData['voting'];
  present: MemberData['present'];
  password: string;
  customDaisName: string;
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  unsubscribeAuth?: () => void;
}

const RANK_OPTIONS = [
  Rank.Standard,
  Rank.Veto,
  Rank.NGO,
  Rank.Observer,
  Rank.Dais
].map(makeDropdownOption);

export default class Admin extends React.Component<Props, State> {
  private adminsRef = firebase.database().ref('conference/admins');

  constructor(props: Props) {
    super(props);

    let initialUser: firebase.User | null = null;
    try {
      initialUser = firebase.auth().currentUser;
    } catch (e) {
      initialUser = null;
    }

    this.state = {
      member: COUNTRY_OPTIONS[0],
      options: [],
      rank: Rank.Standard,
      voting: false,
      present: true,
      password: '',
      customDaisName: 'Dais',
      user: initialUser,
      admins: {},
    };
  }

  onAdmins = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ admins: (snap && snap.val()) || {} });
  };

  componentDidMount() {
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
    this.adminsRef.off('value', this.onAdmins);
    if (this.state.unsubscribeAuth) {
      this.state.unsubscribeAuth();
    }
  }

  renderMemberItem = (id: MemberID, member: MemberData, fref: firebase.database.Reference) => {
    const isDais = isDaisMember(member);

    return (
      <Table.Row key={id}>
        <Table.Cell>
          <Flag name={nameToFlagCode(member.name)} />
          {member.name}
          {isDais && (
            <Label
              size="mini"
              style={{
                marginLeft: '0.5em',
                backgroundColor: 'var(--wumun-plum)',
                color: 'var(--wumun-text-light)',
              }}
            >
              Dais (Non-Voting)
            </Label>
          )}
        </Table.Cell>
        <Table.Cell>
          <Dropdown
            search
            selection
            fluid
            options={RANK_OPTIONS}
            onChange={(e, d) => {
              const newRank = d.value as Rank;
              fref.child('rank').set(newRank);
              if (newRank === Rank.Dais) {
                fref.child('present').set(false);
                fref.child('voting').set(false);
              }
            }}
            value={member.rank}
          />
        </Table.Cell>
        <Table.Cell collapsing>
          <Checkbox
            toggle
            disabled={isDais}
            checked={isDais ? false : member.present}
            onChange={checkboxHandler<MemberData>(fref, 'present')}
          />
        </Table.Cell>
        <Table.Cell collapsing>
          <Checkbox
            toggle
            disabled={isDais}
            checked={isDais ? false : member.voting}
            onChange={checkboxHandler<MemberData>(fref, 'voting')}
          />
        </Table.Cell>
        <Table.Cell>
          <Input
            size="small"
            fluid
            placeholder="Blank (none)"
            value={member.password ?? ''}
            onChange={fieldHandler<MemberData>(fref, 'password')}
          />
        </Table.Cell>
        <Table.Cell collapsing>
          <Button
            className="members__button--remove-member"
            icon="trash"
            negative
            basic
            onClick={() => fref.remove()}
          />
        </Table.Cell>
      </Table.Row>
    );
  }

  canPushMember = (member: MemberOption) => {
    const members = this.props.committee.members || {};
    const memberNames = Object.keys(members).map(id =>
      canonicalCountryName(members[id].name)
    );

    return !_.includes(memberNames, canonicalCountryName(member.text));
  }

  pushSelectedMember = (event: React.MouseEvent<HTMLButtonElement>, data: ButtonProps) => {
    event.preventDefault();

    const committeeID: CommitteeID = this.props.match.params.committeeID;
    const isDais = this.state.rank === Rank.Dais;
    const member: MemberData = {
      name: this.state.member.text,
      rank: this.state.rank,
      present: isDais ? false : this.state.present,
      voting: isDais ? false : this.state.voting,
      password: this.state.password.trim(),
    };

    pushMember(committeeID, member);
    this.setState({ password: '' });
  }

  pushDaisMember = () => {
    const committeeID: CommitteeID = this.props.match.params.committeeID;
    const name = this.state.customDaisName.trim() || 'Dais';
    const members = this.props.committee.members || {};
    const exists = Object.values(members).some(
      m => m && m.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) return;

    pushMember(committeeID, {
      name,
      rank: Rank.Dais,
      present: false,
      voting: false,
      password: '',
    });
  }

  setMember = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps) => {
    const { options: newOptions } = this.state;
    const newMember = [...newOptions, ...COUNTRY_OPTIONS].filter(c => c.value === data.value)[0];

    if (newMember) {
      this.setState({ member: newMember });
    }
  }

  setPresent = (event: React.FormEvent<HTMLInputElement>, data: CheckboxProps) => {
    this.setState({ present: data.checked ?? false });
  }

  setVoting = (event: React.FormEvent<HTMLInputElement>, data: CheckboxProps) => {
    this.setState({ voting: data.checked ?? false });
  }

  setRank = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps) => {
    const rank = (data.value as Rank) ?? Rank.Standard;
    this.setState({
      rank,
      present: rank === Rank.Dais ? false : this.state.present,
      voting: rank === Rank.Dais ? false : this.state.voting,
    });
  }

  handleAdd = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps) => {
    const newMember = nameToMemberOption((data.value as number | string).toString());

    if (_.includes(COUNTRY_OPTIONS, newMember)) {
      this.setState({ member: newMember });
    } else {
      const newOptions = [newMember, ...this.state.options];
      this.setState({ member: newMember, options: newOptions });
    }
  }

  gotoGSL = () => {
    const { committeeID } = this.props.match.params;

    this.props.history
      .push(`/committees/${committeeID}/caucuses/gsl`);

    logClickGeneralSpeakersList();
  }

  renderAdder() {
    const { handleAdd, setMember, setRank, setPresent, setVoting } = this;
    const {
      present: newMemberPresent,
      voting: newMemberVoting,
      options: newOptions,
      member,
      rank,
      password,
    } = this.state;
    const isDais = rank === Rank.Dais;

    return (
      <Table.Row>
        <Table.HeaderCell>
          <Dropdown
            icon="search"
            className="adder__dropdown--select-member"
            placeholder="Select preset member"
            search={searchCountryOptions}
            selection
            fluid
            allowAdditions
            error={!this.canPushMember(member)}
            options={[...newOptions, ...COUNTRY_OPTIONS]}
            onAddItem={handleAdd}
            onChange={setMember}
            value={member.key}
          />
        </Table.HeaderCell>
        <Table.HeaderCell>
          <Dropdown
            className="adder__dropdown--select-rank"
            search
            selection
            fluid
            options={RANK_OPTIONS}
            onChange={setRank}
            value={rank}
          />
        </Table.HeaderCell>
        <Table.HeaderCell collapsing>
          <Checkbox
            className="adder__checkbox--toggle-present"
            toggle
            disabled={isDais}
            checked={isDais ? false : newMemberPresent}
            onChange={setPresent}
          />
        </Table.HeaderCell>
        <Table.HeaderCell collapsing>
          <Checkbox
            className="adder__checkbox--toggle-voting"
            toggle
            disabled={isDais}
            checked={isDais ? false : newMemberVoting}
            onChange={setVoting}
          />
        </Table.HeaderCell>
        <Table.HeaderCell>
          <Input
            size="small"
            fluid
            placeholder="Blank (default)"
            value={password}
            onChange={e => this.setState({ password: e.currentTarget.value })}
          />
        </Table.HeaderCell>
        <Table.HeaderCell>
          <Button
            className="adder__button--add-member"
            icon="plus"
            primary
            basic
            disabled={!this.canPushMember(member)}
            onClick={this.pushSelectedMember}
          />
        </Table.HeaderCell>
      </Table.Row>
    );
  }

  renderCommitteeMembers = (props: { data: CommitteeData; fref: firebase.database.Reference }) => {
    const members = this.props.committee.members || {};
    const memberItems = Object.keys(members).map(id =>
      this.renderMemberItem(id, members[id], props.fref.child('members').child(id))
    );

    return (
      <>
        <Segment size="small" style={{ marginBottom: '1em' }}>
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
              <strong>Add Dais / Chair Member (For Posts &amp; Notifications Only)</strong>
              <div style={{ fontSize: '0.88em', color: 'var(--wumun-brown)' }}>
                Dais members are never counted toward quorum, attendance, or voting thresholds.
              </div>
            </div>
            <Input
              size="small"
              placeholder="Dais / Chair Name"
              value={this.state.customDaisName}
              onChange={e => this.setState({ customDaisName: e.currentTarget.value })}
              action={{
                content: 'Add Dais Member',
                icon: 'gavel',
                onClick: this.pushDaisMember,
                style: {
                  backgroundColor: 'var(--wumun-plum)',
                  color: 'var(--wumun-text-light)',
                },
              }}
            />
          </div>
        </Segment>

        <Table compact celled definition>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell />
              <Table.HeaderCell>Rank</Table.HeaderCell>
              <Table.HeaderCell>Present</Table.HeaderCell>
              <Table.HeaderCell>Voting</Table.HeaderCell>
              <Table.HeaderCell>Password</Table.HeaderCell>
              <Table.HeaderCell />
            </Table.Row>
          </Table.Header>

          <Table.Header fullWidth>
            {this.renderAdder()}
          </Table.Header>

          <Table.Body>
            {memberItems.reverse()}
          </Table.Body>
        </Table>
        {memberItems.length === 0 ? (
          <Message error>Add at least one committee member to proceed</Message>
        ) : (
          <Button as="a" onClick={this.gotoGSL} primary fluid>
            General Speakers' List
            <Icon name="arrow right" />
          </Button>
        )}
      </>
    );
  }

  render() {
    const { committee, fref } = this.props;
    const { user, admins } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);

    if (!isStaff) {
      return (
        <Container text style={{ padding: '2em 0em' }}>
          <Message warning icon>
            <Icon name="lock" />
            <Message.Content>
              <Message.Header>Dais / Staff Access Only</Message.Header>
              <p>
                Committee Setup and Member Management can only be modified by the Dais (Committee
                Head, Moderators, or Conference Admins).
              </p>
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
      <Container style={{ padding: '1em 0em 1.5em' }}>
        <Helmet>
          <title>{`Setup - ${committee.name || 'Committee'} - WUMUN`}</title>
        </Helmet>
        <Grid columns="2" stackable>
          <Grid.Row>
            <Grid.Column width={10}>
              <TemplateAdder committeeID={this.props.match.params.committeeID} />
              {this.renderCommitteeMembers({ data: committee, fref })}
            </Grid.Column>
            <Grid.Column width={6}>
              <CommitteeStatsTable verbose={true} data={committee} />
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </Container>
    );
  }
}
