import firebase from 'firebase/compat/app';
import { shortMeetId } from '../utils';

const STORAGE_KEY = 'wumun_rtdb_v1';
const CHANNEL_NAME = 'wumun_rtdb_sync_channel';
const HUB_COMMITTEE_ID = '__wumun_hub__';
// In Muncoordinated's database.rules.json, /committees/$uid/motions/$mid/votes/$vid
// has unconditional ".read": true and ".write": true for all clients across all browsers.
const HUB_SYNC_PATH = `committees/${HUB_COMMITTEE_ID}/motions/__sync__/votes`;

function stripUndefined(val: any): any {
  if (val === undefined) return null;
  if (val === null || typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(stripUndefined);
  }
  const out: Record<string, any> = {};
  Object.keys(val).forEach(k => {
    if (val[k] !== undefined) {
      out[k] = stripUndefined(val[k]);
    }
  });
  return out;
}

function deepClone<T>(val: T): T {
  if (val === undefined || val === null || typeof val !== 'object') return val;
  return JSON.parse(JSON.stringify(val));
}

function normalizePath(p?: string): string[] {
  if (!p) return [];
  return p
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
}

function mergeIncomingTree(
  localTree: Record<string, any>,
  remoteTree: Record<string, any>
): Record<string, any> {
  const deletedSet = new Set<string>([
    ...(Array.isArray(localTree.__deletedCommittees) ? localTree.__deletedCommittees : []),
    ...(Array.isArray(remoteTree.__deletedCommittees) ? remoteTree.__deletedCommittees : []),
  ]);

  const mergedCommittees: Record<string, any> = {
    ...(localTree.committees || {}),
    ...(remoteTree.committees || {}),
  };
  delete mergedCommittees[HUB_COMMITTEE_ID];
  deletedSet.forEach(id => {
    delete mergedCommittees[id];
  });

  const localConf = localTree.conference || {};
  const remoteConf = remoteTree.conference || {};
  const mergedConference: Record<string, any> = {
    ...localConf,
    ...remoteConf,
    admins: { ...(localConf.admins || {}), ...(remoteConf.admins || {}) },
    approvedUsers: {
      ...(localConf.approvedUsers || {}),
      ...(remoteConf.approvedUsers || {}),
    },
    settings: { ...(localConf.settings || {}), ...(remoteConf.settings || {}) },
    notifications: {
      ...(localConf.notifications || {}),
      ...(remoteConf.notifications || {}),
    },
  };

  const mergedUsers: Record<string, any> = {
    ...(localTree.users || {}),
    ...(remoteTree.users || {}),
  };

  return {
    ...localTree,
    ...remoteTree,
    committees: mergedCommittees,
    conference: mergedConference,
    users: mergedUsers,
    __deletedCommittees: Array.from(deletedSet),
  };
}

class SyncedStore {
  private tree: Record<string, any> = {};
  private listeners: Map<
    string,
    Set<{
      cb: (snap: any) => void;
      ctx?: any;
      orderByProp?: string;
      equalToVal?: any;
    }>
  > = new Map();
  private channel: BroadcastChannel | null = null;
  private rawRefFn: ((path?: string) => firebase.database.Reference) | null = null;
  private remoteWatchedPaths: Set<string> = new Set();
  private serverSyncStarted = false;

