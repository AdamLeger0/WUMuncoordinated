import * as React from 'react';
import firebase from 'firebase/compat/app';
import FileSaver from 'file-saver';
import { RouteComponentProps } from 'react-router';
import { URLParameters } from '../types';
import {
  Button,
  Container,
  DropdownProps,
  Feed,
  Flag,
  Form,
  Icon,
  Message,
  Progress,
  Segment,
  SemanticICONS,
  Tab,
  TextAreaProps
} from 'semantic-ui-react';
import {
  canonicalCountryName,
  isDaisMember,
  MemberOption,
  nameToFlagCode,
  nameToMemberOption
} from '../modules/member';
import Loading from '../components/Loading';
import { DEFAULT_AMENDMENT, putAmendment, ResolutionID } from '../models/resolution';
import { CommitteeData, CommitteeID, recoverMemberOptions } from '../models/committee';
import { File, Link, PostData, PostID, PostType, Text } from '../models/post';
import { COUNTRY_OPTIONS } from '../constants';
import { Helmet } from 'react-helmet';
import { AdminRecord, isCommitteeStaff } from '../models/conference';
import {
  DelegateSession,
  getDelegateSession,
  isReadOnlyForUser,
  subscribeDelegateSession,
  validateDelegateSession
} from '../modules/delegate-session';

const TEXT_ICON: SemanticICONS = 'align left';
const FILE_ICON: SemanticICONS = 'file outline';
const LINK_ICON: SemanticICONS = 'linkify';

interface EntryProps {
  committeeID: CommitteeID;
  post: PostData;
  canDelete: boolean;
  canPromote: boolean;
  onDelete: () => void;
  onPromoteToAmendment: () => void;
}

interface EntryState {
  metadata?: any;
}

class Entry extends React.Component<EntryProps, EntryState> {
  constructor(props: EntryProps) {
    super(props);

    this.state = {};
  }

  recoverStorageRef = (): firebase.storage.Reference | null => {
    const { committeeID, post } = this.props;

    if (post.type === PostType.File) {
      const storageRef = firebase.storage().ref();
      return storageRef.child('committees').child(committeeID).child(post.filename);
    } else {
      return null;
    }
  };

  componentDidMount() {
    const { post } = this.props;
    const { timestamp } = this.props.post;

    if (!timestamp && post.type === PostType.File) {
      this.recoverStorageRef()!
        .getMetadata()
        .then((metadata: any) => {
          this.setState({ metadata: metadata });
        });
    }
  }

  download = (filename: string) => () => {
    this.recoverStorageRef()!
      .getDownloadURL()
      .then((url: any) => {
        var xhr = new XMLHttpRequest();
        xhr.responseType = 'blob';
        xhr.onload = () => {
          const blob = xhr.response;
          FileSaver.saveAs(blob, filename);
        };
        xhr.open('GET', url);
        xhr.send();
      });
  };

  renderDate = (action: 'Posted' | 'Uploaded') => {
    const { post } = this.props;

    let sinceText: string = action;

    if (post.timestamp) {
      const millis = new Date().getTime() - new Date(post.timestamp).getTime();

      const secondsSince = millis / 1000;

      if (secondsSince < 60) {
        sinceText = `${action} ${Math.round(secondsSince)} seconds ago`;
      } else if (secondsSince < 60 * 60) {
        sinceText = `${action} ${Math.round(secondsSince / 60)} minutes ago`;
      } else if (secondsSince < 60 * 60 * 24) {
        sinceText = `${action} ${Math.round(secondsSince / (60 * 60))} hours ago`;
      } else {
        sinceText = `${action} ${Math.round(secondsSince / (60 * 60 * 24))} days ago`;
      }
    }

    return sinceText;
  };

