import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  AiCount,
  BetLeaderboardEntry,
  ChatMessage,
  Difficulty,
  GameAward,
  GameActions,
  GamePhase,
  GameResult,
  GameViewState,
  IdentityReveal,
  Interrogation,
  RoomPlayer,
  RoomSettings,
  SessionIdentity,
  StartSettings,
  SpectatorBet,
  VoteItem,
  VoteReveal,
  EliminatedPlayer,
} from '../types';
import { sanitizeRoomCode } from '../lib/game-utils';

const SESSION_KEY = 'find-the-human:session:v1';
const DEFAULT_SETTINGS: RoomSettings = {
  aiCount: 'random',
  rounds: 3,
  spectatorMode: false,
  difficulty: 'mild',
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringFrom(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

function numberFrom(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function booleanFrom(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

function normalizePhase(value: unknown): GamePhase | null {
  if (typeof value !== 'string') return null;
  const phase = value.toUpperCase();
  if (
    phase === 'LOBBY' ||
    phase === 'CHAT' ||
    phase === 'VOTE' ||
    phase === 'DEFENSE' ||
    phase === 'REVEAL'
  ) {
    return phase;
  }
  if (phase === 'END' || phase === 'ENDED' || phase === 'GAME_OVER') return 'END';
  return null;
}

function parseDifficulty(value: unknown, fallback: Difficulty): Difficulty {
  return value === 'mild' || value === 'spicy' ? value : fallback;
}

function parseAiCount(value: unknown, fallback: AiCount): AiCount {
  if (typeof value === 'string' && value.toLowerCase() === 'random') return 'random';
  const parsed = numberFrom(value);
  if (parsed === undefined) return fallback;
  return Math.min(8, Math.max(1, Math.round(parsed)));
}

function readSession(): SessionIdentity | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const playerId = stringFrom(parsed.playerId);
    const roomCode = stringFrom(parsed.roomCode);
    if (!playerId || !roomCode) return null;
    return { playerId, roomCode: sanitizeRoomCode(roomCode) };
  } catch {
    return null;
  }
}

function persistSession(session: SessionIdentity | null): void {
  try {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Private browsing and storage policies must not block the game itself.
  }
}

function parsePlayer(value: unknown, hostId: string | null): RoomPlayer | null {
  if (!isRecord(value)) return null;
  const id = stringFrom(value.id, value.playerId, value.socketId);
  const nickname = stringFrom(value.nickname, value.name);
  if (!id || !nickname) return null;
  const explicitAlive = booleanFrom(value.alive, value.isAlive);
  const eliminated = booleanFrom(value.eliminated, value.isEliminated);

  return {
    id,
    nickname,
    connected: booleanFrom(value.connected, value.isConnected) ?? true,
    isHost: booleanFrom(value.isHost) ?? id === hostId,
    isSpectator: booleanFrom(value.isSpectator, value.spectator) ?? false,
    anonName: stringFrom(value.anonName, value.anonymousName),
    alive: explicitAlive ?? (eliminated === undefined ? undefined : !eliminated),
  };
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value)) return null;
  const messages: ChatMessage[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue;
    const from = stringFrom(item.from, item.anonName, item.sender);
    const text = stringFrom(item.text, item.message);
    if (!from || !text) continue;
    const ts = numberFrom(item.ts, item.timestamp, item.createdAt) ?? Date.now() + index;
    messages.push({ key: `${from}:${ts}:${text}`, from, text, ts });
  }
  return messages;
}

function parseEliminatedPlayer(value: unknown): EliminatedPlayer | null {
  if (!isRecord(value)) return null;
  const anonName = stringFrom(value.anonName, value.name);
  if (!anonName) return null;
  return {
    anonName,
    wasAI: booleanFrom(value.wasAI, value.isAI) ?? false,
    revealName:
      stringFrom(value.revealName, value.realNickname, value.personaSummary) ?? '정체 미상',
  };
}

function parseEliminationHistory(value: unknown): EliminatedPlayer[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    const parsed = parseEliminatedPlayer(item);
    return parsed ? [parsed] : [];
  });
}

