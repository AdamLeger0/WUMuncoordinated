import { CommitteeData, recoverFeatureLocks } from '../models/committee';
import { isDaisMember, MemberData, MemberID } from './member';

export interface DelegateSession {
  committeeID: string;
  role: 'delegate' | 'observer';
  memberID?: MemberID;
  memberName?: string;
  authenticatedAt: number;
}

const STORAGE_PREFIX = 'wumun_delegation_';
const EVENT_NAME = 'wumun_delegation_changed';

export function getDelegateSession(committeeID: string): DelegateSession | null {
  if (!committeeID || typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${committeeID}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DelegateSession;
    if (parsed && parsed.committeeID === committeeID && (parsed.role === 'delegate' || parsed.role === 'observer')) {
      return parsed;
    }
  } catch (e) {
    // ignore storage errors
  }
  return null;
}

export function setDelegateSession(session: DelegateSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${session.committeeID}`, JSON.stringify(session));
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { committeeID: session.committeeID, session } })
    );
  } catch (e) {
    // ignore storage errors
  }
}

export function clearDelegateSession(committeeID: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${committeeID}`);
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { committeeID, session: null } })
    );
  } catch (e) {
    // ignore storage errors
  }
}

export function subscribeDelegateSession(
  committeeID: string,
  callback: (session: DelegateSession | null) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const custom = event as CustomEvent<{ committeeID: string; session: DelegateSession | null }>;
    if (!custom.detail || custom.detail.committeeID === committeeID) {
      callback(getDelegateSession(committeeID));
    }
  };

  const storageHandler = (event: StorageEvent) => {
    if (!event.key || event.key === `${STORAGE_PREFIX}${committeeID}`) {
      callback(getDelegateSession(committeeID));
    }
  };

  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener('storage', storageHandler);

  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function resolveActiveMember(
  session: DelegateSession | null,
  committee?: CommitteeData
): { memberID: MemberID; member: MemberData } | null {
  if (!session || session.role !== 'delegate' || !committee || !committee.members) {
    return null;
  }

  const members = committee.members;
  if (session.memberID && members[session.memberID] && !isDaisMember(members[session.memberID])) {
    return { memberID: session.memberID, member: members[session.memberID] };
  }

  if (session.memberName) {
    const entry = Object.entries(members).find(
      ([, m]) => m && m.name === session.memberName && !isDaisMember(m)
    );
    if (entry) {
      return { memberID: entry[0], member: entry[1] };
    }
  }

  return null;
}

export function validateDelegateSession(
  session: DelegateSession | null,
  committee?: CommitteeData
): DelegateSession | null {
  if (!session) return null;
  if (!committee) return session;

  const locks = recoverFeatureLocks(committee);

  if (session.role === 'observer') {
    if (locks.disableObservers && !locks.physicalMode) {
      return null;
    }
    return session;
  }

  const resolved = resolveActiveMember(session, committee);
  if (!resolved) {
    return null;
  }

  return {
    ...session,
    memberID: resolved.memberID,
    memberName: resolved.member.name,
  };
}

export function isReadOnlyForUser(
  isStaff: boolean,
  committee?: CommitteeData,
  session?: DelegateSession | null
): boolean {
  if (isStaff) return false;
  if (!committee) return true;
  const locks = recoverFeatureLocks(committee);
  if (committee.locked || locks.physicalMode) return true;
  const valid = validateDelegateSession(session || null, committee);
  if (!valid || valid.role === 'observer') return true;
  return false;
}