  constructor() {
    this.loadFromStorage();

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY && e.newValue) {
          try {
            this.tree = JSON.parse(e.newValue);
            this.notifyAll();
          } catch {
            // ignore malformed JSON
          }
        }
      });

      if (typeof BroadcastChannel !== 'undefined') {
        try {
          this.channel = new BroadcastChannel(CHANNEL_NAME);
          this.channel.onmessage = ev => {
            if (ev.data && ev.data.tree) {
              this.tree = ev.data.tree;
              this.saveToStorage(false);
              this.notifyAll();
            }
          };
        } catch {
          this.channel = null;
        }
      }

      this.initServerSync();
    }
  }

  private isTestEnv(): boolean {
    try {
      return (
        typeof process !== 'undefined' &&
        Boolean(process.env && (process.env.VITEST || process.env.NODE_ENV === 'test'))
      );
    } catch {
      return false;
    }
  }

  private initServerSync() {
    if (this.serverSyncStarted || typeof window === 'undefined' || this.isTestEnv()) {
      return;
    }
    this.serverSyncStarted = true;

    const applyServerTree = (serverTree: Record<string, any>) => {
      if (!serverTree || typeof serverTree !== 'object') return;
      const before = JSON.stringify(this.tree);
      // Use serverTree as authoritative while preserving any local unsynced items via merge
      const next = mergeIncomingTree(this.tree, serverTree);
      // Also if server removed a notification or admin, respect server's conference sub-objects when present
      if (serverTree.conference) {
        if (serverTree.conference.notifications) {
          next.conference.notifications = {
            ...(this.tree.conference?.notifications || {}),
            ...serverTree.conference.notifications,
          };
        }
      }
      if (JSON.stringify(next) !== before) {
        this.tree = next;
        this.saveToStorage(true);
        this.notifyAll();
      }
    };

    // 1. Push any existing localStorage data up to the global server store and pull the merged result
    if (typeof window.fetch === 'function') {
      window
        .fetch('/__wumun_sync__', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ op: 'merge', tree: this.tree }),
        })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && data.tree) {
            applyServerTree(data.tree);
          }
        })
        .catch(() => {});
    }

    // 2. Subscribe to real-time Server-Sent Events from the server so all browsers stay in sync
    if (typeof window.EventSource !== 'undefined') {
      try {
        const es = new window.EventSource('/__wumun_sync__/events');
        es.onmessage = ev => {
          try {
            const parsed = JSON.parse(ev.data);
            if (parsed && parsed.tree) {
              // Replace with server tree (which already has all merges and deletions applied)
              const before = JSON.stringify(this.tree);
              const cleaned = { ...parsed.tree };
              if (cleaned.committees) {
                delete cleaned.committees[HUB_COMMITTEE_ID];
              }
              if (JSON.stringify(cleaned) !== before) {
                this.tree = cleaned;
                this.saveToStorage(true);
                this.notifyAll();
              }
            }
          } catch {
            // ignore parse error
          }
        };
      } catch {
        // ignore if EventSource is blocked
      }
    }
  }

  private pushServerMutation(segments: string[], value: any) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || this.isTestEnv()) {
      return;
    }
    window
      .fetch('/__wumun_sync__', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'set', segments, value }),
      })
      .catch(() => {});
  }

  public attachRawDatabase(rawRefFn: (path?: string) => firebase.database.Reference) {
    if (this.rawRefFn) return;
    this.rawRefFn = rawRefFn;

    // 1. Watch the shared Firebase RTDB hub node (/committees/__wumun_hub__/motions/__sync__/votes)
    // which has unconditional .read: true and .write: true across all browsers and accounts.
    try {
      const hubVotesRef = this.rawRefFn(HUB_SYNC_PATH);
      hubVotesRef.on(
        'value',
        snap => {
          const val = snap ? snap.val() : null;
          if (!val || typeof val !== 'object') return;

          let changed = false;

          if (typeof val.wumun_deleted_committees === 'string') {
            try {
              const deletedIds: string[] = JSON.parse(val.wumun_deleted_committees);
              if (Array.isArray(deletedIds)) {
                const mergedDeleted = Array.from(
                  new Set([...this.getDeletedCommitteeIds(), ...deletedIds])
                );
                this.tree.__deletedCommittees = mergedDeleted;
              }
            } catch {
              // ignore
            }
          }

          if (typeof val.wumun_conference_sync === 'string') {
            try {
              const remoteConf = JSON.parse(val.wumun_conference_sync);
              if (remoteConf && typeof remoteConf === 'object') {
                const currentJson = JSON.stringify(this.tree.conference || {});
                const nextJson = JSON.stringify(remoteConf);
                if (currentJson !== nextJson) {
                  this.tree.conference = remoteConf;
                  changed = true;
                }
              }
            } catch {
              // ignore
            }
          }

          if (typeof val.wumun_committees_sync === 'string') {
            try {
              const remoteComms = JSON.parse(val.wumun_committees_sync);
              if (remoteComms && typeof remoteComms === 'object') {
                delete remoteComms[HUB_COMMITTEE_ID];
                const merged = {
                  ...(this.tree.committees || {}),
                  ...remoteComms,
                };
                delete merged[HUB_COMMITTEE_ID];
                this.getDeletedCommitteeIds().forEach(id => delete merged[id]);
                const currentJson = JSON.stringify(this.tree.committees || {});
                const nextJson = JSON.stringify(merged);
                if (currentJson !== nextJson) {
                  this.tree.committees = merged;
                  changed = true;
                }
              }
            } catch {
              // ignore
            }
          }

          if (typeof val.wumun_users_sync === 'string') {
            try {
              const remoteUsers = JSON.parse(val.wumun_users_sync);
              if (remoteUsers && typeof remoteUsers === 'object') {
                const mergedUsers = {
                  ...(this.tree.users || {}),
                  ...remoteUsers,
                };
                if (JSON.stringify(this.tree.users || {}) !== JSON.stringify(mergedUsers)) {
                  this.tree.users = mergedUsers;
                  changed = true;
                }
              }
            } catch {
              // ignore
            }
          }

          if (changed) {
            this.saveToStorage(true);
            this.notifyAll();
            if (!this.isTestEnv() && typeof window !== 'undefined' && typeof window.fetch === 'function') {
              window
                .fetch('/__wumun_sync__', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ op: 'merge', tree: this.tree }),
                })
                .catch(() => {});
            }
          }
        },
        () => {}
      );
    } catch {
      // ignore
    }

    // 2. Also watch /committees directly on Firebase RTDB (since /committees has .read: true)
    try {
      this.rawRefFn('committees').on(
        'value',
        snap => {
          const val = snap ? snap.val() : null;
          if (val && typeof val === 'object') {
            delete val[HUB_COMMITTEE_ID];
            const deletedIds = this.getDeletedCommitteeIds();
            deletedIds.forEach(id => delete val[id]);
            if (Object.keys(val).length > 0) {
              const currentJson = JSON.stringify(this.tree.committees || {});
              const merged = {
                ...(this.tree.committees || {}),
                ...val,
              };
              delete merged[HUB_COMMITTEE_ID];
              if (JSON.stringify(merged) !== currentJson) {
                this.tree.committees = merged;
                this.saveToStorage(true);
                this.notifyPath(['committees']);
                this.pushHubSync('committees');
              }
            }
          }
        },
        () => {}
      );
    } catch {
      // ignore
    }

    // Push initial local state to hub if we have local committees or conference data
    if (this.tree.committees && Object.keys(this.tree.committees).length > 0) {
      this.pushHubSync('committees');
    }
    if (this.tree.conference && Object.keys(this.tree.conference).length > 0) {
      this.pushHubSync('conference');
    }
  }

  private getDeletedCommitteeIds(): string[] {
    if (!Array.isArray(this.tree.__deletedCommittees)) {
      return [];
    }
    return this.tree.__deletedCommittees;
  }

  private recordDeletedCommitteeId(id: string) {
    const current = new Set(this.getDeletedCommitteeIds());
    current.add(id);
    this.tree.__deletedCommittees = Array.from(current);
  }

  private unrecordDeletedCommitteeId(id: string) {
    const current = new Set(this.getDeletedCommitteeIds());
    if (current.has(id)) {
      current.delete(id);
      this.tree.__deletedCommittees = Array.from(current);
    }
  }

  private pushHubSync(section: 'conference' | 'committees' | 'users') {
    if (!this.rawRefFn) return;

    try {
      const hubVotesRef = this.rawRefFn(HUB_SYNC_PATH);
      if (section === 'conference') {
        hubVotesRef
          .child('wumun_conference_sync')
          .set(JSON.stringify(this.tree.conference || {}))
          .catch(() => {});
      } else if (section === 'committees') {
        const comms = { ...(this.tree.committees || {}) };
        delete comms[HUB_COMMITTEE_ID];
        hubVotesRef
          .child('wumun_committees_sync')
          .set(JSON.stringify(comms))
          .catch(() => {});
        hubVotesRef
          .child('wumun_deleted_committees')
          .set(JSON.stringify(this.getDeletedCommitteeIds()))
          .catch(() => {});
      } else if (section === 'users') {
        hubVotesRef
          .child('wumun_users_sync')
          .set(JSON.stringify(this.tree.users || {}))
          .catch(() => {});
      }
    } catch {
      // ignore remote hub errors
    }
  }

  private loadFromStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.committees && typeof parsed.committees === 'object') {
            delete parsed.committees[HUB_COMMITTEE_ID];
          }
          this.tree = parsed;
        }
      }
    } catch {
      this.tree = {};
    }
  }

  private saveToStorage(broadcast = true) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      if (this.tree.committees && typeof this.tree.committees === 'object') {
        delete this.tree.committees[HUB_COMMITTEE_ID];
      }
      const serialized = JSON.stringify(this.tree);
      window.localStorage.setItem(STORAGE_KEY, serialized);
      if (broadcast && this.channel) {
        this.channel.postMessage({ tree: this.tree });
      }
    } catch {
      // ignore quota errors
    }
  }

  public getAt(segments: string[]): any {
    const joined = segments.join('/');
    if (joined === '.info/connected') return true;
    if (joined === '.info/serverTimeOffset') return 0;

    let curr: any = this.tree;
    for (const seg of segments) {
      if (curr === null || curr === undefined || typeof curr !== 'object') {
        return null;
      }
      curr = curr[seg];
    }
    if (curr === undefined) return null;
    const cloned = deepClone(curr);
    if (
      segments.length === 1 &&
      segments[0] === 'committees' &&
      cloned &&
      typeof cloned === 'object'
    ) {
      delete cloned[HUB_COMMITTEE_ID];
    }
    return cloned;
  }

  public setAt(segments: string[], value: any, fromRemote = false): void {
    const clean = stripUndefined(value);

    // Track committee creation/deletion for hub tombstone sync
    if (!fromRemote && segments.length === 2 && segments[0] === 'committees') {
      const commId = segments[1];
      if (commId !== HUB_COMMITTEE_ID) {
        if (clean === null) {
          this.recordDeletedCommitteeId(commId);
        } else {
          this.unrecordDeletedCommitteeId(commId);
        }
      }
    }

    if (segments.length === 0) {
      this.tree = clean && typeof clean === 'object' ? clean : {};
    } else {
      let curr: any = this.tree;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        if (curr[seg] === null || curr[seg] === undefined || typeof curr[seg] !== 'object') {
          curr[seg] = {};
        }
        curr = curr[seg];
      }
      const last = segments[segments.length - 1];
      if (clean === null || clean === undefined) {
        delete curr[last];
      } else {
        curr[last] = clean;
      }
    }

    this.saveToStorage(true);
    this.notifyPath(segments);

    if (!fromRemote && segments[0] !== '.info') {
      // 1. Sync with Vite global server endpoint for instant cross-browser sync
      this.pushServerMutation(segments, clean);

      // 2. Sync with Firebase RTDB direct & public hub paths
      if (this.rawRefFn) {
        try {
          const ref = this.rawRefFn(segments.join('/'));
          if (clean === null) {
            ref.remove().catch(() => {});
          } else {
            ref.set(clean).catch(() => {});
          }
        } catch {
          // ignore direct remote errors
        }

        if (segments[0] === 'conference') {
          this.pushHubSync('conference');
        } else if (segments[0] === 'committees' && segments[1] !== HUB_COMMITTEE_ID) {
          this.pushHubSync('committees');
        } else if (segments[0] === 'users') {
          this.pushHubSync('users');
        }
      }
    }
  }

  public updateAt(segments: string[], values: Record<string, any>): void {
    if (!values || typeof values !== 'object') return;
    Object.keys(values).forEach(relPath => {
      const subSegs = normalizePath(relPath);
      this.setAt([...segments, ...subSegs], values[relPath], false);
    });
  }

  private ensureRemoteWatch(segments: string[]) {
    if (!this.rawRefFn || segments[0] === '.info') return;

    // Watch individual committees (/committees/:committeeID) directly as well
    if (segments[0] === 'committees' && segments[1] && segments[1] !== HUB_COMMITTEE_ID) {
      const commPath = `committees/${segments[1]}`;
      if (!this.remoteWatchedPaths.has(commPath)) {
        this.remoteWatchedPaths.add(commPath);
        try {
          this.rawRefFn(commPath).on(
            'value',
            snap => {
              const remoteVal = snap ? snap.val() : null;
              if (remoteVal && typeof remoteVal === 'object') {
                if (this.getDeletedCommitteeIds().includes(segments[1])) return;
                if (!this.tree.committees) this.tree.committees = {};
                const localComm = this.tree.committees[segments[1]] || {};
                const merged = { ...localComm, ...remoteVal };
                if (JSON.stringify(localComm) !== JSON.stringify(merged)) {
                  this.tree.committees[segments[1]] = merged;
                  this.saveToStorage(true);
                  this.notifyPath(['committees', segments[1]]);
                  this.pushHubSync('committees');
                }
              }
            },
            () => {}
          );
        } catch {
          // ignore
        }
      }
    }

    const topKey = segments[0] || '';
    if (!topKey || this.remoteWatchedPaths.has(topKey)) return;
    this.remoteWatchedPaths.add(topKey);

    try {
      this.rawRefFn(topKey).on(
        'value',
        snap => {
          const remoteVal = snap ? snap.val() : null;
          if (remoteVal && typeof remoteVal === 'object') {
            if (topKey === 'committees') {
              delete remoteVal[HUB_COMMITTEE_ID];
              const deleted = this.getDeletedCommitteeIds();
              deleted.forEach(id => delete remoteVal[id]);
            }
            const localTop = this.tree[topKey] || {};
            const merged = {
              ...localTop,
              ...remoteVal,
            };
            if (JSON.stringify(localTop) !== JSON.stringify(merged)) {
              this.tree[topKey] = merged;
              this.saveToStorage(true);
              this.notifyPath([topKey]);
            }
          }
        },
        () => {}
      );
    } catch {
      // Ignore
    }
  }

  public addListener(
    segments: string[],
    cb: (snap: any) => void,
    ctx?: any,
    orderByProp?: string,
    equalToVal?: any
  ) {
    this.loadFromStorage();

    const key = segments.join('/');
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    const entry = { cb, ctx, orderByProp, equalToVal };
    this.listeners.get(key)!.add(entry);

    this.ensureRemoteWatch(segments);
    this.fireEntry(segments, entry);
  }

  public removeListener(segments: string[], cb?: (snap: any) => void, ctx?: any) {
    const key = segments.join('/');
    const set = this.listeners.get(key);
    if (!set) return;
    if (!cb) {
      set.clear();
      return;
    }
    Array.from(set).forEach(entry => {
      if (entry.cb === cb && (!ctx || entry.ctx === ctx)) {
        set.delete(entry);
      }
    });
  }

  private fireEntry(
    segments: string[],
    entry: {
      cb: (snap: any) => void;
      ctx?: any;
      orderByProp?: string;
      equalToVal?: any;
    }
  ) {
    let val = this.getAt(segments);
    if (
      entry.orderByProp &&
      entry.equalToVal !== undefined &&
      val &&
      typeof val === 'object'
    ) {
      const filtered: Record<string, any> = {};
      Object.keys(val).forEach(k => {
        if (val[k] && val[k][entry.orderByProp!] === entry.equalToVal) {
          filtered[k] = val[k];
        }
      });
      val = Object.keys(filtered).length > 0 ? filtered : null;
    }
    const snap = new SyncedDataSnapshot(this, segments, val);
    try {
      entry.cb.call(entry.ctx, snap);
    } catch (err) {
      console.error('Error in database listener:', err);
    }
  }

  private notifyPath(changedSegments: string[]) {
    const changedPath = changedSegments.join('/');
    this.listeners.forEach((entries, listenerPath) => {
      if (
        listenerPath === changedPath ||
        listenerPath === '' ||
        changedPath.startsWith(listenerPath + '/') ||
        listenerPath.startsWith(changedPath + '/')
      ) {
        const segs = normalizePath(listenerPath);
        entries.forEach(entry => this.fireEntry(segs, entry));
      }
    });
  }

  private notifyAll() {
    this.listeners.forEach((entries, listenerPath) => {
      const segs = normalizePath(listenerPath);
      entries.forEach(entry => this.fireEntry(segs, entry));
    });
  }
}