  renderText = (post: Text) => {
    const { canDelete, canPromote } = this.props;
    return (
      <Feed.Event>
        <Feed.Label icon={TEXT_ICON} />
        <Feed.Content>
          <Feed.Summary>
            <Feed.User>
              <Flag name={nameToFlagCode(post.uploader)} /> {post.uploader}
            </Feed.User>
            <Feed.Date>{this.renderDate('Posted')}</Feed.Date>
          </Feed.Summary>
          <Feed.Extra style={{ whiteSpace: 'pre-wrap' }} text>
            {post.body}
          </Feed.Extra>
          {(canDelete || (post.forResolution && canPromote)) && (
            <Feed.Meta>
              {canDelete && (
                // eslint-disable-next-line jsx-a11y/anchor-is-valid
                <a onClick={this.props.onDelete}>Delete</a>
              )}
              {post.forResolution && canPromote && (
                // eslint-disable-next-line jsx-a11y/anchor-is-valid
                <a onClick={this.props.onPromoteToAmendment}>Create amendment</a>
              )}
            </Feed.Meta>
          )}
        </Feed.Content>
      </Feed.Event>
    );
  };

  renderFile = (post: File) => {
    const { canDelete } = this.props;
    return (
      <Feed.Event>
        <Feed.Label icon={FILE_ICON} />
        <Feed.Content>
          <Feed.Summary>
            <Feed.User>
              <Flag name={nameToFlagCode(post.uploader)} /> {post.uploader}
            </Feed.User>{' '}
            uploaded a file
            <Feed.Date>{this.renderDate('Uploaded')}</Feed.Date>
          </Feed.Summary>
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
          <Feed.Extra>
            <a onClick={this.download(post.filename)}>{post.filename}</a>
          </Feed.Extra>
          {canDelete && (
            <Feed.Meta>
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a onClick={this.props.onDelete}>Delete</a>
            </Feed.Meta>
          )}
        </Feed.Content>
      </Feed.Event>
    );
  };

  renderLink = (post: Link) => {
    const { canDelete } = this.props;
    return (
      <Feed.Event>
        <Feed.Label icon={LINK_ICON} />
        <Feed.Content>
          <Feed.Summary>
            <Feed.User>
              <Flag name={nameToFlagCode(post.uploader)} /> {post.uploader}
            </Feed.User>{' '}
            posted a link
            <Feed.Date>{this.renderDate('Posted')}</Feed.Date>
          </Feed.Summary>
          <Feed.Extra>
            <a href={post.url}>{post.name || post.url}</a>
          </Feed.Extra>
          {post.name && (
            <Feed.Meta>
              <a href={post.url}>{post.url}</a>
            </Feed.Meta>
          )}
          <br />
          {canDelete && (
            <Feed.Meta>
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a onClick={this.props.onDelete}>Delete</a>
            </Feed.Meta>
          )}
        </Feed.Content>
      </Feed.Event>
    );
  };

  render() {
    const { post } = this.props;

    switch (post.type) {
      case PostType.File:
        return this.renderFile(post);
      case PostType.Link:
        return this.renderLink(post);
      case PostType.Text:
        return this.renderText(post);
      default:
        return this.renderFile(post);
    }
  }
}

interface State {
  committee?: CommitteeData;
  committeeFref: firebase.database.Reference;
  progress?: number;
  file?: any;
  state?: firebase.storage.TaskState;
  link: string;
  body: string;
  errorCode?: string;
  uploader?: MemberOption;
  filtered: MemberOption['key'][];
  user: firebase.User | null;
  admins: Record<string, AdminRecord | boolean>;
  session: DelegateSession | null;
  unsubscribeAuth?: () => void;
  unsubscribeSession?: () => void;
}

interface Props extends RouteComponentProps<URLParameters> {
  forResolution?: ResolutionID;
}

