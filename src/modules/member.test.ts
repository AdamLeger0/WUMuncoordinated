import {describe, expect, it} from 'vitest';
import {
  COUNTRY_NAME_ALIASES,
  COUNTRY_OPTIONS,
  LEGACY_COUNTRY_OPTIONS
} from '../constants';
import {
  canonicalCountryName,
  canVote,
  isDaisMember,
  MemberData,
  membersToDelegationOptions,
  membersToOptions,
  membersToPresentOptions,
  nameToCountryOption,
  nameToFlagCode,
  nameToMemberOption,
  nonNGO,
  Rank,
  searchCountryOptions
} from './member';
import { makeCommitteeStats } from './committee-stats';
import { DEFAULT_COMMITTEE, putCommittee } from '../models/committee';
import { getNotificationPalette, NOTIFICATION_PALETTES } from '../models/conference';
import { installDatabaseSync } from './db-sync';
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

describe('country options', () => {
  it('contains every current ISO 3166 entry plus the European Union', () => {
    expect(COUNTRY_OPTIONS).toHaveLength(250);
    expect(new Set(COUNTRY_OPTIONS.map(option => option.key)).size).toBe(250);
    expect(new Set(COUNTRY_OPTIONS.map(option => option.text)).size).toBe(250);
  });

  it.each([
    ['Lesotho', 'ls'],
    ['Myanmar', 'mm'],
    ['Tokelau', 'tk'],
    ['Tuvalu', 'tv'],
    ['Syrian Arab Republic', 'sy'],
    ['South Sudan', 'ss'],
  ])('provides the current option and flag for %s', (name, code) => {
    expect(nameToCountryOption(name)).toMatchObject({
      key: code,
      value: code,
      flag: code,
      text: name,
    });
    expect(nameToFlagCode(name)).toBe(code);
  });

  it.each(['aq', 'bl', 'bq', 'cw', 'gg', 'im', 'je', 'mf', 'sx'])(
    'includes the previously omitted ISO code %s',
    code => {
      expect(COUNTRY_OPTIONS.some(option => option.key === code)).toBe(true);
    }
  );
});

describe('stored country name compatibility', () => {
  it.each(Object.entries(COUNTRY_NAME_ALIASES))(
    'resolves the legacy name %s',
    (legacyName, code) => {
      const option = nameToCountryOption(legacyName);
      expect(option?.value).toBe(code);
      expect(nameToFlagCode(legacyName)).toBe(code);
      expect(canonicalCountryName(legacyName)).toBe(option?.text);
    }
  );

  it('keeps deleted codes readable without offering them for new members', () => {
    const legacyOption = LEGACY_COUNTRY_OPTIONS[0];

    expect(COUNTRY_OPTIONS).not.toContainEqual(legacyOption);
    expect(nameToMemberOption('Netherlands Antilles')).toEqual(legacyOption);
    expect(nameToFlagCode('Netherlands Antilles')).toBe('an');
  });

  it('uses the current Serbian code for name-only database rows', () => {
    expect(nameToMemberOption('Serbia').value).toBe('rs');
  });

  it('finds canonical options by legacy names and unaccented text', () => {
    expect(searchCountryOptions(COUNTRY_OPTIONS, 'Turkey')).toEqual([
      nameToMemberOption('Türkiye'),
    ]);
    expect(searchCountryOptions(COUNTRY_OPTIONS, 'Turkiye')).toEqual([
      nameToMemberOption('Türkiye'),
    ]);
    expect(searchCountryOptions(COUNTRY_OPTIONS, 'Cote dIvoire')).toEqual([
      nameToMemberOption("Côte d'Ivoire"),
    ]);
  });
});