export class SyncedDataSnapshot {
  public readonly key: string | null;
  public readonly ref: SyncedReference;

  constructor(
    private store: SyncedStore,
    private segments: string[],
    private value: any
  ) {
    this.key = segments.length > 0 ? segments[segments.length - 1] : null;
    this.ref = new SyncedReference(store, segments);
  }

  val(): any {
    return deepClone(this.value);
  }

  exists(): boolean {
    return this.value !== null && this.value !== undefined;
  }

  child(subPath: string): SyncedDataSnapshot {
    const childSegs = [...this.segments, ...normalizePath(subPath)];
    return new SyncedDataSnapshot(this.store, childSegs, this.store.getAt(childSegs));
  }
}

export class SyncedReference {
  public readonly key: string | null;
  private orderByProp?: string;
  private equalToVal?: any;

  constructor(
    private store: SyncedStore,
    private segments: string[],
    orderByProp?: string,
    equalToVal?: any
  ) {
    this.key = segments.length > 0 ? segments[segments.length - 1] : null;
    this.orderByProp = orderByProp;
    this.equalToVal = equalToVal;
  }

  get parent(): SyncedReference | null {
    if (this.segments.length === 0) return null;
    return new SyncedReference(
      this.store,
      this.segments.slice(0, this.segments.length - 1)
    );
  }