function parseVoteReveal(value: unknown): VoteReveal | null {
  if (!isRecord(value)) return null;
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: VoteItem[] = rawItems.flatMap((item) => {
    if (!isRecord(item)) return [];
    const voter = stringFrom(item.voter, item.from);
    const target = stringFrom(item.target, item.to);
    if (!voter || !target) return [];
    return [
      {
        voter,
        target,
        reason: stringFrom(item.reason) ?? '이유를 밝히지 않음',
      },
    ];
  });

  const eliminated = parseEliminatedPlayer(value.eliminated);

  return {
    items,
    eliminated,
    automatic: booleanFrom(value.automatic) ?? false,
  };
}

function parseGameResult(value: unknown): GameResult | null {
  if (!isRecord(value)) return null;
  const winner = stringFrom(value.winner);
  if (!winner) return null;
  const rawReveal = Array.isArray(value.reveal) ? value.reveal : [];
  const reveal: IdentityReveal[] = rawReveal.flatMap((item) => {
    if (!isRecord(item)) return [];
    const anonName = stringFrom(item.anonName, item.name);
    if (!anonName) return [];
    return [
      {
        anonName,
        isAI: booleanFrom(item.isAI, item.wasAI) ?? false,
        realNickname: stringFrom(item.realNickname, item.nickname),
        personaSummary: stringFrom(item.personaSummary, item.persona),
      },
    ];
  });
  const rawAwards = Array.isArray(value.awards) ? value.awards : [];
  const awards: GameAward[] = rawAwards.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringFrom(item.id);
    const title = stringFrom(item.title);
    const recipient = stringFrom(item.recipient);
    const detail = stringFrom(item.detail);
    if (!id || !title || !recipient || !detail) return [];
    return [{ id, title, recipient, detail }];
  });
  const rawBetLeaderboard = Array.isArray(value.betLeaderboard) ? value.betLeaderboard : [];
  const betLeaderboard: BetLeaderboardEntry[] = rawBetLeaderboard.flatMap((item) => {
    if (!isRecord(item)) return [];
    const nickname = stringFrom(item.nickname);
    const score = numberFrom(item.score);
    const total = numberFrom(item.total);
    if (!nickname || score === undefined || total === undefined) return [];
    return [{ nickname, score, total }];
  });
  return { winner, reveal, awards, betLeaderboard };
}

function parseInterrogation(value: unknown): Interrogation | null {
  if (!isRecord(value)) return null;
  const target = stringFrom(value.target);
  const question = stringFrom(value.question);
  const endsAt = numberFrom(value.endsAt);
  if (!target || !question || endsAt === undefined) return null;
  return { target, question, endsAt };
}

function parseSpectatorBet(value: unknown): SpectatorBet | null {
  if (!isRecord(value)) return null;
  const round = numberFrom(value.round);
  const targetAnonName = stringFrom(value.targetAnonName, value.target);
  if (round === undefined || !targetAnonName) return null;
  return { round, targetAnonName };
}

function participantNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => {
    if (typeof item === 'string') return item ? [item] : [];
    if (!isRecord(item)) return [];
    const name = stringFrom(item.anonName, item.name);
    return name ? [name] : [];
  });
}

function ackError(response: UnknownRecord): string | null {
  if (response.ok === false) {
    return stringFrom(response.error, response.message) ?? '요청을 처리하지 못했어요';
  }
  return stringFrom(response.error) ?? null;
}

function initialState(session: SessionIdentity | null): GameViewState {
  return {
    connected: false,
    connecting: true,
    reconnecting: session !== null,
    busy: false,
    roomCode: null,
    playerId: session?.playerId ?? null,
    players: [],
    settings: DEFAULT_SETTINGS,
    hostId: null,
    gameStarted: false,
    yourAnonName: null,
    isSpectator: false,
    participants: [],
    eliminatedNames: new Set<string>(),
    eliminationHistory: [],
    phase: 'LOBBY',
    endsAt: null,
    round: 0,
    totalRounds: DEFAULT_SETTINGS.rounds,
    questionCard: null,
    defenseTarget: null,
    defenseMessageSent: false,
    interrogation: null,
    interrogationUsed: false,
    spectatorBet: null,
    messages: [],
    typingNames: [],
    reveal: null,
    automaticReveals: [],
    result: null,
    hasVoted: false,
    notice: null,
  };
}