describe('Dais member rank and voting exclusion', () => {
  const sampleMembers: Record<string, MemberData> = {
    fr: { name: 'France', rank: Rank.Veto, present: true, voting: true, password: '' },
    de: { name: 'Germany', rank: Rank.Standard, present: true, voting: false, password: '' },
    dais: { name: 'Dais', rank: Rank.Dais, present: true, voting: true, password: '' },
  };

  it('excludes Dais members from voting, quorum, and delegate counts', () => {
    expect(isDaisMember(sampleMembers.dais)).toBe(true);
    expect(canVote(sampleMembers.dais)).toBe(false);
    expect(nonNGO(sampleMembers.dais)).toBe(false);

    const stats = makeCommitteeStats({
      ...DEFAULT_COMMITTEE,
      members: sampleMembers,
    });

    expect(stats.delegatesNo).toBe(2);
    expect(stats.presentNo).toBe(2);
    expect(stats.canVoteNo).toBe(2);
    expect(stats.nonNGONo).toBe(2);
  });

  it('excludes Dais from present/delegation options while keeping Dais in post options', () => {
    expect(membersToPresentOptions(sampleMembers).map(o => o.text)).toEqual([
      'France',
      'Germany',
    ]);
    expect(membersToDelegationOptions(sampleMembers).map(o => o.text)).toEqual([
      'France',
      'Germany',
    ]);
    expect(membersToOptions(sampleMembers).map(o => o.text)).toEqual([
      'Dais',
      'France',
      'Germany',
    ]);
  });
});

describe('WUMUN notification palette & database sync', () => {
  it('enforces light text on dark/saturated boxes and dark text on yellow highlights', () => {
    expect(getNotificationPalette('info').textColor).toBe('var(--wumun-text-light)');
    expect(getNotificationPalette('urgent').textColor).toBe('var(--wumun-text-light)');
    expect(getNotificationPalette('warning').textColor).toBe('var(--wumun-text-dark)');
    expect(getNotificationPalette('success').textColor).toBe('var(--wumun-text-light)');

    expect(getNotificationPalette('brown').textColor).toBe('var(--wumun-text-light)');
    expect(getNotificationPalette('plum').textColor).toBe('var(--wumun-text-light)');
    expect(getNotificationPalette('navy').textColor).toBe('var(--wumun-text-light)');
    expect(getNotificationPalette('teal').textColor).toBe('var(--wumun-text-light)');
    expect(Object.keys(NOTIFICATION_PALETTES)).toHaveLength(8);
  });

  it('intercepts firebase.database().ref so created committees and notifications are visible immediately', () => {
    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: 'test-key',
        authDomain: 'wumun-hub.firebaseapp.com',
        databaseURL: 'https://wumun-hub.firebaseio.com',
        projectId: 'wumun-hub',
      });
    }
    installDatabaseSync();

    let latestCommittees: Record<string, any> = {};
    const commRef = firebase.database().ref('committees');
    const onComm = (snap: firebase.database.DataSnapshot | null) => {
      latestCommittees = (snap && snap.val()) || {};
    };
    commRef.on('value', onComm);

    putCommittee('test-comm-1', {
      ...DEFAULT_COMMITTEE,
      name: 'UN Security Council',
      topic: 'Global Peace',
    });

    expect(latestCommittees['test-comm-1']).toBeDefined();
    expect(latestCommittees['test-comm-1'].name).toBe('UN Security Council');
    commRef.off('value', onComm);

    let latestNotifs: Record<string, any> = {};
    const notifRef = firebase.database().ref('conference/notifications');
    const onNotif = (snap: firebase.database.DataSnapshot | null) => {
      latestNotifs = (snap && snap.val()) || {};
    };
    notifRef.on('value', onNotif);

    notifRef.push({
      title: 'Opening Ceremony',
      message: 'Starts in 5 minutes',
      severity: 'info',
      active: true,
      createdAt: 123456,
    });

    const notifValues = Object.values(latestNotifs);
    expect(notifValues.some((n: any) => n.title === 'Opening Ceremony')).toBe(true);
    notifRef.off('value', onNotif);
  });
});