  get root(): SyncedReference {
    return new SyncedReference(this.store, []);
  }

  child(subPath: string): SyncedReference {
    return new SyncedReference(this.store, [
      ...this.segments,
      ...normalizePath(subPath),
    ]);
  }

  set(value: any, onComplete?: (err: Error | null) => void): Promise<void> {
    this.store.setAt(this.segments, value);
    if (onComplete) onComplete(null);
    return Promise.resolve();
  }

  update(
    values: Record<string, any>,
    onComplete?: (err: Error | null) => void
  ): Promise<void> {
    this.store.updateAt(this.segments, values);
    if (onComplete) onComplete(null);
    return Promise.resolve();
  }

  remove(onComplete?: (err: Error | null) => void): Promise<void> {
    this.store.setAt(this.segments, null);
    if (onComplete) onComplete(null);
    return Promise.resolve();
  }

  push(value?: any, onComplete?: (err: Error | null) => void): any {
    const id = `-${Date.now().toString(36)}-${shortMeetId()}`;
    const childRef = this.child(id);
    if (value !== undefined) {
      const p = childRef.set(value, onComplete);
      (childRef as any).then = p.then.bind(p);
      (childRef as any).catch = p.catch.bind(p);
    } else {
      const p = Promise.resolve(childRef);
      (childRef as any).then = p.then.bind(p);
      (childRef as any).catch = p.catch.bind(p);
    }
    return childRef;
  }