export default class Files extends React.Component<Props, State> {
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
      link: '',
      body: '',
      committeeFref: firebase.database().ref('committees').child(match.params.committeeID),
      filtered: [],
      user: initialUser,
      admins: {},
      session: getDelegateSession(match.params.committeeID)
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      const val = committee.val() as CommitteeData | null;
      this.setState(prev => {
        let nextUploader = prev.uploader;
        if (!nextUploader && val?.members) {
          const daisEntry = Object.values(val.members).find(m => m && isDaisMember(m));
          if (daisEntry) {
            nextUploader = nameToMemberOption(daisEntry.name);
          }
        }
        return { committee: val || undefined, uploader: nextUploader };
      });
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

  getEffectiveUploaderName = (): string | undefined => {
    const { committee, user, admins, session, uploader } = this.state;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);

    if (!isStaff) {
      if (validSession?.role === 'delegate' && validSession.memberName) {
        return validSession.memberName;
      }
      return undefined;
    }

    return uploader ? uploader.text : undefined;
  };

  handleError = (error: any) => {
    this.setState({ errorCode: error.code });
  };

  handleSnapshot = (snapshot: any) => {
    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
    this.setState({ progress: progress, state: snapshot.state });
  };

  handleComplete = (uploadTask: firebase.storage.UploadTask) => () => {
    const uploaderName = this.getEffectiveUploaderName();
    const { forResolution } = this.props;

    let file: File = {
      type: PostType.File,
      timestamp: new Date().getTime(),
      filename: uploadTask.snapshot.ref.name,
      uploader: uploaderName || 'Unknown'
    };

    if (forResolution) {
      file = {
        ...file,
        forResolution
      };
    }

    this.state.committeeFref.child('files').push().set(file);

    this.setState({ state: uploadTask.snapshot.state });

    this.clear();
  };

  onFileChange = (event: any) => {
    this.setState({ file: event.target.files[0] });
  };

  clear = () => {
    this.setState({
      link: '',
      body: '',
      file: undefined
    });
  };

  postFile = () => {
    const { handleSnapshot, handleError, handleComplete } = this;
    const { file, committee } = this.state;
    const user = firebase.auth().currentUser;

    const { committeeID } = this.props.match.params;

    if (!committee?.creatorUid) {
      this.setState({ errorCode: 'storage/unauthorized' });
      return;
    }

    const storageRef = firebase.storage().ref();

    const customMetadata: Record<string, string> = {
      committeeCreatorUid: committee.creatorUid
    };

    if (user) {
      customMetadata.owner = user.uid;
    }

    const metadata = {
      contentType: file.type,
      customMetadata
    };

    var uploadTask = storageRef
      .child('committees')
      .child(committeeID)
      .child(file.name)
      .put(file, metadata);

    uploadTask.on(
      firebase.storage.TaskEvent.STATE_CHANGED,
      handleSnapshot,
      handleError,
      handleComplete(uploadTask)
    );
  };

  postLink = () => {
    const { link, body } = this.state;
    const { forResolution } = this.props;
    const uploaderName = this.getEffectiveUploaderName();
    if (!uploaderName) return;

    let linkData: Link = {
      type: PostType.Link,
      timestamp: new Date().getTime(),
      name: body,
      url: link,
      uploader: uploaderName
    };

    if (forResolution) {
      linkData = {
        ...linkData,
        forResolution
      };
    }

    this.state.committeeFref.child('files').push().set(linkData);

    this.clear();
  };

  postText = () => {
    const { body } = this.state;
    const { forResolution } = this.props;
    const uploaderName = this.getEffectiveUploaderName();
    if (!uploaderName) return;

    let linkData: Text = {
      type: PostType.Text,
      timestamp: new Date().getTime(),
      body: body,
      uploader: uploaderName
    };

    if (forResolution) {
      linkData = {
        ...linkData,
        forResolution
      };
    }

    this.state.committeeFref.child('files').push().set(linkData);

    this.clear();
  };

  setMember = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps): void => {
    const memberOptions = recoverMemberOptions(this.state.committee);

    this.setState({ uploader: memberOptions.filter(c => c.value === data.value)[0] });
  };

  renderPosterSelector = (label: string, isStaff: boolean, uploaderName?: string) => {
    const { committee, uploader } = this.state;
    const memberOptions = recoverMemberOptions(committee);

    if (isStaff) {
      return (
        <Form.Dropdown
          icon="search"
          key="uploader"
          required
          value={uploader ? uploader.key : undefined}
          search
          fluid
          selection
          error={!uploader}
          onChange={this.setMember}
          options={memberOptions}
          label={label}
        />
      );
    }

    return (
      <Form.Field key="uploader-locked">
        <label>{label} (Your Delegation)</label>
        <Segment compact style={{ margin: 0, padding: '0.55em 0.85em' }}>
          {uploaderName ? (
            <>
              <Flag name={nameToFlagCode(uploaderName)} />
              <strong>{uploaderName}</strong>
            </>
          ) : (
            'None'
          )}
        </Segment>
      </Form.Field>
    );
  };

  renderUploader = (isStaff: boolean, uploaderName?: string) => {
    const { progress, state, errorCode, file } = this.state;

    return (
      <React.Fragment>
        <Progress
          percent={Math.round(progress || 0)}
          progress
          warning={state === firebase.storage.TaskState.PAUSED}
          success={state === firebase.storage.TaskState.SUCCESS}
          error={!!errorCode}
          active={true}
          label={errorCode}
        />
        <Form onSubmit={this.postFile}>
          <input type="file" onChange={this.onFileChange} />
          <Form.Group widths="equal">
            {this.renderPosterSelector('Uploader', isStaff, uploaderName)}
            <Button
              type="submit"
              loading={state === firebase.storage.TaskState.RUNNING}
              disabled={!file || !uploaderName}
            >
              Upload
            </Button>
          </Form.Group>
        </Form>
      </React.Fragment>
    );
  };

  setBody = (event: React.FormEvent<HTMLTextAreaElement>, data: TextAreaProps) => {
    this.setState({ body: data.value!.toString() });
  };

  setName = (e: React.FormEvent<HTMLInputElement>) => {
    this.setState({ body: e.currentTarget.value });
  };

  setLink = (e: React.FormEvent<HTMLInputElement>) => {
    this.setState({ link: e.currentTarget.value });
  };

  setFilter = (event: React.SyntheticEvent<HTMLElement>, data: DropdownProps) => {
    // @ts-ignore
    this.setState({ filtered: data.value });
  };

  renderFilter = () => {
    const { committee } = this.state;

    const memberOptions = recoverMemberOptions(committee);

    return (
      <Form>
        <Form.Dropdown
          icon="search"
          value={this.state.filtered.map(x => x)}
          search
          multiple
          selection
          onChange={this.setFilter}
          options={memberOptions}
          label="View posts only by"
        />
      </Form>
    );
  };

  deletePost = (postID: PostID) => () => {
    this.state.committeeFref.child('files').child(postID).remove();
  };

  promoteToAmendment = (post: PostData) => () => {
    const { committee, user, admins } = this.state;
    if (!isCommitteeStaff(user, committee, admins)) return;

    const { committeeID } = this.props.match.params;

    if (post.type !== PostType.Text) {
      return;
    }

    if (!post.forResolution) {
      return;
    }

    putAmendment(committeeID, post.forResolution, {
      ...DEFAULT_AMENDMENT,
      proposer: post.uploader,
      text: post.body
    });

    this.props.history.push(
      `/committees/${committeeID}/resolutions/${post.forResolution}/amendments`
    );
  };

  renderLinker = (isStaff: boolean, uploaderName?: string) => {
    const { body, link } = this.state;

    return (
      <Form onSubmit={this.postLink}>
        <Form.Input
          value={body}
          onChange={this.setName}
          autoHeight
          label="Name"
          rows={1}
        />
        <Form.Input
          label="Link"
          required
          error={!link}
          value={link}
          onChange={this.setLink}
          placeholder="https://docs.google.com/document/x"
        />
        <Form.Group widths="equal">
          {this.renderPosterSelector('Poster', isStaff, uploaderName)}
          <Button type="submit" disabled={!link || !uploaderName}>
            Post
          </Button>
        </Form.Group>
      </Form>
    );
  };

  renderPoster = (isStaff: boolean, uploaderName?: string) => {
    const { body } = this.state;

    return (
      <Form onSubmit={this.postText}>
        <Form.TextArea
          value={body}
          onChange={this.setBody}
          autoHeight={true}
          label="Body"
          rows={3}
        />
        <Form.Group widths="equal">
          {this.renderPosterSelector('Poster', isStaff, uploaderName)}
          <Button type="submit" disabled={!body || !uploaderName}>
            Post
          </Button>
        </Form.Group>
      </Form>
    );
  };

  isFiltered = (post: PostData) => {
    const { filtered } = this.state;

    if (filtered.length === 0) {
      return true;
    }

    if (filtered.includes(post.uploader)) {
      return true;
    }

    return COUNTRY_OPTIONS.filter(x => filtered.includes(x.key))
      .map(x => x.text)
      .includes(canonicalCountryName(post.uploader));
  };

  isResolutionAssociated = (post: PostData) => {
    if (!this.props.forResolution && post.forResolution) {
      return false;
    }

    if (this.props.forResolution) {
      return this.props.forResolution === post.forResolution;
    }

    return true;
  };

  render() {
    const { committee, user, admins, session } = this.state;
    const { committeeID } = this.props.match.params;
    const isStaff = isCommitteeStaff(user, committee, admins);
    const validSession = validateDelegateSession(session, committee);
    const readOnly = isReadOnlyForUser(isStaff, committee, validSession);
    const uploaderName = this.getEffectiveUploaderName();

    const files = committee ? committee.files || {} : {};

    const panes = [
      {
        menuItem: { key: 'Text', icon: TEXT_ICON, content: 'Text' },
        render: () => <Tab.Pane>{this.renderPoster(isStaff, uploaderName)}</Tab.Pane>
      },
      {
        menuItem: { key: 'Link', icon: LINK_ICON, content: 'Link' },
        render: () => <Tab.Pane>{this.renderLinker(isStaff, uploaderName)}</Tab.Pane>
      },
      {
        menuItem: { key: 'File', icon: FILE_ICON, content: 'File' },
        render: () => <Tab.Pane>{this.renderUploader(isStaff, uploaderName)}</Tab.Pane>
      }
    ];

    const canCreatePost = isStaff || (!readOnly && Boolean(uploaderName));

    const inner = (
      <>
        {canCreatePost ? (
          <Tab menu={{ attached: true, tabular: false }} panes={panes} />
        ) : (
          <Message size="small" info>
            <Icon name="eye" /> Viewing committee posts and announcements in read-only mode.
          </Message>
        )}
        <div>&nbsp;</div>
        {this.renderFilter()}
        <Feed size="large">
          {committee ? (
            Object.keys(files)
              .reverse()
              .filter(key => this.isFiltered(files[key]))
              .filter(key => this.isResolutionAssociated(files[key]))
              .map(key => {
                const post = files[key];
                const canDelete = Boolean(
                  isStaff ||
                    (!readOnly &&
                      validSession?.role === 'delegate' &&
                      validSession.memberName === post.uploader)
                );
                return (
                  <Entry
                    key={key}
                    canDelete={canDelete}
                    canPromote={isStaff}
                    onDelete={this.deletePost(key)}
                    onPromoteToAmendment={this.promoteToAmendment(post)}
                    committeeID={committeeID}
                    post={post}
                  />
                );
              })
          ) : (
            <Loading />
          )}
        </Feed>
      </>
    );

    return this.props.forResolution ? (
      inner
    ) : (
      <Container text style={{ padding: '1em 0em' }}>
        <Helmet>
          <title>{`Posts - WUMUN`}</title>
        </Helmet>
        {inner}
      </Container>
    );
  }
}
