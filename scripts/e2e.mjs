#!/usr/bin/env node

/**
 * Socket.IO end-to-end smoke test for "Find the Human".
 *
 * The harness builds the server, launches the compiled entry point on an
 * ephemeral port with a deliberately empty OpenAI key, and drives real
 * socket.io-client connections through the public event contract.
 *
 * Usage:
 *   node scripts/e2e.mjs
 *
 * Useful overrides:
 *   E2E_SKIP_BUILD=1             Reuse the existing server build.
 *   E2E_GAME_TIME_SCALE=0.06     Server timer multiplier used by the test.
 *   E2E_TIMEOUT_MS=20000         Per-event timeout.
 *   E2E_SERVER_ENTRY=dist/x.js   Compiled entry, relative to /server.
 *   E2E_VERBOSE=1                Stream child-server output while testing.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const SERVER_DIR = path.join(ROOT_DIR, 'server');
const CLIENT_PACKAGE = path.join(ROOT_DIR, 'client', 'package.json');
const EVENT_TIMEOUT_MS = parsePositiveNumber(process.env.E2E_TIMEOUT_MS, 20_000);
const GAME_TIME_SCALE = String(
  parsePositiveNumber(process.env.E2E_GAME_TIME_SCALE, 0.06),
);
const AUTO_EVICTION_TIMEOUT_MS = Math.max(
  EVENT_TIMEOUT_MS,
  Math.ceil(60_000 * Number(GAME_TIME_SCALE) + 5_000),
);
// A complete round now includes the 15-second final-defense window between
// VOTE and REVEAL. Keep custom time-scale runs from inheriting the old,
// shorter phase-sequence timeout.
const ROUND_SEQUENCE_TIMEOUT_MS = Math.max(
  EVENT_TIMEOUT_MS,
  Math.ceil(150_000 * Number(GAME_TIME_SCALE) + 5_000),
);
const VERBOSE = process.env.E2E_VERBOSE === '1';

const clientRequire = createRequire(CLIENT_PACKAGE);
const { io } = clientRequire('socket.io-client');

let nextRecordId = 0;

class Probe {
  constructor(label, baseUrl) {
    this.label = label;
    this.records = [];
    this.waiters = new Set();
    this.socket = io(baseUrl, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      timeout: 5_000,
      transports: ['websocket'],
    });

    this.socket.onAny((event, payload) => this.#record(event, payload));
    this.socket.on('connect', () => this.#record('$connect', { socketId: this.socket.id }));
    this.socket.on('disconnect', (reason) => this.#record('$disconnect', { reason }));
    this.socket.on('connect_error', (error) =>
      this.#record('$connect_error', { message: error?.message ?? String(error) }),
    );
  }

  #record(event, payload) {
    const record = {
      id: ++nextRecordId,
      event,
      payload,
      at: Date.now(),
    };
    this.records.push(record);
    if (this.records.length > 500) this.records.shift();

    if (VERBOSE && !event.startsWith('$')) {
      console.log(`    [${this.label}] <= ${event} ${brief(payload)}`);
    }

    for (const waiter of [...this.waiters]) waiter(record);
  }

  mark() {
    return nextRecordId;
  }

  async connect() {
    if (this.socket.connected) return;

    const connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.label}: Socket.IO connection timed out`));
      }, EVENT_TIMEOUT_MS);

      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error) => {
        cleanup();
        reject(
          new Error(
            `${this.label}: Socket.IO connection failed: ${error?.message ?? String(error)}`,
          ),
        );
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('connect', onConnect);
        this.socket.off('connect_error', onError);
      };

      this.socket.on('connect', onConnect);
      this.socket.on('connect_error', onError);
    });

    this.socket.connect();
    await connected;
  }

  emit(event, payload) {
    if (payload === undefined) this.socket.emit(event);
    else this.socket.emit(event, payload);
  }

  emitAck(event, payload, label = event) {
    const after = this.mark();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.label}: ${label} ack timed out after ${EVENT_TIMEOUT_MS}ms`));
      }, EVENT_TIMEOUT_MS);

      const onError = (record) => {
        if (record.id <= after || record.event !== 'error') return;
        cleanup();
        reject(serverError(this.label, label, record.payload));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(onError);
      };

      this.waiters.add(onError);
      this.socket.emit(event, payload, (response) => {
        cleanup();
        if (response?.error || response?.ok === false) {
          reject(
            new Error(
              `${this.label}: ${label} ack rejected: ${brief(response.error ?? response)}`,
            ),
          );
          return;
        }
        resolve(response);
      });
    });
  }

  waitForRecord(predicate, description, timeoutMs = EVENT_TIMEOUT_MS) {
    const existing = this.records.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        const tail = this.records
          .slice(-8)
          .map((record) => `${record.event} ${brief(record.payload)}`)
          .join('\n      ');
        reject(
          new Error(
            `${this.label}: timed out waiting for ${description} after ${timeoutMs}ms` +
              (tail ? `\n      recent events: ${tail}` : ''),
          ),
        );
      }, timeoutMs);

      const onRecord = (record) => {
        if (!predicate(record)) return;
        cleanup();
        resolve(record);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(onRecord);
      };

      this.waiters.add(onRecord);
    });
  }

  async expect(event, predicate, { after = 0, description = event, timeoutMs } = {}) {
    const record = await this.waitForRecord(
      (candidate) =>
        candidate.id > after &&
        (candidate.event === 'error' ||
          (candidate.event === event && safePredicate(predicate, candidate.payload))),
      description,
      timeoutMs,
    );

    if (record.event === 'error') {
      throw serverError(this.label, description, record.payload);
    }
    return record.payload;
  }

  disconnect() {
    if (this.socket.connected) this.socket.disconnect();
  }

  close() {
    this.waiters.clear();
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}

function safePredicate(predicate, payload) {
  if (!predicate) return true;
  try {
    return Boolean(predicate(payload));
  } catch {
    return false;
  }
}

function serverError(client, action, payload) {
  const message = payload?.message ?? payload?.error ?? brief(payload);
  return new Error(`${client}: server rejected ${action}: ${message}`);
}

function parsePositiveNumber(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive number, received ${JSON.stringify(raw)}`);
  }
  return value;
}

function brief(value) {
  let rendered;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = String(value);
  }
  if (rendered === undefined) rendered = String(value);
  return rendered.length > 500 ? `${rendered.slice(0, 497)}...` : rendered;
}

function step(message) {
  console.log(`  -> ${message}`);
}

async function expectRejectedAck(probe, event, payload, label = event) {
  let rejection;
  try {
    await probe.emitAck(event, payload, label);
  } catch (error) {
    rejection = error;
  }
  assert(rejection instanceof Error, `${probe.label}: ${label} should have been rejected`);
  assert(rejection.message.length > 0, `${probe.label}: ${label} rejection needs a message`);
  return rejection;
}

function assertObject(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertRoomCode(code) {
  assert.equal(typeof code, 'string', 'room:create ack.code must be a string');
  assert.match(code, /^[A-Z0-9]{4}$/, 'room code must be four uppercase letters/digits');
}

function assertParticipants(participants, expectedCount, label) {
  assert(Array.isArray(participants), `${label}.participants must be an array`);
  if (expectedCount !== undefined) {
    assert.equal(participants.length, expectedCount, `${label} participant count`);
  }
  assert(participants.every((name) => typeof name === 'string' && name.length > 0));
  assert.equal(new Set(participants).size, participants.length, `${label} anon names must be unique`);
}

function assertPhase(payload, expectedPhase) {
  assertObject(payload, `phase:change(${expectedPhase})`);
  assert.equal(payload.phase, expectedPhase);
  assert(Number.isInteger(payload.round) && payload.round >= 1, 'phase round must be a positive integer');
  assert(Number.isFinite(payload.endsAt), `${expectedPhase} phase must include a finite endsAt`);
  if (expectedPhase === 'CHAT') {
    assert.equal(typeof payload.questionCard, 'string');
    assert(payload.questionCard.trim().length > 0, 'CHAT phase must include a question card');
  }
  if (expectedPhase === 'DEFENSE') {
    assert.equal(typeof payload.defenseTarget, 'string');
    assert(payload.defenseTarget.length > 0, 'DEFENSE phase must identify its target');
  }
}

function assertVisibleHost(state, label) {
  assertObject(state, label);
  const hosts = state.players.filter((player) => player.isHost === true);
  assert.equal(hosts.length, 1, `${label} must expose exactly one host`);
  assert.equal(state.hostId, hosts[0].id, `${label}.hostId must use the viewer-visible host id`);
  return hosts[0];
}

function assertVoteReveal(payload, participantSet) {
  assertObject(payload, 'vote:reveal');
  assert(Array.isArray(payload.items), 'vote:reveal.items must be an array');
  for (const [index, item] of payload.items.entries()) {
    assertObject(item, `vote:reveal.items[${index}]`);
    assert(participantSet.has(item.voter), `unknown voter ${brief(item.voter)}`);
    assert(participantSet.has(item.target), `unknown vote target ${brief(item.target)}`);
    assert.notEqual(item.voter, item.target, 'a participant cannot vote for itself');
    assert.equal(typeof item.reason, 'string', 'every revealed vote needs a reason string');
  }
  assertObject(payload.eliminated, 'vote:reveal.eliminated');
  assert(participantSet.has(payload.eliminated.anonName), 'eliminated anon name must be a participant');
  assert.equal(typeof payload.eliminated.wasAI, 'boolean');
  assert.equal(typeof payload.eliminated.revealName, 'string');
  assert(payload.eliminated.revealName.length > 0, 'elimination must reveal an identity');
}

function assertGameOver(payload, participants) {
  assertObject(payload, 'game:over');
  assert.equal(typeof payload.winner, 'string', 'game:over.winner must be a string');
  assert(payload.winner.length > 0, 'game:over.winner must not be empty');
  assert(Array.isArray(payload.reveal), 'game:over.reveal must be an array');
  assert.equal(payload.reveal.length, participants.length, 'game over must reveal every participant');
  assert.deepEqual(
    new Set(payload.reveal.map((identity) => identity.anonName)),
    new Set(participants),
    'game over reveal must match the participant list',
  );
  for (const identity of payload.reveal) {
    assert.equal(typeof identity.isAI, 'boolean');
  }

  assert(Array.isArray(payload.awards), 'game:over.awards must be an array');
  const allowedAwardIds = new Set(['humanlike_ai', 'most_suspected_human', 'detective']);
  for (const [index, award] of payload.awards.entries()) {
    assertObject(award, `game:over.awards[${index}]`);
    assert(allowedAwardIds.has(award.id), `unknown award id ${brief(award.id)}`);
    for (const field of ['title', 'recipient', 'detail']) {
      assert.equal(typeof award[field], 'string', `award ${award.id}.${field} must be a string`);
      assert(award[field].length > 0, `award ${award.id}.${field} must not be empty`);
    }
  }
  assert.equal(
    new Set(payload.awards.map((award) => award.id)).size,
    payload.awards.length,
    'award ids must be unique',
  );
  const awardIds = new Set(payload.awards.map((award) => award.id));
  assert(awardIds.has('humanlike_ai'), 'game over must award the most human-like AI');
  if (payload.reveal.some((identity) => !identity.isAI)) {
    assert(awardIds.has('most_suspected_human'), 'a normal game must award its most suspected human');
    assert(payload.awards.length >= 2, 'a normal game must expose at least two ending awards');
  }

  assert(Array.isArray(payload.betLeaderboard), 'game:over.betLeaderboard must be an array');
  for (const [index, entry] of payload.betLeaderboard.entries()) {
    assertObject(entry, `game:over.betLeaderboard[${index}]`);
    assert.equal(typeof entry.nickname, 'string');
    assert(entry.nickname.length > 0, 'bet leaderboard nickname must not be empty');
    assert(Number.isInteger(entry.score) && entry.score >= 0, 'bet score must be a non-negative integer');
    assert(Number.isInteger(entry.total) && entry.total >= 0, 'bet total must be a non-negative integer');
    assert(entry.score <= entry.total, 'bet score cannot exceed total bets');
  }
}

function assertInterrogation(payload, expectedTarget) {
  assertObject(payload, 'interrogation:start');
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['endsAt', 'question', 'target'],
    'interrogation:start must not reveal which participant is certainly human',
  );
  assert.equal(payload.target, expectedTarget);
  assert.equal(typeof payload.question, 'string');
  assert(payload.question.trim().length > 0, 'interrogation question must not be empty');
  assert(Number.isFinite(payload.endsAt), 'interrogation endsAt must be numeric');
}

async function exerciseHumanDefense(probe, defenseTarget, expectedAnonName, label) {
  if (defenseTarget !== expectedAnonName) return;

  const text = `${label}-${Date.now()}`;
  const messageAfter = probe.mark();
  await probe.emitAck('chat:send', { text }, `${label} first defense chat:send`);
  const message = await probe.expect('chat:new', (payload) => payload?.text === text, {
    after: messageAfter,
    description: `${label} defense chat echo`,
  });
  assert.equal(message.from, expectedAnonName);
  const defenseState = await probe.expect(
    'room:state',
    (payload) => payload?.phase === 'DEFENSE' && payload?.defenseMessageSent === true,
    { after: messageAfter, description: `${label} defense completion state` },
  );
  assert.equal(defenseState.defenseTarget, expectedAnonName);
  await expectRejectedAck(
    probe,
    'chat:send',
    { text: `${text}-again` },
    `${label} duplicate defense chat:send`,
  );
}

async function createRoom(probe, nickname) {
  const stateAfter = probe.mark();
  const ack = await probe.emitAck('room:create', { nickname }, 'room:create');
  assertObject(ack, 'room:create ack');
  assertRoomCode(ack.code);
  assert.equal(typeof ack.playerId, 'string', 'room:create must return the owner rejoin token');

  const state = await probe.expect(
    'room:state',
    (payload) => payload?.players?.some((player) => player.nickname === nickname),
    { after: stateAfter, description: `room state containing ${nickname}` },
  );
  const player = state.players.find((candidate) => candidate.nickname === nickname);
  assert.equal(typeof player.id, 'string');
  assert.equal(player.id, ack.playerId, 'a viewer may receive only its own rejoin token');
  assert.equal(state.hostId, player.id, 'room creator must be host');
  return { code: ack.code, playerId: ack.playerId, state };
}

async function joinRoom(probe, hostProbe, code, nickname) {
  const guestAfter = probe.mark();
  const hostAfter = hostProbe.mark();
  probe.emit('room:join', { code, nickname });

  const [guestState, hostState] = await Promise.all([
    probe.expect(
      'room:state',
      (payload) => payload?.players?.some((player) => player.nickname === nickname),
      { after: guestAfter, description: `join confirmation for ${nickname}` },
    ),
    hostProbe.expect(
      'room:state',
      (payload) => payload?.players?.some((player) => player.nickname === nickname),
      { after: hostAfter, description: `host sees ${nickname} join` },
    ),
  ]);
  assert.equal(guestState.players.length, 2, 'normal room should contain two humans');
  assert.equal(hostState.players.length, 2, 'host and guest room state must agree');
  const player = guestState.players.find((candidate) => candidate.nickname === nickname);
  assert.equal(typeof player.id, 'string');
  const publicPlayer = hostState.players.find((candidate) => candidate.nickname === nickname);
  assert.equal(typeof publicPlayer?.id, 'string');
  assert.notEqual(publicPlayer.id, player.id, 'another viewer must receive only the public player id');
  assert(
    !JSON.stringify(hostState).includes(player.id),
    'the host snapshot must not contain the guest rejoin token',
  );
  return { playerId: player.id, publicId: publicPlayer.id, state: guestState, hostState };
}

async function startGame(host, peers, settings) {
  const probes = [host, ...peers];
  const marks = new Map(probes.map((probe) => [probe, probe.mark()]));
  host.emit('room:start', settings);

  const starts = await Promise.all(
    probes.map((probe) =>
      probe.expect('game:start', null, {
        after: marks.get(probe),
        description: `game:start (${brief(settings)})`,
      }),
    ),
  );
  const chats = await Promise.all(
    probes.map((probe) =>
      probe.expect('phase:change', (payload) => payload?.phase === 'CHAT', {
        after: marks.get(probe),
        description: 'initial CHAT phase',
      }),
    ),
  );
  chats.forEach((payload) => assertPhase(payload, 'CHAT'));
  assert.deepEqual(starts[0].participants, starts.at(-1).participants);
  return { starts, chatPhases: chats, marks };
}

async function runNormalFlow(baseUrl, allProbes) {
  console.log(
    '\n[1/6] Normal room: interrogation/betting/rejoin/vote/defense/reveal/end/again',
  );
  const host = new Probe('normal-host', baseUrl);
  const guest = new Probe('normal-guest', baseUrl);
  allProbes.push(host, guest);
  await Promise.all([host.connect(), guest.connect()]);

  step('create a room and join with a second human');
  const created = await createRoom(host, 'host-e2e');
  const joined = await joinRoom(guest, host, created.code, 'guest-e2e');

  step('reject room:rejoin with a public player id and keep the victim connected');
  assert(
    !JSON.stringify(joined.state).includes(created.playerId),
    'the guest snapshot must not contain the host rejoin token',
  );
  const hijacker = new Probe('public-id-hijack', baseUrl);
  allProbes.push(hijacker);
  await hijacker.connect();
  await expectRejectedAck(
    hijacker,
    'room:rejoin',
    { playerId: joined.publicId, code: created.code },
    'public id room:rejoin hijack',
  );
  assert.equal(guest.socket.connected, true, 'failed public-id hijack must not disconnect the victim');
  hijacker.close();

  step('start one round with exactly three AI participants');
  const normal = await startGame(host, [guest], {
    aiCount: 3,
    rounds: 1,
    spectatorMode: false,
    difficulty: 'mild',
  });
  const hostStart = normal.starts[0];
  const guestStart = normal.starts[1];
  assertObject(hostStart, 'host game:start');
  assertObject(guestStart, 'guest game:start');
  assert.equal(hostStart.isSpectator, false);
  assert.equal(guestStart.isSpectator, false);
  assert.equal(typeof hostStart.yourAnonName, 'string');
  assert.equal(typeof guestStart.yourAnonName, 'string');
  assert.notEqual(hostStart.yourAnonName, guestStart.yourAnonName);
  assertParticipants(hostStart.participants, 5, 'normal game');
  assert(hostStart.participants.includes(hostStart.yourAnonName));
  assert(hostStart.participants.includes(guestStart.yourAnonName));

  step('join during CHAT and verify the complete spectator snapshot');
  let chatJoin = new Probe('normal-chat-join', baseUrl);
  allProbes.push(chatJoin);
  await chatJoin.connect();
  const chatJoinAfter = chatJoin.mark();
  const chatJoinAckPromise = chatJoin.emitAck(
    'room:join',
    { code: created.code, nickname: 'chat-join-e2e' },
    'CHAT room:join',
  );
  const [chatJoinAck, chatJoinStart, chatJoinState, chatJoinPhase] = await Promise.all([
    chatJoinAckPromise,
    chatJoin.expect('game:start', (payload) => payload?.isSpectator === true, {
      after: chatJoinAfter,
      description: 'CHAT join spectator identity',
    }),
    chatJoin.expect(
      'room:state',
      (payload) =>
        payload?.phase === 'CHAT' &&
        payload?.lifecycle === 'PLAYING' &&
        payload?.isSpectator === true,
      { after: chatJoinAfter, description: 'CHAT join room snapshot' },
    ),
    chatJoin.expect(
      'phase:change',
      (payload) => payload?.phase === 'CHAT' && payload?.round === 1,
      { after: chatJoinAfter, description: 'CHAT join current phase snapshot' },
    ),
  ]);
  assert.equal(chatJoinAck.code, created.code);
  assert.equal(typeof chatJoinAck.playerId, 'string');
  assert.equal(chatJoinStart.yourAnonName, '');
  assert.equal(chatJoinStart.isSpectator, true);
  assert.deepEqual(chatJoinStart.participants, hostStart.participants);
  assert.equal(chatJoinStart.rounds, 1);
  assert.equal(chatJoinStart.round, 1);
  assert.equal(chatJoinState.round, 1);
  assert.equal(chatJoinState.yourAnonName, '');
  assert.equal(chatJoinState.isSpectator, true);
  assert.deepEqual(chatJoinState.participants, hostStart.participants);
  assert.equal(chatJoinState.result, undefined);
  const observerSnapshot = JSON.stringify(chatJoinState);
  assert(
    !observerSnapshot.includes(created.playerId),
    'an observer snapshot must not contain the host rejoin token through players or hostId',
  );
  assert(
    !observerSnapshot.includes(joined.playerId),
    'an observer snapshot must not contain another participant rejoin token',
  );
  const chatJoinPlayer = chatJoinState.players.find(
    (player) => player.id === chatJoinAck.playerId,
  );
  assertObject(chatJoinPlayer, 'CHAT join player state');
  assert.equal(chatJoinPlayer.isYou, true);
  assert.equal(chatJoinPlayer.connected, true);
  assert.equal(chatJoinPlayer.isSpectator, true);
  assert.equal(chatJoinPlayer.alive, false);
  assertPhase(chatJoinPhase, 'CHAT');
  assert.equal(chatJoinPhase.questionCard, normal.chatPhases[0].questionCard);

  step('place a late-spectator human prediction without leaking intermediate scores');
  const spectatorBetAfter = chatJoin.mark();
  const hostBetStateAfter = host.mark();
  const spectatorBetAckPromise = chatJoin.emitAck(
    'spectator:bet',
    { targetAnonName: hostStart.yourAnonName },
    'CHAT spectator:bet',
  );
  const [spectatorBetAck, spectatorBetState, hostBetState] = await Promise.all([
    spectatorBetAckPromise,
    chatJoin.expect(
      'room:state',
      (payload) =>
        payload?.spectatorBet?.round === 1 &&
        payload?.spectatorBet?.targetAnonName === hostStart.yourAnonName,
      { after: spectatorBetAfter, description: 'spectator bet restored in room snapshot' },
    ),
    host.expect('room:state', (payload) => payload?.phase === 'CHAT', {
      after: hostBetStateAfter,
      description: 'host snapshot after spectator bet',
    }),
  ]);
  assert.deepEqual(spectatorBetAck.spectatorBet, {
    round: 1,
    targetAnonName: hostStart.yourAnonName,
  });
  for (const [label, state] of [
    ['spectator', spectatorBetState],
    ['participant', hostBetState],
  ]) {
    assert.equal(state.betLeaderboard, undefined, `${label} must not see a mid-game leaderboard`);
    for (const player of state.players) {
      assert.equal(player.spectatorScore, undefined, `${label} must not see spectatorScore`);
      assert.equal(player.score, undefined, `${label} must not see another player's bet score`);
      assert.equal(player.total, undefined, `${label} must not see another player's bet total`);
    }
  }

  step('rejoin the late spectator and restore only its own saved bet');
  const previousChatJoin = chatJoin;
  previousChatJoin.disconnect();
  chatJoin = new Probe('normal-chat-join-rejoined', baseUrl);
  allProbes.push(chatJoin);
  await chatJoin.connect();
  const betRejoinAfter = chatJoin.mark();
  const betRejoinAckPromise = chatJoin.emitAck(
    'room:rejoin',
    { playerId: chatJoinAck.playerId, code: created.code },
    'spectator bet room:rejoin',
  );
  const [betRejoinAck, betRejoinState, betRejoinStart] = await Promise.all([
    betRejoinAckPromise,
    chatJoin.expect(
      'room:state',
      (payload) =>
        payload?.isSpectator === true &&
        payload?.spectatorBet?.round === 1 &&
        payload?.spectatorBet?.targetAnonName === hostStart.yourAnonName,
      { after: betRejoinAfter, description: 'saved spectator bet after room:rejoin' },
    ),
    chatJoin.expect('game:start', (payload) => payload?.isSpectator === true, {
      after: betRejoinAfter,
      description: 'rejoined betting spectator identity',
    }),
  ]);
  assert.equal(betRejoinAck.playerId, chatJoinAck.playerId);
  assert.equal(betRejoinStart.yourAnonName, '');
  assert.deepEqual(betRejoinState.spectatorBet, spectatorBetAck.spectatorBet);
  previousChatJoin.close();

  step('use the one-shot interrogation and end it when the human target answers');
  const hostInterrogationAfter = host.mark();
  const guestInterrogationAfter = guest.mark();
  const interrogationAckPromise = host.emitAck(
    'interrogation:use',
    { targetAnonName: guestStart.yourAnonName },
    'interrogation:use',
  );
  const [interrogationAck, hostInterrogation, guestInterrogation, interrogationState] =
    await Promise.all([
      interrogationAckPromise,
      host.expect('interrogation:start', null, {
        after: hostInterrogationAfter,
        description: 'host interrogation:start',
      }),
      guest.expect('interrogation:start', null, {
        after: guestInterrogationAfter,
        description: 'guest interrogation:start',
      }),
      host.expect(
        'room:state',
        (payload) =>
          payload?.interrogationUsed === true &&
          payload?.interrogation?.target === guestStart.yourAnonName,
        { after: hostInterrogationAfter, description: 'interrogation room state' },
      ),
    ]);
  assert.equal(interrogationAck.ok, true);
  assertInterrogation(hostInterrogation, guestStart.yourAnonName);
  assertInterrogation(guestInterrogation, guestStart.yourAnonName);
  assert.deepEqual(guestInterrogation, hostInterrogation);
  assert.equal(interrogationState.interrogationUsed, true);
  assertInterrogation(interrogationState.interrogation, guestStart.yourAnonName);

  const interrogationAnswer = `interrogation-e2e-${Date.now()}`;
  const hostAnswerAfter = host.mark();
  const guestAnswerAfter = guest.mark();
  const answerAckPromise = guest.emitAck(
    'chat:send',
    { text: interrogationAnswer },
    'interrogation answer chat:send',
  );
  const [answerAck, answerChat, hostInterrogationEnd, guestInterrogationEnd] =
    await Promise.all([
      answerAckPromise,
      host.expect('chat:new', (payload) => payload?.text === interrogationAnswer, {
        after: hostAnswerAfter,
        description: 'interrogation answer broadcast',
      }),
      host.expect('interrogation:end', null, {
        after: hostAnswerAfter,
        description: 'host interrogation:end',
      }),
      guest.expect('interrogation:end', null, {
        after: guestAnswerAfter,
        description: 'guest interrogation:end',
      }),
    ]);
  assert.equal(answerAck.ok, true);
  assert.equal(answerChat.from, guestStart.yourAnonName);
  assert.equal(hostInterrogationEnd.answered, true);
  assert.deepEqual(
    Object.keys(hostInterrogationEnd).sort(),
    ['answered', 'endedAt', 'question', 'target'],
    'interrogation:end must not reveal the interrogator',
  );
  assert.deepEqual(guestInterrogationEnd, hostInterrogationEnd);
  await expectRejectedAck(
    host,
    'interrogation:use',
    { targetAnonName: guestStart.yourAnonName },
    'duplicate interrogation:use',
  );
  const normalVoteAfter = host.mark();

  step('send a human chat message and verify both clients receive it');
  const chatText = `e2e-${Date.now()}`;
  const hostChatAfter = host.mark();
  const guestChatAfter = guest.mark();
  host.emit('chat:send', { text: chatText });
  const [hostChat, guestChat] = await Promise.all([
    host.expect('chat:new', (payload) => payload?.text === chatText, {
      after: hostChatAfter,
      description: 'host chat echo',
    }),
    guest.expect('chat:new', (payload) => payload?.text === chatText, {
      after: guestChatAfter,
      description: 'guest receives host chat',
    }),
  ]);
  for (const message of [hostChat, guestChat]) {
    assert.equal(message.from, hostStart.yourAnonName);
    assert(Number.isFinite(message.ts), 'chat:new.ts must be numeric');
  }

  step('disconnect and restore the guest with room:rejoin');
  guest.disconnect();
  const rejoined = new Probe('normal-guest-rejoined', baseUrl);
  allProbes.push(rejoined);
  await rejoined.connect();
  const rejoinAfter = rejoined.mark();
  rejoined.emit('room:rejoin', { playerId: joined.playerId, code: created.code });
  const [rejoinState, rejoinStart, rejoinPhase] = await Promise.all([
    rejoined.expect(
      'room:state',
      (payload) =>
        payload?.players?.some(
          (player) => player.id === joined.playerId && player.connected === true,
        ),
      { after: rejoinAfter, description: 'rejoined player marked connected' },
    ),
    rejoined.expect('game:start', null, {
      after: rejoinAfter,
      description: 'game identity restored after room:rejoin',
    }),
    rejoined.expect(
      'phase:change',
      (payload) => ['CHAT', 'VOTE', 'DEFENSE'].includes(payload?.phase),
      { after: rejoinAfter, description: 'current phase restored after room:rejoin' },
    ),
  ]);
  assert.equal(rejoinStart.yourAnonName, guestStart.yourAnonName);
  assert.equal(rejoinStart.isSpectator, false);
  assert.deepEqual(rejoinStart.participants, hostStart.participants);
  assert.notEqual(rejoinState.hostId, created.playerId, 'a guest must not receive the host rejoin token');
  assertVisibleHost(rejoinState, 'rejoined guest state');
  assert(['CHAT', 'VOTE', 'DEFENSE'].includes(rejoinPhase.phase));

  const voteRejoin = new Probe('normal-guest-vote-rejoined', baseUrl);
  allProbes.push(voteRejoin);
  await voteRejoin.connect();

  step('cast a vote, rejoin during VOTE, and restore hasVoted=true');
  const votePhase = await host.expect('phase:change', (payload) => payload?.phase === 'VOTE', {
    after: normalVoteAfter,
    description: 'VOTE phase',
  });
  assertPhase(votePhase, 'VOTE');

  await Promise.all([
    host.emitAck(
      'vote:cast',
      { targetAnonName: guestStart.yourAnonName },
      'host vote:cast',
    ),
    rejoined.emitAck(
      'vote:cast',
      { targetAnonName: hostStart.yourAnonName },
      'guest first vote:cast',
    ),
  ]);

  const voteRejoinAfter = voteRejoin.mark();
  const voteRejoinAckPromise = voteRejoin.emitAck(
    'room:rejoin',
    { playerId: joined.playerId, code: created.code },
    'VOTE room:rejoin',
  );
  const [voteRejoinAck, voteRejoinState, voteRejoinStart, voteRejoinPhase] =
    await Promise.all([
      voteRejoinAckPromise,
      voteRejoin.expect(
        'room:state',
        (payload) => payload?.phase === 'VOTE' && payload?.hasVoted === true,
        { after: voteRejoinAfter, description: 'VOTE rejoin hasVoted snapshot' },
      ),
      voteRejoin.expect('game:start', null, {
        after: voteRejoinAfter,
        description: 'VOTE rejoin identity snapshot',
      }),
      voteRejoin.expect(
        'phase:change',
        (payload) => payload?.phase === 'VOTE' && payload?.round === 1,
        { after: voteRejoinAfter, description: 'VOTE rejoin current phase snapshot' },
      ),
    ]);
  assert.equal(voteRejoinAck.playerId, joined.playerId);
  assert.equal(voteRejoinState.hasVoted, true);
  assert.equal(voteRejoinState.yourAnonName, guestStart.yourAnonName);
  assert.equal(voteRejoinState.isSpectator, false);
  assert.equal(voteRejoinStart.yourAnonName, guestStart.yourAnonName);
  assert.equal(voteRejoinStart.isSpectator, false);
  assert.deepEqual(voteRejoinStart.participants, hostStart.participants);
  assertPhase(voteRejoinPhase, 'VOTE');

  step('reject a second vote from the rejoined voter');
  await expectRejectedAck(
    voteRejoin,
    'vote:cast',
    { targetAnonName: hostStart.yourAnonName },
    'duplicate vote:cast',
  );

  step('enter final defense before revealing the most-voted participant');
  const defenseAfterHost = host.mark();
  const defenseAfterGuest = voteRejoin.mark();
  const [hostDefensePhase, guestDefensePhase] = await Promise.all([
    host.expect('phase:change', (payload) => payload?.phase === 'DEFENSE', {
      after: defenseAfterHost,
      description: 'normal DEFENSE phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    }),
    voteRejoin.expect('phase:change', (payload) => payload?.phase === 'DEFENSE', {
      after: defenseAfterGuest,
      description: 'guest normal DEFENSE phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    }),
  ]);
  assertPhase(hostDefensePhase, 'DEFENSE');
  assert.deepEqual(guestDefensePhase, hostDefensePhase);
  assert(new Set(hostStart.participants).has(hostDefensePhase.defenseTarget));
  await exerciseHumanDefense(
    host,
    hostDefensePhase.defenseTarget,
    hostStart.yourAnonName,
    'normal host',
  );
  await exerciseHumanDefense(
    voteRejoin,
    hostDefensePhase.defenseTarget,
    guestStart.yourAnonName,
    'normal guest',
  );

  const revealAfterHost = host.mark();
  const revealAfterGuest = voteRejoin.mark();

  const [hostRevealPhase, reveal, guestReveal] = await Promise.all([
    host.expect('phase:change', (payload) => payload?.phase === 'REVEAL', {
      after: revealAfterHost,
      description: 'REVEAL phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    }),
    host.expect('vote:reveal', null, {
      after: revealAfterHost,
      description: 'vote:reveal payload',
    }),
    voteRejoin.expect('vote:reveal', null, {
      after: revealAfterGuest,
      description: 'VOTE-rejoined guest receives vote reveal',
    }),
  ]);
  assertPhase(hostRevealPhase, 'REVEAL');
  const participantSet = new Set(hostStart.participants);
  assertVoteReveal(reveal, participantSet);
  assert.equal(
    reveal.items.length,
    hostStart.participants.length,
    'both humans and all three AIs must submit a vote in the normal game',
  );
  assert.deepEqual(guestReveal, reveal, 'all human clients must receive the same vote reveal');
  assert(
    reveal.items.some(
      (item) => item.voter === hostStart.yourAnonName && item.target === guestStart.yourAnonName,
    ),
    'host vote was not present in vote:reveal',
  );
  assert(
    reveal.items.some(
      (item) => item.voter === guestStart.yourAnonName && item.target === hostStart.yourAnonName,
    ),
    'guest vote was not present in vote:reveal',
  );

  step('verify END and the full identity reveal');
  const [endPhase, gameOver, guestGameOver] = await Promise.all([
    host.expect('phase:change', (payload) => payload?.phase === 'END', {
      after: revealAfterHost,
      description: 'END phase',
    }),
    host.expect('game:over', null, {
      after: revealAfterHost,
      description: 'game:over',
    }),
    voteRejoin.expect('game:over', null, {
      after: revealAfterGuest,
      description: 'VOTE-rejoined guest receives game:over',
    }),
  ]);
  assertPhase(endPhase, 'END');
  assertGameOver(gameOver, hostStart.participants);
  assert.deepEqual(guestGameOver, gameOver);
  assert.equal(
    gameOver.reveal.filter((identity) => identity.isAI).length,
    3,
    'normal game must reveal exactly three AIs',
  );
  assert.equal(
    gameOver.reveal.filter((identity) => !identity.isAI).length,
    2,
    'normal game must reveal two humans',
  );
  assert.deepEqual(
    new Set(
      gameOver.reveal
        .filter((identity) => !identity.isAI)
        .map((identity) => identity.realNickname),
    ),
    new Set(['host-e2e', 'guest-e2e']),
    'human nicknames must be revealed at game over',
  );
  const spectatorResult = gameOver.betLeaderboard.find(
    (entry) => entry.nickname === 'chat-join-e2e',
  );
  assertObject(spectatorResult, 'late spectator leaderboard entry');
  assert.equal(spectatorResult.total, 1, 'the spectator must have one resolved prediction');
  assert.equal(spectatorResult.score, 1, 'betting on a known human must score one point');

  step('join during END and verify result plus game:over are restored');
  const endJoin = new Probe('normal-end-join', baseUrl);
  allProbes.push(endJoin);
  await endJoin.connect();
  const endJoinAfter = endJoin.mark();
  const endJoinAckPromise = endJoin.emitAck(
    'room:join',
    { code: created.code, nickname: 'end-join-e2e' },
    'END room:join',
  );
  const [endJoinAck, endJoinStart, endJoinState, endJoinPhase, restoredGameOver] =
    await Promise.all([
      endJoinAckPromise,
      endJoin.expect('game:start', (payload) => payload?.isSpectator === true, {
        after: endJoinAfter,
        description: 'END join spectator identity',
      }),
      endJoin.expect(
        'room:state',
        (payload) =>
          payload?.phase === 'END' &&
          payload?.lifecycle === 'END' &&
          Array.isArray(payload?.result?.reveal),
        { after: endJoinAfter, description: 'END join result snapshot' },
      ),
      endJoin.expect('phase:change', (payload) => payload?.phase === 'END', {
        after: endJoinAfter,
        description: 'END join current phase snapshot',
      }),
      endJoin.expect('game:over', null, {
        after: endJoinAfter,
        description: 'END join game:over snapshot',
      }),
    ]);
  assert.equal(endJoinAck.code, created.code);
  assert.equal(typeof endJoinAck.playerId, 'string');
  assert.equal(endJoinStart.yourAnonName, '');
  assert.equal(endJoinStart.isSpectator, true);
  assert.deepEqual(endJoinStart.participants, hostStart.participants);
  assert.equal(endJoinStart.round, 1);
  assert.equal(endJoinState.round, 1);
  assert.equal(endJoinState.isSpectator, true);
  assert.deepEqual(endJoinState.participants, hostStart.participants);
  const endJoinPlayer = endJoinState.players.find(
    (player) => player.id === endJoinAck.playerId,
  );
  assertObject(endJoinPlayer, 'END join player state');
  assert.equal(endJoinPlayer.isYou, true);
  assert.equal(endJoinPlayer.connected, true);
  assert.equal(endJoinPlayer.isSpectator, true);
  assert.equal(endJoinPlayer.alive, false);
  assertPhase(endJoinPhase, 'END');
  assertGameOver(restoredGameOver, hostStart.participants);
  assert.deepEqual(restoredGameOver, gameOver);
  assert.deepEqual(endJoinState.result, restoredGameOver);

  chatJoin.disconnect();
  endJoin.disconnect();

  step('return the same room to a connected lobby with room:again');
  const hostAgainAfter = host.mark();
  const guestAgainAfter = voteRejoin.mark();
  host.emit('room:again');
  const [hostLobby, guestLobby] = await Promise.all([
    host.expect(
      'room:state',
      (payload) => payload?.players?.length === 2,
      { after: hostAgainAfter, description: 'host lobby after room:again' },
    ),
    voteRejoin.expect(
      'room:state',
      (payload) => payload?.players?.length === 2,
      { after: guestAgainAfter, description: 'guest lobby after room:again' },
    ),
  ]);
  assert.equal(hostLobby.hostId, created.playerId);
  assertVisibleHost(hostLobby, 'host room:again lobby');
  assert.notEqual(guestLobby.hostId, created.playerId, 'guest lobby must hide the host rejoin token');
  assertVisibleHost(guestLobby, 'guest room:again lobby');
  assert(hostLobby.players.every((player) => player.connected));
  assert.deepEqual(
    new Set(hostLobby.players.map((player) => player.nickname)),
    new Set(['host-e2e', 'guest-e2e']),
  );

  return { host, guest: voteRejoin };
}

async function runSoloFlow(baseUrl, allProbes) {
  console.log('\n[2/6] Solo room: one human plays a complete round with three AIs');
  const solo = new Probe('solo-host', baseUrl);
  allProbes.push(solo);
  await solo.connect();

  step('create a one-human room and start with exactly three AI participants');
  await createRoom(solo, 'solo-e2e');
  const started = await startGame(solo, [], {
    aiCount: 3,
    rounds: 1,
    spectatorMode: false,
    difficulty: 'mild',
  });
  const [gameStart] = started.starts;
  assertObject(gameStart, 'solo game:start');
  assert.equal(gameStart.isSpectator, false);
  assert.equal(typeof gameStart.yourAnonName, 'string');
  assertParticipants(gameStart.participants, 4, 'solo game');
  assert(gameStart.participants.includes(gameStart.yourAnonName));

  step('send the solo human chat message and receive the server echo');
  const chatText = `solo-e2e-${Date.now()}`;
  const chatAfter = solo.mark();
  solo.emit('chat:send', { text: chatText });
  const chat = await solo.expect('chat:new', (payload) => payload?.text === chatText, {
    after: chatAfter,
    description: 'solo chat echo',
  });
  assert.equal(chat.from, gameStart.yourAnonName);

  step('cast the solo human vote and complete reveal plus game over');
  const votePhase = await solo.expect('phase:change', (payload) => payload?.phase === 'VOTE', {
    after: started.marks.get(solo),
    description: 'solo VOTE phase',
  });
  assertPhase(votePhase, 'VOTE');
  const aiTarget = gameStart.participants.find((name) => name !== gameStart.yourAnonName);
  assert.equal(typeof aiTarget, 'string');
  await solo.emitAck(
    'vote:cast',
    { targetAnonName: aiTarget },
    'solo vote:cast',
  );

  const defenseAfter = solo.mark();
  const defensePhase = await solo.expect(
    'phase:change',
    (payload) => payload?.phase === 'DEFENSE',
    {
      after: defenseAfter,
      description: 'solo DEFENSE phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    },
  );
  assertPhase(defensePhase, 'DEFENSE');
  assert(new Set(gameStart.participants).has(defensePhase.defenseTarget));
  await exerciseHumanDefense(
    solo,
    defensePhase.defenseTarget,
    gameStart.yourAnonName,
    'solo human',
  );

  const revealAfter = solo.mark();
  const [revealPhase, reveal] = await Promise.all([
    solo.expect('phase:change', (payload) => payload?.phase === 'REVEAL', {
      after: revealAfter,
      description: 'solo REVEAL phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    }),
    solo.expect('vote:reveal', null, {
      after: revealAfter,
      description: 'solo vote:reveal',
    }),
  ]);
  assertPhase(revealPhase, 'REVEAL');
  assertVoteReveal(reveal, new Set(gameStart.participants));
  assert.equal(reveal.items.length, 4, 'the solo human and all three AIs must vote');
  assert(
    reveal.items.some(
      (item) => item.voter === gameStart.yourAnonName && item.target === aiTarget,
    ),
    'the solo human vote must be present in vote:reveal',
  );

  const [endPhase, gameOver] = await Promise.all([
    solo.expect('phase:change', (payload) => payload?.phase === 'END', {
      after: revealAfter,
      description: 'solo END phase',
    }),
    solo.expect('game:over', null, {
      after: revealAfter,
      description: 'solo game:over',
    }),
  ]);
  assertPhase(endPhase, 'END');
  assertGameOver(gameOver, gameStart.participants);
  assert.equal(
    gameOver.reveal.filter((identity) => identity.isAI).length,
    3,
    'solo game must reveal exactly three AIs',
  );
  assert.deepEqual(
    gameOver.reveal
      .filter((identity) => !identity.isAI)
      .map((identity) => identity.realNickname),
    ['solo-e2e'],
    'solo game must reveal the human nickname',
  );
  solo.close();
}

async function playThreeRoundAttempt({
  baseUrl,
  code,
  roomHost,
  roomHostPlayerId,
  peer,
  peerPlayerId,
  started,
  allProbes,
  verifyRejoinSnapshot,
}) {
  const [hostStart, peerStart] = started.starts;
  assertObject(hostStart, 'three-round host game:start');
  assertObject(peerStart, 'three-round peer game:start');
  assert.equal(hostStart.rounds, 3, 'three-round game:start must report three rounds');
  assert.equal(peerStart.rounds, 3, 'both humans must receive the three-round setting');
  assert.equal(hostStart.isSpectator, false);
  assert.equal(peerStart.isSpectator, false);
  assert.deepEqual(hostStart.participants, peerStart.participants);
  assertParticipants(hostStart.participants, 5, 'three-round game');

  const participantSet = new Set(hostStart.participants);
  const humanNames = new Set([hostStart.yourAnonName, peerStart.yourAnonName]);
  assert.equal(humanNames.size, 2, 'the two humans need distinct anonymous identities');
  const aliveNames = new Set(hostStart.participants);
  const humans = [
    { anonName: hostStart.yourAnonName, probe: roomHost, alive: true },
    { anonName: peerStart.yourAnonName, probe: peer, alive: true },
  ];
  const eliminatedNames = new Set();
  const reveals = [];
  let chatPhase = started.chatPhases[0];
  let phaseAfter = roomHost.mark();

  for (let round = 1; round <= 3; round += 1) {
    assertPhase(chatPhase, 'CHAT');
    assert.equal(chatPhase.round, round, `CHAT must advance to round ${round}`);

    const votePhase = await roomHost.expect(
      'phase:change',
      (payload) => payload?.phase === 'VOTE' && payload?.round === round,
      { after: phaseAfter, description: `round ${round} VOTE phase` },
    );
    assertPhase(votePhase, 'VOTE');

    const aliveBefore = new Set(aliveNames);
    const commonAiTarget = [...aliveBefore].find((name) => !humanNames.has(name));
    assert(commonAiTarget, `round ${round} needs a living AI vote target`);

    const connectedProbes = [...new Set(humans.map((human) => human.probe))];
    const defenseMarks = new Map(connectedProbes.map((probe) => [probe, probe.mark()]));
    await Promise.all(
      humans
        .filter((human) => human.alive)
        .map((human) =>
          human.probe.emitAck(
            'vote:cast',
            { targetAnonName: commonAiTarget },
            `round ${round} vote:cast`,
          ),
        ),
    );

    const receivedDefensePhases = await Promise.all(
      connectedProbes.map((probe) =>
        probe.expect(
          'phase:change',
          (payload) => payload?.phase === 'DEFENSE' && payload?.round === round,
          {
            after: defenseMarks.get(probe),
            description: `round ${round} DEFENSE phase`,
            timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
          },
        ),
      ),
    );
    const defensePhase = receivedDefensePhases[connectedProbes.indexOf(roomHost)];
    assertPhase(defensePhase, 'DEFENSE');
    assert(aliveBefore.has(defensePhase.defenseTarget));
    for (const receivedDefense of receivedDefensePhases) {
      assert.deepEqual(receivedDefense, defensePhase, `all clients must agree on round ${round} defense`);
    }
    const defendingHuman = humans.find(
      (human) => human.alive && human.anonName === defensePhase.defenseTarget,
    );
    if (defendingHuman) {
      await exerciseHumanDefense(
        defendingHuman.probe,
        defensePhase.defenseTarget,
        defendingHuman.anonName,
        `round ${round} human`,
      );
    }

    const revealMarks = new Map(connectedProbes.map((probe) => [probe, probe.mark()]));

    const [revealPhase, ...receivedReveals] = await Promise.all([
      roomHost.expect(
        'phase:change',
        (payload) => payload?.phase === 'REVEAL' && payload?.round === round,
        {
          after: revealMarks.get(roomHost),
          description: `round ${round} REVEAL phase`,
          timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
        },
      ),
      ...connectedProbes.map((probe) =>
        probe.expect('vote:reveal', null, {
          after: revealMarks.get(probe),
          description: `round ${round} vote:reveal`,
        }),
      ),
    ]);
    assertPhase(revealPhase, 'REVEAL');
    const reveal = receivedReveals[connectedProbes.indexOf(roomHost)];
    assertVoteReveal(reveal, participantSet);
    for (const received of receivedReveals) {
      assert.deepEqual(received, reveal, `all clients must agree on round ${round} reveal`);
    }
    assert.equal(
      reveal.items.length,
      aliveBefore.size,
      `every living participant must vote in round ${round}`,
    );
    for (const human of humans.filter((candidate) => candidate.alive)) {
      assert(
        reveal.items.some(
          (item) => item.voter === human.anonName && item.target === commonAiTarget,
        ),
        `round ${round} reveal must contain ${human.anonName}'s vote`,
      );
    }

    assertObject(reveal.eliminated, `round ${round} eliminated participant`);
    assert(aliveBefore.has(reveal.eliminated.anonName));
    aliveNames.delete(reveal.eliminated.anonName);
    eliminatedNames.add(reveal.eliminated.anonName);
    const eliminatedHuman = humans.find(
      (human) => human.anonName === reveal.eliminated.anonName,
    );
    if (eliminatedHuman) eliminatedHuman.alive = false;
    reveals.push(reveal);

    const stateAfterReveal = await roomHost.expect(
      'room:state',
      (payload) =>
        [...eliminatedNames].every((name) => payload?.eliminatedNames?.includes(name)),
      {
        after: revealMarks.get(roomHost),
        description: `round ${round} eliminatedNames state`,
      },
    );
    assert.deepEqual(
      new Set(stateAfterReveal.eliminatedNames),
      eliminatedNames,
      `room state must retain all eliminations through round ${round}`,
    );
    assert.equal(
      stateAfterReveal.eliminationHistory.length,
      eliminatedNames.size,
      `room state must retain public identity history through round ${round}`,
    );
    assert.deepEqual(
      new Set(stateAfterReveal.eliminationHistory.map((item) => item.anonName)),
      eliminatedNames,
    );

    if (verifyRejoinSnapshot && round === 1) {
      step('reconnect after round one and verify eliminatedNames is restored');
      const peerHuman = humans[1];
      const previousPeer = peerHuman.probe;
      previousPeer.disconnect();

      const rejoinedPeer = new Probe('round-peer-rejoined', baseUrl);
      allProbes.push(rejoinedPeer);
      await rejoinedPeer.connect();
      const rejoinAfter = rejoinedPeer.mark();
      const rejoinAckPromise = rejoinedPeer.emitAck(
        'room:rejoin',
        { playerId: peerPlayerId, code },
        'round-one room:rejoin',
      );
      const [rejoinAck, rejoinState, rejoinStart, rejoinPhase] = await Promise.all([
        rejoinAckPromise,
        rejoinedPeer.expect(
          'room:state',
          (payload) =>
            payload?.players?.some(
              (player) => player.id === peerPlayerId && player.connected === true,
            ) &&
            [...eliminatedNames].every((name) => payload?.eliminatedNames?.includes(name)),
          { after: rejoinAfter, description: 'rejoin snapshot with eliminatedNames' },
        ),
        rejoinedPeer.expect('game:start', null, {
          after: rejoinAfter,
          description: 'three-round identity restored on rejoin',
        }),
        rejoinedPeer.expect(
          'phase:change',
          (payload) => ['REVEAL', 'CHAT', 'VOTE', 'DEFENSE'].includes(payload?.phase),
          { after: rejoinAfter, description: 'three-round phase restored on rejoin' },
        ),
      ]);
      assert.equal(rejoinAck.playerId, peerPlayerId);
      assert.notEqual(rejoinState.hostId, roomHostPlayerId, 'peer snapshot must hide the host rejoin token');
      assertVisibleHost(rejoinState, 'three-round peer rejoin state');
      assert.deepEqual(new Set(rejoinState.eliminatedNames), eliminatedNames);
      assert.deepEqual(
        new Set(rejoinState.eliminationHistory.map((item) => item.anonName)),
        eliminatedNames,
      );
      assert.equal(rejoinStart.yourAnonName, peerHuman.anonName);
      assert.deepEqual(rejoinStart.participants, hostStart.participants);
      assert([round, round + 1].includes(rejoinPhase.round));
      peerHuman.probe = rejoinedPeer;
      previousPeer.close();
    }

    const transition = await roomHost.expect(
      'phase:change',
      (payload) =>
        payload?.phase === 'END' ||
        (payload?.phase === 'CHAT' && payload?.round === round + 1),
      {
        after: revealMarks.get(roomHost),
        description: round === 3 ? 'END after round three' : `round ${round + 1} CHAT or early END`,
      },
    );
    phaseAfter = revealMarks.get(roomHost);

    if (transition.phase === 'END') {
      assertPhase(transition, 'END');
      const gameOver = await roomHost.expect('game:over', null, {
        after: revealMarks.get(roomHost),
        description: round === 3 ? 'three-round game:over' : `early game:over after round ${round}`,
      });
      assertGameOver(gameOver, hostStart.participants);
      return {
        completed: round === 3,
        completedRounds: round,
        gameOver,
        peer: humans[1].probe,
        reveals,
      };
    }

    chatPhase = transition;
  }

  throw new Error('three-round attempt exited without END');
}

async function runThreeRoundChecklistFlow(baseUrl, allProbes) {
  console.log('\n[3/6] Checklist room: validation, host delegation, and three completed rounds');
  const originalHost = new Probe('round-original-host', baseUrl);
  const roomHost = new Probe('round-new-host', baseUrl);
  const duplicate = new Probe('round-duplicate', baseUrl);
  allProbes.push(originalHost, roomHost, duplicate);
  await Promise.all([originalHost.connect(), roomHost.connect(), duplicate.connect()]);

  step('reject a case-insensitive duplicate nickname');
  const created = await createRoom(originalHost, 'round-host-e2e');
  await expectRejectedAck(
    duplicate,
    'room:join',
    { code: created.code, nickname: 'ROUND-HOST-E2E' },
    'duplicate nickname room:join',
  );
  duplicate.close();

  const joined = await joinRoom(roomHost, originalHost, created.code, 'round-guest-e2e');

  step('reject a game start requested by a non-host');
  const unauthorizedStartAfter = roomHost.mark();
  await expectRejectedAck(
    roomHost,
    'room:start',
    { aiCount: 3, rounds: 3, spectatorMode: false, difficulty: 'mild' },
    'non-host room:start',
  );
  assert.equal(
    roomHost.records.some(
      (record) => record.id > unauthorizedStartAfter && record.event === 'game:start',
    ),
    false,
    'a rejected non-host start must not emit game:start',
  );

  step('disconnect the host, verify delegation, then rejoin the original player');
  const delegationAfter = roomHost.mark();
  originalHost.disconnect();
  const delegatedState = await roomHost.expect(
    'room:state',
    (payload) =>
      payload?.hostId === joined.playerId &&
      payload?.players?.some(
        (player) => player.isYou !== true && player.connected === false,
      ),
    { after: delegationAfter, description: 'host delegation after disconnect' },
  );
  assert.equal(
    delegatedState.players.find((player) => player.id === joined.playerId)?.isHost,
    true,
  );

  const returnedHost = new Probe('round-original-host-returned', baseUrl);
  allProbes.push(returnedHost);
  await returnedHost.connect();
  const returnAfter = returnedHost.mark();
  const returnAckPromise = returnedHost.emitAck(
    'room:rejoin',
    { playerId: created.playerId, code: created.code },
    'delegated host room:rejoin',
  );
  const [returnAck, returnedState] = await Promise.all([
    returnAckPromise,
    returnedHost.expect(
      'room:state',
      (payload) =>
        payload?.players?.some((player) => player.isYou === true && player.connected === true) &&
        payload?.players?.some((player) => player.isHost === true && player.id === payload.hostId),
      { after: returnAfter, description: 'original host rejoined as a peer' },
    ),
  ]);
  assert.equal(returnAck.playerId, created.playerId);
  assert.equal(returnedState.players.length, 2);

  let peer = returnedHost;
  let completed;
  const maximumAttempts = 4;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    step(`start exact 2-human + 3-AI game (three-round attempt ${attempt})`);
    const started = await startGame(roomHost, [peer], {
      aiCount: 3,
      rounds: 3,
      spectatorMode: false,
      difficulty: 'mild',
    });

    if (attempt === 1) {
      step('reject a chat message containing 141 code points');
      const oversizedText = 'x'.repeat(141);
      const oversizedAfter = roomHost.mark();
      await expectRejectedAck(
        roomHost,
        'chat:send',
        { text: oversizedText },
        '141-character chat:send',
      );
      assert.equal(
        roomHost.records.some(
          (record) =>
            record.id > oversizedAfter &&
            record.event === 'chat:new' &&
            record.payload?.text === oversizedText,
        ),
        false,
        'the rejected oversized message must not be published',
      );
    }

    const outcome = await playThreeRoundAttempt({
      baseUrl,
      code: created.code,
      roomHost,
      roomHostPlayerId: joined.playerId,
      peer,
      peerPlayerId: created.playerId,
      started,
      allProbes,
      verifyRejoinSnapshot: attempt === 1,
    });
    peer = outcome.peer;
    if (outcome.completed) {
      completed = outcome;
      break;
    }

    assert(
      attempt < maximumAttempts,
      `humans were eliminated before round three in all ${maximumAttempts} attempts`,
    );
    step(`attempt ${attempt} ended after round ${outcome.completedRounds}; reset and retry`);
    const hostAgainAfter = roomHost.mark();
    const peerAgainAfter = peer.mark();
    await roomHost.emitAck('room:again', {}, 'three-round retry room:again');
    const [hostLobby, peerLobby] = await Promise.all([
      roomHost.expect('room:state', (payload) => payload?.phase === 'LOBBY', {
        after: hostAgainAfter,
        description: 'retry host lobby',
      }),
      peer.expect('room:state', (payload) => payload?.phase === 'LOBBY', {
        after: peerAgainAfter,
        description: 'retry peer lobby',
      }),
    ]);
    assert.equal(hostLobby.hostId, joined.playerId);
    assertVisibleHost(hostLobby, 'three-round host retry lobby');
    assert.notEqual(peerLobby.hostId, joined.playerId, 'peer lobby must hide the host rejoin token');
    assertVisibleHost(peerLobby, 'three-round peer retry lobby');
    assert(hostLobby.players.every((player) => player.connected));
  }

  assert(completed, 'a full three-round attempt must complete');
  assert.equal(completed.completedRounds, 3);
  assert.equal(completed.reveals.length, 3, 'exactly three round reveals must be observed');
  assert.equal(
    completed.gameOver.reveal.filter((identity) => identity.isAI).length,
    3,
    'three-round result must reveal exactly three AIs',
  );
  assert.equal(
    completed.gameOver.reveal.filter((identity) => !identity.isAI).length,
    2,
    'three-round result must reveal exactly two humans',
  );
  roomHost.close();
  peer.close();
}

async function runAutomaticEvictionFlow(baseUrl, allProbes) {
  console.log('\n[4/6] Disconnect grace: host transfer and automatic identity reveal');
  const host = new Probe('eviction-host', baseUrl);
  const guest = new Probe('eviction-guest', baseUrl);
  allProbes.push(host, guest);
  await Promise.all([host.connect(), guest.connect()]);

  const created = await createRoom(host, 'eviction-host-e2e');
  const joined = await joinRoom(guest, host, created.code, 'eviction-guest-e2e');
  const started = await startGame(host, [guest], {
    aiCount: 3,
    rounds: 3,
    spectatorMode: false,
    difficulty: 'mild',
  });
  const [hostStart] = started.starts;

  step('leave the active game and wait for scaled reconnect grace to expire');
  const disconnectAfter = guest.mark();
  host.disconnect();
  const delegatedState = await guest.expect(
    'room:state',
    (payload) =>
      payload?.hostId === joined.playerId &&
      payload?.players?.some(
        (player) => player.isYou !== true && player.connected === false,
      ),
    { after: disconnectAfter, description: 'in-game host delegation' },
  );
  assert.equal(delegatedState.hostId, joined.playerId);

  const [automaticReveal, evictionState] = await Promise.all([
    guest.expect('vote:reveal', (payload) => payload?.automatic === true, {
      after: disconnectAfter,
      description: 'automatic disconnect reveal',
      timeoutMs: AUTO_EVICTION_TIMEOUT_MS,
    }),
    guest.expect(
      'room:state',
      (payload) => payload?.eliminatedNames?.includes(hostStart.yourAnonName),
      {
        after: disconnectAfter,
        description: 'automatic elimination room state',
        timeoutMs: AUTO_EVICTION_TIMEOUT_MS,
      },
    ),
  ]);
  assertVoteReveal(automaticReveal, new Set(hostStart.participants));
  assert.equal(automaticReveal.automatic, true);
  assert.deepEqual(automaticReveal.items, []);
  assert.equal(automaticReveal.eliminated.anonName, hostStart.yourAnonName);
  assert.equal(automaticReveal.eliminated.wasAI, false);
  assert.equal(automaticReveal.eliminated.revealName, 'eviction-host-e2e');
  assert(evictionState.eliminatedNames.includes(hostStart.yourAnonName));
  assert(
    evictionState.eliminationHistory.some(
      (item) =>
        item.anonName === hostStart.yourAnonName &&
        item.wasAI === false &&
        item.revealName === 'eviction-host-e2e',
    ),
  );

  step('reject the expired playerId, then allow a fresh spectator join');
  const expiredPlayer = new Probe('eviction-expired-player', baseUrl);
  allProbes.push(expiredPlayer);
  await expiredPlayer.connect();
  await expectRejectedAck(
    expiredPlayer,
    'room:rejoin',
    { playerId: created.playerId, code: created.code },
    'expired room:rejoin',
  );
  const freshJoinAfter = expiredPlayer.mark();
  const [freshAck, freshStart] = await Promise.all([
    expiredPlayer.emitAck(
      'room:join',
      { code: created.code, nickname: 'eviction-host-e2e' },
      'expired player spectator room:join',
    ),
    expiredPlayer.expect('game:start', (payload) => payload?.isSpectator === true, {
      after: freshJoinAfter,
      description: 'expired player fresh spectator identity',
    }),
  ]);
  assert.equal(freshAck.code, created.code);
  assert.notEqual(freshAck.playerId, created.playerId);
  assert.equal(freshStart.isSpectator, true);
  expiredPlayer.close();
  guest.close();
}

async function runSpectatorFlow(baseUrl, allProbes) {
  console.log('\n[5/6] Spectator room: one human watches an AI-only game');
  const spectator = new Probe('spectator-host', baseUrl);
  allProbes.push(spectator);
  await spectator.connect();
  await createRoom(spectator, 'spectator-e2e');

  step('start spectator mode and verify only 6-8 anonymous AI participants play');
  const started = await startGame(spectator, [], {
    aiCount: 6,
    rounds: 1,
    spectatorMode: true,
    difficulty: 'mild',
  });
  const gameStart = started.starts[0];
  assert.equal(gameStart.isSpectator, true);
  assertParticipants(gameStart.participants, undefined, 'spectator game');
  assert(
    gameStart.participants.length >= 6 && gameStart.participants.length <= 8,
    `spectator mode must create 6-8 AI players, got ${gameStart.participants.length}`,
  );
  if (gameStart.yourAnonName != null) {
    assert(
      !gameStart.participants.includes(gameStart.yourAnonName),
      'spectator must not appear in the participant list',
    );
  }

  step('reject spectator betting in the all-AI spectator mode');
  await expectRejectedAck(
    spectator,
    'spectator:bet',
    { targetAnonName: gameStart.participants[0] },
    'AI-only spectator:bet',
  );
  const spectatorSequenceAfter = spectator.mark();

  step('let the AI-only round vote, defend, reveal, and finish without human input');
  const votePhase = await spectator.expect(
    'phase:change',
    (payload) => payload?.phase === 'VOTE',
    { after: spectatorSequenceAfter, description: 'spectator VOTE phase' },
  );
  assertPhase(votePhase, 'VOTE');
  const defensePhase = await spectator.expect(
    'phase:change',
    (payload) => payload?.phase === 'DEFENSE',
    {
      after: spectatorSequenceAfter,
      description: 'spectator DEFENSE phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    },
  );
  assertPhase(defensePhase, 'DEFENSE');
  assert(new Set(gameStart.participants).has(defensePhase.defenseTarget));
  const genericTyping = await spectator.expect(
    'chat:typing',
    (payload) => payload?.isTyping === true,
    { after: spectatorSequenceAfter, description: 'anonymous AI typing signal' },
  );
  assert.deepEqual(
    Object.keys(genericTyping).sort(),
    ['isTyping'],
    'chat:typing must not reveal which participant is an AI',
  );
  const revealPhase = await spectator.expect(
    'phase:change',
    (payload) => payload?.phase === 'REVEAL',
    {
      after: spectatorSequenceAfter,
      description: 'spectator REVEAL phase',
      timeoutMs: ROUND_SEQUENCE_TIMEOUT_MS,
    },
  );
  assertPhase(revealPhase, 'REVEAL');
  const voteReveal = await spectator.expect('vote:reveal', null, {
    after: spectatorSequenceAfter,
    description: 'spectator vote:reveal',
  });
  assertVoteReveal(voteReveal, new Set(gameStart.participants));
  assert.equal(
    voteReveal.items.length,
    gameStart.participants.length,
    'every living AI should submit a spectator-mode vote',
  );

  const [endPhase, gameOver] = await Promise.all([
    spectator.expect('phase:change', (payload) => payload?.phase === 'END', {
      after: spectatorSequenceAfter,
      description: 'spectator END phase',
    }),
    spectator.expect('game:over', null, {
      after: spectatorSequenceAfter,
      description: 'spectator game:over',
    }),
  ]);
  assertPhase(endPhase, 'END');
  assertGameOver(gameOver, gameStart.participants);
  assert(
    gameOver.reveal.every((identity) => identity.isAI === true),
    'spectator-mode final reveal must identify every participant as AI',
  );
  spectator.close();
}

async function runRandomFlow(normalRoom) {
  console.log('\n[6/6] Random AI count from the reset normal-room lobby');
  const { host, guest } = normalRoom;
  step('start with aiCount=random and verify the hidden count obeys the server range');
  const started = await startGame(host, [guest], {
    aiCount: 'random',
    rounds: 1,
    spectatorMode: false,
    difficulty: 'spicy',
  });
  const [hostStart, guestStart] = started.starts;
  assert.equal(hostStart.isSpectator, false);
  assert.equal(guestStart.isSpectator, false);
  assert.deepEqual(hostStart.participants, guestStart.participants);
  assertParticipants(hostStart.participants, undefined, 'random game');
  const inferredAiCount = hostStart.participants.length - 2;
  assert(
    inferredAiCount >= 2 && inferredAiCount <= 4,
    `two humans with random AI count must produce 2-4 AIs, inferred ${inferredAiCount}`,
  );
}

async function runChatRateLimitIsolation(entry) {
  console.log('\n[guardrail] Shared-IP chat limits are isolated per participant');
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      OPENAI_API_KEY: '',
      GAME_TIME_SCALE,
      RATE_LIMIT_DISABLED: '0',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const getOutput = captureServerOutput(child);
  const first = new Probe('rate-limit-first', baseUrl);
  const second = new Probe('rate-limit-second', baseUrl);

  try {
    await waitForHealth(baseUrl, child);
    await Promise.all([first.connect(), second.connect()]);
    const created = await createRoom(first, 'rate-first-e2e');
    await joinRoom(second, first, created.code, 'rate-second-e2e');
    await startGame(first, [second], {
      aiCount: 1,
      rounds: 1,
      spectatorMode: false,
      difficulty: 'mild',
    });

    for (let index = 0; index < 5; index += 1) {
      await Promise.all([
        first.emitAck('chat:send', { text: `first-${index}` }, `first chat ${index + 1}`),
        second.emitAck('chat:send', { text: `second-${index}` }, `second chat ${index + 1}`),
      ]);
    }
    await Promise.all([
      expectRejectedAck(first, 'chat:send', { text: 'first-over-limit' }, 'first sixth chat'),
      expectRejectedAck(second, 'chat:send', { text: 'second-over-limit' }, 'second sixth chat'),
    ]);
    assert.equal(first.socket.connected, true);
    assert.equal(second.socket.connected, true);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${getOutput()}`);
  } finally {
    first.close();
    second.close();
    await stopServer(child);
  }
}

async function reservePort() {
  if (process.env.E2E_PORT) {
    const requested = Number(process.env.E2E_PORT);
    assert(Number.isInteger(requested) && requested > 0 && requested < 65_536, 'invalid E2E_PORT');
    return requested;
  }

  const server = createNetServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

async function buildServer() {
  if (process.env.E2E_SKIP_BUILD === '1') {
    console.log('[setup] Reusing existing compiled server (E2E_SKIP_BUILD=1)');
    return;
  }
  console.log('[setup] Building the server workspace');
  const npmArgs = ['run', 'build', '--workspace', 'server'];
  if (process.platform !== 'win32') {
    await runCommand('npm', npmArgs);
    return;
  }

  // CreateProcess cannot launch npm.cmd directly. Prefer npm's JavaScript
  // entry so the build remains shell-free and the arguments stay unambiguous.
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const npmCli of npmCliCandidates) {
    if (await fileExists(npmCli)) {
      await runCommand(process.execPath, [npmCli, ...npmArgs]);
      return;
    }
  }

  // Fixed fallback for uncommon Windows npm layouts.
  await runCommand('npm.cmd', npmArgs, { shell: true });
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveServerEntry() {
  if (process.env.E2E_SERVER_ENTRY) {
    const explicit = path.resolve(SERVER_DIR, process.env.E2E_SERVER_ENTRY);
    assert(await fileExists(explicit), `E2E_SERVER_ENTRY does not exist: ${explicit}`);
    return explicit;
  }

  const packagePath = path.join(SERVER_DIR, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  const candidates = [];
  if (typeof packageJson.main === 'string') candidates.push(packageJson.main);
  if (typeof packageJson.exports === 'string') candidates.push(packageJson.exports);

  const startMatch = packageJson.scripts?.start?.match(/(?:^|\s)node\s+["']?([^"'\s]+\.m?js)/);
  if (startMatch) candidates.push(startMatch[1]);
  candidates.push('dist/index.js', 'dist/server.js', 'dist/src/index.js', 'build/index.js');

  for (const candidate of [...new Set(candidates)]) {
    const absolute = path.resolve(SERVER_DIR, candidate);
    if (await fileExists(absolute)) return absolute;
  }
  throw new Error(
    `Could not locate the compiled server entry. Checked: ${candidates.join(', ')}. ` +
      'Build first or set E2E_SERVER_ENTRY.',
  );
}

function captureServerOutput(child) {
  let output = '';
  const capture = (name) => (chunk) => {
    const text = chunk.toString();
    output += `[${name}] ${text}`;
    if (output.length > 40_000) output = output.slice(-40_000);
    if (VERBOSE) process[name === 'stdout' ? 'stdout' : 'stderr'].write(`[server] ${text}`);
  };
  child.stdout?.on('data', capture('stdout'));
  child.stderr?.on('data', capture('stderr'));
  return () => output;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + EVENT_TIMEOUT_MS;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming healthy (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return await response.text();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health check timed out: ${lastError}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const waitForExit = (timeoutMs) =>
    new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        child.off('exit', onExit);
        resolve(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once('exit', onExit);
    });

  if (!(await waitForExit(3_000)) && child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(2_000);
  }
}

async function main() {
  const probes = [];
  let serverChild;
  let getServerOutput = () => '';

  try {
    await buildServer();
    const entry = await resolveServerEntry();
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    console.log(`[setup] Starting ${path.relative(ROOT_DIR, entry)} on ${baseUrl}`);
    console.log(`[setup] OPENAI_API_KEY is empty; GAME_TIME_SCALE=${GAME_TIME_SCALE}`);
    serverChild = spawn(process.execPath, [entry], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        OPENAI_API_KEY: '',
        GAME_TIME_SCALE,
        RATE_LIMIT_DISABLED: '1',
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    getServerOutput = captureServerOutput(serverChild);
    const spawnFailure = new Promise((_, reject) => serverChild.once('error', reject));
    const health = await Promise.race([waitForHealth(baseUrl, serverChild), spawnFailure]);
    console.log(`[setup] Health check passed: ${health.trim() || 'HTTP 200'}`);

    const normalRoom = await runNormalFlow(baseUrl, probes);
    await runSoloFlow(baseUrl, probes);
    await runThreeRoundChecklistFlow(baseUrl, probes);
    await runAutomaticEvictionFlow(baseUrl, probes);
    await runSpectatorFlow(baseUrl, probes);
    await runRandomFlow(normalRoom);
    await runChatRateLimitIsolation(entry);

    console.log('\nPASS: Socket.IO E2E contract completed successfully.');
    console.log(
      '      solo 1-human + 3-AI completion, normal/rejoin, exact three-round 2-human + 3-AI,',
    );
    console.log(
      '      interrogation, spectator betting, final defense, ending awards, difficulty,',
    );
    console.log(
      '      validation guards, host delegation/automatic eviction, spectator, and random AI verified.',
    );
  } catch (error) {
    console.error(`\nFAIL: ${error?.stack ?? error}`);
    const output = getServerOutput().trim();
    if (output) console.error(`\n--- child server output (tail) ---\n${output}\n--- end server output ---`);
    process.exitCode = 1;
  } finally {
    for (const probe of probes) probe.close();
    await stopServer(serverChild);
  }
}

await main();