  transaction(
    transactionUpdate: (currentData: any) => any,
    onComplete?: (
      error: Error | null,
      committed: boolean,
      snapshot: SyncedDataSnapshot | null
    ) => void
  ): Promise<{ committed: boolean; snapshot: SyncedDataSnapshot }> {
    const current = this.store.getAt(this.segments);
    const next = transactionUpdate(current);
    if (next !== undefined) {
      this.store.setAt(this.segments, next);
    }
    const snap = new SyncedDataSnapshot(
      this.store,
      this.segments,
      this.store.getAt(this.segments)
    );
    if (onComplete) onComplete(null, true, snap);
    return Promise.resolve({ committed: true, snapshot: snap });
  }

  orderByChild(prop: string): SyncedReference {
    return new SyncedReference(this.store, this.segments, prop, this.equalToVal);
  }

  equalTo(val: any): SyncedReference {
    return new SyncedReference(this.store, this.segments, this.orderByProp, val);
  }

  on(
    eventType: string,
    callback: (snap: any) => void,
    cancelCallbackOrContext?: any,
    context?: any
  ): (snap: any) => void {
    const ctx =
      typeof cancelCallbackOrContext === 'object'
        ? cancelCallbackOrContext
        : context;
    this.store.addListener(
      this.segments,
      callback,
      ctx,
      this.orderByProp,
      this.equalToVal
    );
    return callback;
  }

