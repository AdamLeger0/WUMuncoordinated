import * as React from 'react';
import firebase from 'firebase/compat/app';
import { Container, Icon } from 'semantic-ui-react';
import {
  ConferenceSettings,
  DEFAULT_CONFERENCE_SETTINGS,
  getNotificationPalette,
  GlobalNotification,
} from '../models/conference';

interface Props {
  committeeID?: string;
}

interface State {
  notifications: Record<string, GlobalNotification>;
  settings: ConferenceSettings;
  dismissedIds: Record<string, boolean>;
}

export default class GlobalBanner extends React.Component<Props, State> {
  private notifRef?: firebase.database.Reference;
  private settingsRef?: firebase.database.Reference;

  constructor(props: Props) {
    super(props);
    this.state = {
      notifications: {},
      settings: DEFAULT_CONFERENCE_SETTINGS,
      dismissedIds: {},
    };
  }

  onNotifications = (snap: firebase.database.DataSnapshot | null) => {
    this.setState({ notifications: (snap && snap.val()) || {} });
  };

  onSettings = (snap: firebase.database.DataSnapshot | null) => {
    const val = snap && snap.val();
    this.setState({
      settings: {
        ...DEFAULT_CONFERENCE_SETTINGS,
        ...(val || {}),
      },
    });
  };

  componentDidMount() {
    this.notifRef = firebase.database().ref('conference/notifications');
    this.settingsRef = firebase.database().ref('conference/settings');
    this.notifRef.on('value', this.onNotifications);
    this.settingsRef.on('value', this.onSettings);
  }

  componentWillUnmount() {
    if (this.notifRef) {
      this.notifRef.off('value', this.onNotifications);
    }
    if (this.settingsRef) {
      this.settingsRef.off('value', this.onSettings);
    }
  }

  dismiss = (id: string) => {
    this.setState(prev => ({
      dismissedIds: { ...prev.dismissedIds, [id]: true },
    }));
  };

  render() {
    const { committeeID } = this.props;
    const { notifications, settings, dismissedIds } = this.state;

    const activeList = Object.entries(notifications || {})
      .filter(([id, n]) => {
        if (!n || !n.active || dismissedIds[id]) return false;
        if (
          n.targetCommitteeID &&
          n.targetCommitteeID !== 'all' &&
          n.targetCommitteeID !== committeeID
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

    if (activeList.length === 0 && !settings.allCommitteesLocked) {
      return null;
    }

    return (
      <Container style={{ paddingTop: '0.75em', paddingBottom: '0.35em' }}>
        {settings.allCommitteesLocked && (
          <div
            className="wumun-notification-banner wumun-severity-plum"
            style={{
              backgroundColor: 'var(--wumun-plum)',
              color: 'var(--wumun-text-light)',
              border: '3px solid var(--wumun-red)',
              borderRadius: '8px',
              padding: '1em 1.25em',
              marginBottom: '0.65em',
              boxShadow: '0 4px 12px rgba(22, 22, 28, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.85em',
            }}
          >
            <Icon
              name="lock"
              size="large"
              style={{ color: 'var(--wumun-text-light)', margin: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontWeight: 800,
                  fontSize: '1.1em',
                  color: 'var(--wumun-text-light)',
                }}
              >
                Conference Session Locked by Administration
              </div>
              <div
                style={{
                  color: 'var(--wumun-text-light)',
                  marginTop: '0.2em',
                  fontWeight: 500,
                }}
              >
                All committees are currently in read-only / locked state.
              </div>
            </div>
          </div>
        )}
        {activeList.map(([id, n]) => {
          const palette = getNotificationPalette(n.severity);
          const timeStr = n.createdAt
            ? new Date(n.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';

          return (
            <div
              key={id}
              role="alert"
              className={`wumun-notification-banner wumun-severity-${palette.severity}`}
              style={{
                backgroundColor: palette.backgroundColor,
                color: palette.textColor,
                border: `3px solid ${palette.borderColor}`,
                borderRadius: '8px',
                padding: '1em 1.25em',
                marginBottom: '0.65em',
                boxShadow: '0 4px 14px rgba(22, 22, 28, 0.22)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1em',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5em',
                    marginBottom: '0.35em',
                  }}
                >
                  <span
                    style={{
                      backgroundColor: palette.badgeBg,
                      color: palette.badgeText,
                      padding: '0.2em 0.6em',
                      borderRadius: '4px',
                      fontSize: '0.78em',
                      fontWeight: 800,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35em',
                    }}
                  >
                    <Icon
                      name="bullhorn"
                      style={{ color: palette.badgeText, margin: 0 }}
                    />
                    {n.targetCommitteeID && n.targetCommitteeID !== 'all'
                      ? 'Committee Alert'
                      : 'Conference Broadcast'}
                  </span>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: '1.15em',
                      color: palette.textColor,
                    }}
                  >
                    {n.title || 'WUMUN Conference Announcement'}
                  </span>
                  {timeStr && (
                    <span
                      style={{
                        fontSize: '0.85em',
                        fontWeight: 600,
                        color: palette.textColor,
                        opacity: 0.85,
                      }}
                    >
                      • {timeStr}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '1.02em',
                    lineHeight: 1.45,
                    fontWeight: 600,
                    color: palette.textColor,
                  }}
                >
                  {n.message}
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => this.dismiss(id)}
                style={{
                  background: palette.badgeBg,
                  color: palette.badgeText,
                  border: 'none',
                  borderRadius: '4px',
                  padding: '0.35em 0.65em',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85em',
                  flexShrink: 0,
                }}
              >
                Dismiss ✕
              </button>
            </div>
          );
        })}
      </Container>
    );
  }
}
