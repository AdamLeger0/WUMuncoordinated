import firebase from 'firebase/compat/app';
import { CommitteeData, CommitteeID } from './committee';

export const DEFAULT_ADMIN_EMAILS: string[] = [
  'legera2@winthrop.edu',
];

export interface ConferenceSettings {
  conferenceName: string;
  subtitle: string;
  dates: string;
  allCommitteesLocked: boolean;
}

export const DEFAULT_CONFERENCE_SETTINGS: ConferenceSettings = {
  conferenceName: 'Winthrop University Model UN',
  subtitle: 'WUMUN Conference Session',
  dates: '2026 Conference',
  allCommitteesLocked: false,
};

export type NotificationSeverity =
  | 'info'
  | 'warning'
  | 'urgent'
  | 'success'
  | 'navy'
  | 'plum'
  | 'teal'
  | 'brown';

export interface NotificationPaletteSpec {
  severity: NotificationSeverity;
  label: string;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
}

export const NOTIFICATION_PALETTES: Record<NotificationSeverity, NotificationPaletteSpec> = {
  info: {
    severity: 'info',
    label: 'Main UN Blue (#5b92e5 — Light Text)',
    backgroundColor: 'var(--wumun-blue)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-navy)',
    badgeBg: 'var(--wumun-navy)',
    badgeText: 'var(--wumun-text-light)',
  },
  urgent: {
    severity: 'urgent',
    label: 'Color 2 Urgent Red (#ba5959 — Light Text)',
    backgroundColor: 'var(--wumun-red)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-plum)',
    badgeBg: 'var(--wumun-plum)',
    badgeText: 'var(--wumun-text-light)',
  },
  warning: {
    severity: 'warning',
    label: 'Color 3 Highlight Yellow (#eba113 — Dark Text)',
    backgroundColor: 'var(--wumun-yellow)',
    textColor: 'var(--wumun-text-dark)',
    borderColor: 'var(--wumun-brown)',
    badgeBg: 'var(--wumun-brown)',
    badgeText: 'var(--wumun-text-light)',
  },
  success: {
    severity: 'success',
    label: 'Color 4 Affirmative Green (#688667 — Light Text)',
    backgroundColor: 'var(--wumun-green)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-teal)',
    badgeBg: 'var(--wumun-navy)',
    badgeText: 'var(--wumun-text-light)',
  },
  brown: {
    severity: 'brown',
    label: 'Secondary Brown (#38280d — Light Text)',
    backgroundColor: 'var(--wumun-brown)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-yellow)',
    badgeBg: 'var(--wumun-yellow)',
    badgeText: 'var(--wumun-text-dark)',
  },
  plum: {
    severity: 'plum',
    label: 'Secondary Plum (#4b1931 — Light Text)',
    backgroundColor: 'var(--wumun-plum)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-red)',
    badgeBg: 'var(--wumun-yellow)',
    badgeText: 'var(--wumun-text-dark)',
  },
  navy: {
    severity: 'navy',
    label: 'Secondary Navy (#011f3d — Light Text)',
    backgroundColor: 'var(--wumun-navy)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-blue)',
    badgeBg: 'var(--wumun-blue)',
    badgeText: 'var(--wumun-text-light)',
  },
  teal: {
    severity: 'teal',
    label: 'Secondary Teal (#006f79 — Light Text)',
    backgroundColor: 'var(--wumun-teal)',
    textColor: 'var(--wumun-text-light)',
    borderColor: 'var(--wumun-green)',
    badgeBg: 'var(--wumun-yellow)',
    badgeText: 'var(--wumun-text-dark)',
  },
};

export function getNotificationPalette(
  severity?: NotificationSeverity
): NotificationPaletteSpec {
  if (severity && NOTIFICATION_PALETTES[severity]) {
    return NOTIFICATION_PALETTES[severity];
  }
  return NOTIFICATION_PALETTES.info;
}

export interface GlobalNotification {
  title: string;
  message: string;
  severity: NotificationSeverity;
  targetCommitteeID?: string;
  active: boolean;
  createdAt: number;
  authorEmail?: string;
}

export interface AdminRecord {
  uid: string;
  email: string;
  addedAt: number;
}

export interface ApprovedUserRecord {
  uid?: string;
  email: string;
  addedAt: number;
  addedBy?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  lastSeen: number;
}

export function sanitizeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/[.#$[\]/]/g, '_');
}

export function syncUserProfile(user: firebase.User | null): void {
  if (!user || !user.uid) return;
  try {
    const profile: UserProfile = {
      uid: user.uid,
      email: user.email || 'anonymous',
      lastSeen: Date.now(),
    };
    firebase.database().ref('users').child(user.uid).update(profile);
  } catch (e) {
    // Ignore sync errors when offline
  }
}

export function isConferenceAdmin(
  user: firebase.User | null | undefined,
  admins?: Record<string, AdminRecord | boolean>
): boolean {
  if (!user) return false;
  if (user.email) {
    const lower = user.email.trim().toLowerCase();
    if (DEFAULT_ADMIN_EMAILS.includes(lower)) {
      return true;
    }
  }
  if (!admins) return false;
  if (admins[user.uid]) return true;
  if (user.email) {
    const emailKey = sanitizeEmailKey(user.email);
    if (admins[emailKey]) return true;
    const matched = Object.values(admins).some(
      a => typeof a === 'object' && a !== null && a.email?.toLowerCase() === user.email!.toLowerCase()
    );
    if (matched) return true;
  }
  return false;
}

export function isApprovedUser(
  user: firebase.User | null | undefined,
  admins?: Record<string, AdminRecord | boolean>,
  approvedUsers?: Record<string, ApprovedUserRecord | boolean>,
  committees?: Record<CommitteeID, CommitteeData>
): boolean {
  if (!user) return false;
  if (isConferenceAdmin(user, admins)) return true;

  if (approvedUsers) {
    if (approvedUsers[user.uid]) return true;
    if (user.email) {
      const emailKey = sanitizeEmailKey(user.email);
      if (approvedUsers[emailKey]) return true;
      const matched = Object.values(approvedUsers).some(
        u =>
          typeof u === 'object' &&
          u !== null &&
          u.email?.toLowerCase() === user.email!.toLowerCase()
      );
      if (matched) return true;
    }
  }

  if (committees) {
    const isStaffOnAny = Object.values(committees).some(c =>
      isCommitteeStaff(user, c, admins)
    );
    if (isStaffOnAny) return true;
  }

  return false;
}

export function isCommitteeStaff(
  user: firebase.User | null | undefined,
  committee?: CommitteeData,
  admins?: Record<string, AdminRecord | boolean>
): boolean {
  if (!user) return false;
  if (isConferenceAdmin(user, admins)) return true;
  if (!committee) return false;
  if (committee.creatorUid && committee.creatorUid === user.uid) return true;
  if (
    user.email &&
    committee.creatorEmail &&
    committee.creatorEmail.toLowerCase() === user.email.toLowerCase()
  ) {
    return true;
  }
  const mods = committee.moderators || {};
  if (mods[user.uid]) return true;
  if (user.email) {
    const emailKey = sanitizeEmailKey(user.email);
    if (mods[emailKey]) return true;
    const matchedByEmail = Object.values(mods).some(
      m => m && m.email && m.email.toLowerCase() === user.email!.toLowerCase()
    );
    if (matchedByEmail) return true;
  }
  return false;
}