  off(
    eventType?: string,
    callback?: (snap: any) => void,
    context?: any
  ): void {
    this.store.removeListener(this.segments, callback, context);
  }

  once(
    eventType?: string,
    successCallback?: (snap: any) => void,
    failureCallbackOrContext?: any,
    context?: any
  ): Promise<SyncedDataSnapshot> {
    return new Promise(resolve => {
      const cb = (snap: SyncedDataSnapshot) => {
        this.off(eventType, cb);
        if (successCallback) {
          successCallback(snap);
        }
        resolve(snap);
      };
      this.on(eventType || 'value', cb, failureCallbackOrContext, context);
    });
  }

  toString(): string {
    return '/' + this.segments.join('/');
  }
}

const globalStore = new SyncedStore();
let installed = false;

export function installDatabaseSync(): void {
  if (installed) return;
  installed = true;

  const createRef = (path?: string) =>
    new SyncedReference(globalStore, normalizePath(path));
  const createRefFromURL = (url: string) => {
    try {
      const u = new URL(url);
      return new SyncedReference(globalStore, normalizePath(u.pathname));
    } catch {
      return new SyncedReference(globalStore, normalizePath(url));
    }
  };

  try {
    const rawDb = firebase.database();
    const rawRefFn = rawDb.ref.bind(rawDb);
    globalStore.attachRawDatabase(rawRefFn);

    // Patch the singleton DatabaseCompat instance directly
    try {
      Object.defineProperty(rawDb, 'ref', {
        configurable: true,
        writable: true,
        value: createRef,
      });
      Object.defineProperty(rawDb, 'refFromURL', {
        configurable: true,
        writable: true,
        value: createRefFromURL,
      });
    } catch {
      (rawDb as any).ref = createRef;
      (rawDb as any).refFromURL = createRefFromURL;
    }

    const proto = Object.getPrototypeOf(rawDb);
    if (proto && proto !== Object.prototype) {
      try {
        Object.defineProperty(proto, 'ref', {
          configurable: true,
          writable: true,
          value: createRef,
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // raw database not initialized yet
  }

  const syncedDbInstance: any = {
    ref: createRef,
    refFromURL: createRefFromURL,
    goOnline: () => {},
    goOffline: () => {},
  };

  try {
    const origDatabase = firebase.database;
    const replacement = Object.assign(() => syncedDbInstance, origDatabase);
    Object.defineProperty(firebase, 'database', {
      configurable: true,
      writable: true,
      value: replacement,
    });
  } catch {
    // fallback if firebase namespace is non-configurable
  }
}