export function useGameSocket(): {
  state: GameViewState;
  actions: GameActions;
} {
  const initialSession = useMemo(readSession, []);
  const [state, setState] = useState<GameViewState>(() => initialState(initialSession));
  const sessionRef = useRef<SessionIdentity | null>(initialSession);
  const noticeIdRef = useRef(0);
  const rejoinAttemptRef = useRef(0);
  const socket = useMemo<Socket>(() => {
    const configuredUrl = import.meta.env.VITE_SOCKET_URL?.trim();
    return io(configuredUrl || undefined, {
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4_000,
      transports: ['websocket', 'polling'],
    });
  }, []);

  const notify = useCallback((message: string, tone: 'error' | 'info' | 'success' = 'info') => {
    noticeIdRef.current += 1;
    setState((current) => ({
      ...current,
      notice: { id: noticeIdRef.current, message, tone },
    }));
  }, []);

  const dismissNotice = useCallback(() => {
    setState((current) => ({ ...current, notice: null }));
  }, []);

  const emitWithAck = useCallback(
    (event: string, payload: UnknownRecord, timeoutMs = 8_000): Promise<UnknownRecord> =>
      new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('서버 응답이 늦어지고 있어요'));
        }, timeoutMs);

        const finish = (...args: unknown[]) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          const response = [...args].reverse().find(isRecord) ?? {};
          const errorMessage = ackError(response);
          if (errorMessage) {
            reject(new Error(errorMessage));
            return;
          }
          resolve(response);
        };

        socket.emit(event, payload, finish);
      }),
    [socket],
  );

  useEffect(() => {
    if (!state.notice) return undefined;
    const timeoutId = window.setTimeout(() => {
      setState((current) =>
        current.notice?.id === state.notice?.id ? { ...current, notice: null } : current,
      );
    }, 4_500);
    return () => window.clearTimeout(timeoutId);
  }, [state.notice]);

  const activeAutomaticReveal = state.automaticReveals[0];
  useEffect(() => {
    if (!activeAutomaticReveal) return undefined;
    const timerId = window.setTimeout(() => {
      setState((current) =>
        current.automaticReveals[0] === activeAutomaticReveal
          ? { ...current, automaticReveals: current.automaticReveals.slice(1) }
          : current,
      );
    }, 3_500);
    return () => window.clearTimeout(timerId);
  }, [activeAutomaticReveal]);

  useEffect(() => {
    const onConnect = async () => {
      setState((current) => ({
        ...current,
        connected: true,
        connecting: false,
      }));
      const cachedSession = sessionRef.current;
      if (!cachedSession) {
        setState((current) => ({ ...current, reconnecting: false }));
        return;
      }

      const attempt = rejoinAttemptRef.current + 1;
      rejoinAttemptRef.current = attempt;
      setState((current) => ({ ...current, reconnecting: true }));
      try {
        const response = await emitWithAck('room:rejoin', {
          playerId: cachedSession.playerId,
          code: cachedSession.roomCode,
        });
        if (rejoinAttemptRef.current !== attempt) return;
        const playerId = stringFrom(response.playerId) ?? cachedSession.playerId;
        const roomCode = sanitizeRoomCode(stringFrom(response.code) ?? cachedSession.roomCode);
        const refreshed = { playerId, roomCode };
        sessionRef.current = refreshed;
        persistSession(refreshed);
        setState((current) => ({
          ...current,
          playerId,
          roomCode,
          reconnecting: false,
          busy: false,
        }));
      } catch (error) {
        if (rejoinAttemptRef.current !== attempt) return;
        sessionRef.current = null;
        persistSession(null);
        setState((current) => ({
          ...initialState(null),
          connected: current.connected,
          connecting: false,
          reconnecting: false,
          notice: {
            id: noticeIdRef.current + 1,
            message: error instanceof Error ? error.message : '이전 방에 다시 들어갈 수 없어요',
            tone: 'error',
          },
        }));
        noticeIdRef.current += 1;
      }
    };

    const onDisconnect = () => {
      setState((current) => ({
        ...current,
        connected: false,
        connecting: false,
        busy: false,
      }));
    };

    const onConnectError = () => {
      setState((current) => ({
        ...current,
        connected: false,
        connecting: false,
        reconnecting: false,
      }));
    };

    const onRoomState = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const nestedGame = isRecord(payload.game)
        ? payload.game
        : isRecord(payload.snapshot)
          ? payload.snapshot
          : {};
      const hostId = stringFrom(payload.hostId, nestedGame.hostId) ?? null;
      const players = Array.isArray(payload.players)
        ? payload.players.flatMap((player) => {
            const parsed = parsePlayer(player, hostId);
            return parsed ? [parsed] : [];
          })
        : null;
      const rawSettings = isRecord(payload.settings)
        ? payload.settings
        : isRecord(nestedGame.settings)
          ? nestedGame.settings
          : {};
      const phase = normalizePhase(payload.phase ?? nestedGame.phase);
      const lifecycle = stringFrom(payload.status, payload.state, nestedGame.status)?.toUpperCase();
      const isLobby = phase === 'LOBBY' || lifecycle === 'LOBBY';
      const endsAt = numberFrom(payload.endsAt, nestedGame.endsAt);
      const round = numberFrom(payload.round, nestedGame.round);
      const questionCard = stringFrom(payload.questionCard, nestedGame.questionCard);
      const restoredMessages = parseMessages(
        payload.messages ?? payload.chatLog ?? nestedGame.messages ?? nestedGame.chatLog,
      );
      const restoredReveal = parseVoteReveal(payload.reveal ?? nestedGame.reveal);
      const restoredResult = parseGameResult(
        payload.result ?? payload.gameOver ?? nestedGame.result,
      );
      const restoredParticipants = participantNames(
        payload.participants ?? nestedGame.participants,
      );
      const restoredEliminationHistory = parseEliminationHistory(
        payload.eliminationHistory ?? nestedGame.eliminationHistory,
      );
      const restoredDefenseTarget =
        stringFrom(payload.defenseTarget, nestedGame.defenseTarget) ?? null;
      const restoredDefenseMessageSent = booleanFrom(
        payload.defenseMessageSent,
        nestedGame.defenseMessageSent,
      );
      const restoredInterrogation = parseInterrogation(
        payload.interrogation ?? nestedGame.interrogation,
      );
      const restoredInterrogationUsed = booleanFrom(
        payload.interrogationUsed,
        nestedGame.interrogationUsed,
      );
      const restoredSpectatorBet = parseSpectatorBet(
        payload.spectatorBet ?? nestedGame.spectatorBet,
      );
      const roomCode = sanitizeRoomCode(
        stringFrom(payload.code, payload.roomCode) ?? sessionRef.current?.roomCode ?? '',
      );

      setState((current) => {
        const nextSettings: RoomSettings = {
          aiCount: parseAiCount(rawSettings.aiCount, current.settings.aiCount),
          rounds: Math.max(
            1,
            Math.round(numberFrom(rawSettings.rounds) ?? current.settings.rounds),
          ),
          spectatorMode: booleanFrom(rawSettings.spectatorMode) ?? current.settings.spectatorMode,
          difficulty: parseDifficulty(rawSettings.difficulty, current.settings.difficulty),
        };
        const currentPlayerId = sessionRef.current?.playerId ?? current.playerId;
        const self = players?.find((player) => player.id === currentPlayerId);
        const namesFromPlayers = players
          ?.map((player) => player.anonName)
          .filter((name): name is string => Boolean(name));
        const nextParticipants = restoredParticipants ?? namesFromPlayers;
        const nextEliminated = new Set(current.eliminatedNames);
        const restoredEliminatedNames = participantNames(
          payload.eliminatedNames ?? nestedGame.eliminatedNames,
        );
        restoredEliminatedNames?.forEach((name) => nextEliminated.add(name));
        players?.forEach((player) => {
          if (player.alive === false && player.anonName) nextEliminated.add(player.anonName);
        });
        if (restoredReveal?.eliminated) {
          nextEliminated.add(restoredReveal.eliminated.anonName);
        }

        if (isLobby) {
          return {
            ...current,
            roomCode: roomCode || current.roomCode,
            players: players ?? current.players,
            hostId,
            settings: nextSettings,
            busy: false,
            gameStarted: false,
            yourAnonName: null,
            isSpectator: false,
            participants: [],
            eliminatedNames: new Set<string>(),
            eliminationHistory: [],
            phase: 'LOBBY',
            endsAt: null,
            round: 0,
            totalRounds: nextSettings.rounds,
            questionCard: null,
            defenseTarget: null,
            defenseMessageSent: false,
            interrogation: null,
            interrogationUsed: false,
            spectatorBet: null,
            messages: [],
            typingNames: [],
            reveal: null,
            automaticReveals: [],
            result: null,
            hasVoted: false,
          };
        }

        const restoredAnonName =
          stringFrom(
            payload.yourAnonName,
            nestedGame.yourAnonName,
            isRecord(payload.self) ? payload.self.anonName : undefined,
          ) ?? self?.anonName;
        const restoredSpectator =
          booleanFrom(
            payload.isSpectator,
            nestedGame.isSpectator,
            isRecord(payload.self) ? payload.self.isSpectator : undefined,
          ) ?? self?.isSpectator;

        return {
          ...current,
          roomCode: roomCode || current.roomCode,
          players: players ?? current.players,
          hostId,
          settings: nextSettings,
          busy: false,
          gameStarted:
            current.gameStarted ||
            phase === 'CHAT' ||
            phase === 'VOTE' ||
            phase === 'DEFENSE' ||
            phase === 'REVEAL' ||
            phase === 'END' ||
            lifecycle === 'PLAYING' ||
            lifecycle === 'END',
          yourAnonName: restoredAnonName ?? current.yourAnonName,
          isSpectator: restoredSpectator ?? current.isSpectator,
          participants: nextParticipants?.length ? nextParticipants : current.participants,
          eliminatedNames: nextEliminated,
          eliminationHistory: restoredEliminationHistory ?? current.eliminationHistory,
          phase: restoredResult ? 'END' : (phase ?? current.phase),
          endsAt: endsAt ?? current.endsAt,
          round: round ?? current.round,
          totalRounds: nextSettings.rounds,
          questionCard: questionCard ?? current.questionCard,
          defenseTarget:
            (restoredResult ? 'END' : (phase ?? current.phase)) === 'DEFENSE'
              ? restoredDefenseTarget
              : null,
          defenseMessageSent:
            (restoredResult ? 'END' : (phase ?? current.phase)) === 'DEFENSE'
              ? (restoredDefenseMessageSent ?? current.defenseMessageSent)
              : false,
          interrogation:
            (restoredResult ? 'END' : (phase ?? current.phase)) === 'CHAT'
              ? restoredInterrogation
              : null,
          interrogationUsed: restoredInterrogationUsed ?? current.interrogationUsed,
          spectatorBet: restoredSpectatorBet,
          messages: restoredMessages ?? current.messages,
          reveal: restoredReveal ?? current.reveal,
          result: restoredResult ?? current.result,
          hasVoted: booleanFrom(payload.hasVoted, nestedGame.hasVoted) ?? current.hasVoted,
        };
      });
    };

    const onGameStart = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const participants = participantNames(payload.participants) ?? [];
      setState((current) => ({
        ...current,
        busy: false,
        gameStarted: true,
        yourAnonName: stringFrom(payload.yourAnonName) ?? current.yourAnonName,
        isSpectator: booleanFrom(payload.isSpectator) ?? false,
        participants,
        eliminatedNames: new Set<string>(),
        eliminationHistory: [],
        phase: 'CHAT',
        round: numberFrom(payload.round) ?? 1,
        totalRounds: numberFrom(payload.rounds) ?? current.settings.rounds,
        defenseTarget: null,
        defenseMessageSent: false,
        interrogation: null,
        interrogationUsed: false,
        spectatorBet: null,
        messages: [],
        typingNames: [],
        reveal: null,
        automaticReveals: [],
        result: null,
        hasVoted: false,
      }));
    };

    const onPhaseChange = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const phase = normalizePhase(payload.phase);
      if (!phase) return;
      setState((current) => {
        const nextRound = numberFrom(payload.round) ?? current.round;
        const enteringNewRound = phase === 'CHAT' && nextRound !== current.round;
        const enteringDefense = phase === 'DEFENSE' && current.phase !== 'DEFENSE';
        return {
          ...current,
          busy: false,
          gameStarted: phase !== 'LOBBY',
          phase,
          endsAt: numberFrom(payload.endsAt) ?? null,
          round: nextRound,
          questionCard: stringFrom(payload.questionCard) ?? current.questionCard,
          defenseTarget: phase === 'DEFENSE' ? (stringFrom(payload.defenseTarget) ?? null) : null,
          defenseMessageSent:
            phase === 'DEFENSE'
              ? (booleanFrom(payload.defenseMessageSent) ??
                (enteringDefense ? false : current.defenseMessageSent))
              : false,
          interrogation: phase === 'CHAT' ? current.interrogation : null,
          interrogationUsed: phase === 'LOBBY' ? false : current.interrogationUsed,
          spectatorBet: phase === 'LOBBY' || enteringNewRound ? null : current.spectatorBet,
          reveal: phase === 'CHAT' ? null : current.reveal,
          result: phase === 'LOBBY' ? null : current.result,
          hasVoted:
            phase === 'CHAT'
              ? false
              : phase === 'VOTE' && current.phase !== 'VOTE'
                ? false
                : current.hasVoted,
          typingNames: phase === 'CHAT' ? current.typingNames : [],
        };
      });
    };

    const onInterrogationStart = (payload: unknown) => {
      const interrogation = parseInterrogation(payload);
      if (!interrogation) return;
      setState((current) => ({
        ...current,
        interrogation,
        interrogationUsed: true,
      }));
    };

    const onInterrogationEnd = () => {
      setState((current) => ({ ...current, interrogation: null }));
    };

    const onChatNew = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const from = stringFrom(payload.from);
      const text = stringFrom(payload.text);
      if (!from || !text) return;
      const ts = numberFrom(payload.ts) ?? Date.now();
      const message = { key: `${from}:${ts}:${text}`, from, text, ts };
      setState((current) => {
        if (current.messages.some((item) => item.key === message.key)) return current;
        return {
          ...current,
          messages: [...current.messages.slice(-299), message],
          defenseMessageSent:
            current.phase === 'DEFENSE' && current.yourAnonName === from
              ? true
              : current.defenseMessageSent,
          typingNames: [],
        };
      });
    };

    const onChatTyping = (payload: unknown) => {
      const isTyping = isRecord(payload)
        ? booleanFrom(payload.isTyping)
        : booleanFrom(payload);
      if (isTyping === undefined) return;
      // Deliberately ignore the sender field. Typing activity must never reveal
      // which anonymous participant is an AI before messages are published.
      setState((current) => ({
        ...current,
        typingNames: isTyping ? ['anonymous'] : [],
      }));
    };

    const onVoteReveal = (payload: unknown) => {
      const reveal = parseVoteReveal(payload);
      if (!reveal) return;
      setState((current) => {
        const eliminatedNames = new Set(current.eliminatedNames);
        if (reveal.eliminated) eliminatedNames.add(reveal.eliminated.anonName);
        const selfEliminated = reveal.eliminated?.anonName === current.yourAnonName;
        const eliminationHistory =
          reveal.eliminated &&
          !current.eliminationHistory.some((item) => item.anonName === reveal.eliminated?.anonName)
            ? [...current.eliminationHistory, reveal.eliminated]
            : current.eliminationHistory;
        if (reveal.automatic) {
          return {
            ...current,
            automaticReveals: [...current.automaticReveals, reveal],
            eliminatedNames,
            eliminationHistory,
            isSpectator: current.isSpectator || selfEliminated,
            typingNames: [],
          };
        }
        return {
          ...current,
          phase: 'REVEAL',
          defenseTarget: null,
          defenseMessageSent: false,
          interrogation: null,
          reveal,
          eliminatedNames,
          eliminationHistory,
          isSpectator: current.isSpectator || selfEliminated,
          typingNames: [],
        };
      });
    };

    const onGameOver = (payload: unknown) => {
      const result = parseGameResult(payload);
      if (!result) return;
      setState((current) => ({
        ...current,
        busy: false,
        gameStarted: true,
        phase: 'END',
        endsAt: null,
        defenseTarget: null,
        defenseMessageSent: false,
        interrogation: null,
        typingNames: [],
        result,
      }));
    };

    const onServerError = (payload: unknown) => {
      const message = isRecord(payload)
        ? stringFrom(payload.message, payload.error)
        : stringFrom(payload);
      notify(message ?? '잠시 문제가 생겼어요', 'error');
      setState((current) => ({
        ...current,
        busy: false,
        hasVoted: current.phase === 'VOTE' ? false : current.hasVoted,
      }));
    };

    const onRoomClosed = (payload: unknown) => {
      const message = isRecord(payload)
        ? stringFrom(payload.message, payload.reason)
        : stringFrom(payload);
      rejoinAttemptRef.current += 1;
      sessionRef.current = null;
      persistSession(null);
      noticeIdRef.current += 1;
      const noticeId = noticeIdRef.current;
      setState((current) => ({
        ...initialState(null),
        connected: current.connected,
        connecting: false,
        reconnecting: false,
        notice: {
          id: noticeId,
          message: message ?? '방이 종료되어 시작 화면으로 돌아왔어요',
          tone: 'info',
        },
      }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:state', onRoomState);
    socket.on('game:start', onGameStart);
    socket.on('phase:change', onPhaseChange);
    socket.on('interrogation:start', onInterrogationStart);
    socket.on('interrogation:end', onInterrogationEnd);
    socket.on('chat:new', onChatNew);
    socket.on('chat:typing', onChatTyping);
    socket.on('vote:reveal', onVoteReveal);
    socket.on('game:over', onGameOver);
    socket.on('room:closed', onRoomClosed);
    socket.on('error', onServerError);
    socket.connect();

    return () => {
      rejoinAttemptRef.current += 1;
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:state', onRoomState);
      socket.off('game:start', onGameStart);
      socket.off('phase:change', onPhaseChange);
      socket.off('interrogation:start', onInterrogationStart);
      socket.off('interrogation:end', onInterrogationEnd);
      socket.off('chat:new', onChatNew);
      socket.off('chat:typing', onChatTyping);
      socket.off('vote:reveal', onVoteReveal);
      socket.off('game:over', onGameOver);
      socket.off('room:closed', onRoomClosed);
      socket.off('error', onServerError);
      socket.disconnect();
    };
  }, [emitWithAck, notify, socket]);

  const enterRoom = useCallback(
    async (event: 'room:create' | 'room:join', nickname: string, code?: string) => {
      const cleanNickname = nickname.trim().slice(0, 16);
      if (!cleanNickname) {
        notify('닉네임을 먼저 입력해 주세요', 'error');
        return;
      }
      if (!socket.connected) {
        notify('서버에 연결 중이에요. 잠시만 기다려 주세요', 'error');
        return;
      }
      setState((current) => ({ ...current, busy: true }));
      try {
        const payload =
          event === 'room:create' ? { nickname: cleanNickname } : { nickname: cleanNickname, code };
        const response = await emitWithAck(event, payload);
        const roomCode = sanitizeRoomCode(
          stringFrom(response.code, response.roomCode) ?? code ?? '',
        );
        const playerId = stringFrom(response.playerId, response.id) ?? socket.id;
        if (!roomCode || !playerId) throw new Error('방 정보를 확인하지 못했어요');
        const session = { playerId, roomCode };
        sessionRef.current = session;
        persistSession(session);
        setState((current) => ({
          ...current,
          busy: false,
          roomCode,
          playerId,
        }));
      } catch (error) {
        setState((current) => ({ ...current, busy: false }));
        notify(error instanceof Error ? error.message : '방에 들어가지 못했어요', 'error');
      }
    },
    [emitWithAck, notify, socket],
  );

  const createRoom = useCallback(
    (nickname: string) => enterRoom('room:create', nickname),
    [enterRoom],
  );

  const joinRoom = useCallback(
    (nickname: string, code: string) => enterRoom('room:join', nickname, sanitizeRoomCode(code)),
    [enterRoom],
  );

  const startGame = useCallback(
    (settings: StartSettings) => {
      if (!socket.connected) {
        notify('연결이 끊겼어요. 다시 연결하고 있어요', 'error');
        return;
      }
      setState((current) => ({ ...current, busy: true }));
      socket.emit('room:start', settings);
    },
    [notify, socket],
  );

  const sendChat = useCallback(
    async (text: string): Promise<void> => {
      const cleanText = text.trim().slice(0, 140);
      if (!cleanText) {
        const error = new Error('메시지를 입력해 주세요');
        notify(error.message, 'error');
        throw error;
      }
      if (!socket.connected) {
        const error = new Error('서버에 다시 연결한 뒤 보내 주세요');
        notify(error.message, 'error');
        throw error;
      }
      try {
        await emitWithAck('chat:send', { text: cleanText });
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error('메시지를 보내지 못했어요');
        notify(normalizedError.message, 'error');
        throw normalizedError;
      }
    },
    [emitWithAck, notify, socket],
  );

  const castVote = useCallback(
    (targetAnonName: string) => {
      if (!targetAnonName || !socket.connected) return;
      setState((current) => ({ ...current, hasVoted: true }));
      socket.emit('vote:cast', { targetAnonName });
    },
    [socket],
  );

  const useInterrogation = useCallback(
    (targetAnonName: string) => {
      if (!targetAnonName || !socket.connected) return;
      void emitWithAck('interrogation:use', { targetAnonName }).catch((error) => {
        notify(error instanceof Error ? error.message : '심문 카드를 사용하지 못했어요', 'error');
      });
    },
    [emitWithAck, notify, socket],
  );

  const placeSpectatorBet = useCallback(
    (targetAnonName: string) => {
      if (!targetAnonName || !socket.connected) return;
      const requestedRound = state.round;
      void emitWithAck('spectator:bet', { targetAnonName })
        .then((response) => {
          const acknowledgedBet = parseSpectatorBet(
            response.spectatorBet ??
              response.bet ?? {
                round: requestedRound,
                targetAnonName,
              },
          );
          if (!acknowledgedBet) return;
          setState((current) => ({
            ...current,
            spectatorBet: acknowledgedBet,
          }));
        })
        .catch((error) => {
          notify(error instanceof Error ? error.message : '예측을 등록하지 못했어요', 'error');
        });
    },
    [emitWithAck, notify, socket, state.round],
  );

  const playAgain = useCallback(() => {
    if (!socket.connected) {
      notify('서버에 다시 연결한 뒤 시도해 주세요', 'error');
      return;
    }
    socket.emit('room:again');
    setState((current) => ({
      ...current,
      busy: false,
      gameStarted: false,
      yourAnonName: null,
      isSpectator: false,
      participants: [],
      eliminatedNames: new Set<string>(),
      eliminationHistory: [],
      phase: 'LOBBY',
      endsAt: null,
      round: 0,
      questionCard: null,
      defenseTarget: null,
      defenseMessageSent: false,
      interrogation: null,
      interrogationUsed: false,
      spectatorBet: null,
      messages: [],
      typingNames: [],
      reveal: null,
      automaticReveals: [],
      result: null,
      hasVoted: false,
    }));
  }, [notify, socket]);

  const actions = useMemo<GameActions>(
    () => ({
      createRoom,
      joinRoom,
      startGame,
      sendChat,
      castVote,
      useInterrogation,
      placeSpectatorBet,
      playAgain,
      dismissNotice,
      notify,
    }),
    [
      castVote,
      createRoom,
      dismissNotice,
      joinRoom,
      notify,
      placeSpectatorBet,
      playAgain,
      sendChat,
      startGame,
      useInterrogation,
    ],
  );

  return { state, actions };
}
