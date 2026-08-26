import { randomUUID } from "node:crypto";
import {
  ADJECTIVES,
  ANIMALS,
  INTERROGATION_QUESTIONS,
  MOCK_LINES,
  MOCK_REASONS,
  PERSONAS,
  QUESTION_CARDS
} from "./content.js";
import { generateAiChat, generateAiVote, mockQuestionAnswer } from "./ai.js";
import type {
  AiSetting,
  Difficulty,
  EliminatedInfo,
  GameAward,
  GameIo,
  GameSocket,
  HumanPlayer,
  Participant,
  Persona,
  RevealPayload,
  Room,
  VoteRecord,
  Winner
} from "./types.js";
import {
  clampInt,
  codePointLength,
  pick,
  randomBetween,
  randomFloat,
  scaledMs,
  shuffle,
  sleep,
  truncateCodePoints
} from "./utils.js";

const CHAT_DURATION = 90_000;
const VOTE_DURATION = 30_000;
const DEFENSE_DURATION = 15_000;
const REVEAL_DURATION = 15_000;
const INTERROGATION_DURATION = 15_000;
const RECONNECT_GRACE = 60_000;
const AI_TICK = 3_000;
const AI_COOLDOWN = 8_000;
const SILENCE_THRESHOLD = 15_000;
const AI_START_GAP = 2_000;
const AI_TURN_GAP = 5_000;
const DIRECT_MENTION_WINDOW = 30_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOMS = 100;
const MAX_ROOM_OCCUPANTS = 10;
const MAX_CHAT_HISTORY = 300;
const ROOM_IDLE_TTL = 15 * 60_000;
const ROOM_ABSOLUTE_TTL = 2 * 60 * 60_000;
const ROOM_SWEEP_INTERVAL = 60_000;

const activeGamePhase = (room: Room): boolean =>
  room.phase === "CHAT" || room.phase === "VOTE" || room.phase === "DEFENSE" || room.phase === "REVEAL";

const personaSummary = (persona?: Persona): string => {
  if (!persona) return "정체불명 AI";
  return `${persona.age}세 ${persona.job} · ${persona.tone}`;
};

const nicknameFor = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("닉네임을 입력해 주세요");
  const nickname = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const length = codePointLength(nickname);
  if (length < 1 || length > 20) throw new Error("닉네임은 1~20자로 입력해 주세요");
  return nickname;
};

const inviteCodeFor = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("초대 코드를 입력해 주세요");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error("4자리 초대 코드를 확인해 주세요");
  return code;
};

const settingsAiCount = (value: unknown): AiSetting => {
  if (value === "random") return "random";
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error("AI 수는 1~8 또는 random이어야 합니다");
  }
  return parsed;
};

const settingsDifficulty = (value: unknown): Difficulty => {
  if (value === "mild" || value === "spicy") return value;
  throw new Error("난이도는 mild 또는 spicy여야 합니다");
};

export class GameEngine {
  readonly rooms = new Map<string, Room>();

  constructor(private readonly io: GameIo) {
    const roomSweepTimer = setInterval(() => this.sweepRooms(), ROOM_SWEEP_INTERVAL);
    roomSweepTimer.unref();
  }

  createRoom(socket: GameSocket, rawNickname: unknown): { code: string; playerId: string } {
    this.ensureSocketIsFree(socket);
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error("현재 생성 가능한 방이 모두 찼습니다. 잠시 후 다시 시도해 주세요");
    }
    const nickname = nicknameFor(rawNickname);
    const code = this.generateRoomCode();
    const player = this.createHuman(nickname, socket);
    const now = Date.now();
    const room: Room = {
      code,
      createdAt: now,
      lastActivityAt: now,
      hostId: player.id,
      humans: new Map([[player.id, player]]),
      phase: "LOBBY",
      settings: { aiCount: 3, rounds: 3, spectatorMode: false, difficulty: "mild" },
      participants: [],
      participantOrder: [],
      currentRound: 0,
      usedQuestions: new Set(),
      interrogationUsed: false,
      scheduledAiStarts: [],
      chats: [],
      votes: new Map(),
      voteHistory: [],
      aiVoteTasks: [],
      defenseMessageSent: false,
      resolvedBetRounds: new Set(),
      eliminationHistory: [],
      transitioning: false,
      lastChatAt: Date.now()
    };
    this.rooms.set(code, room);
    this.attachSocket(room, player, socket);
    this.emitRoomState(room);
    return { code, playerId: player.id };
  }

  joinRoom(socket: GameSocket, rawCode: unknown, rawNickname: unknown): { code: string; playerId: string } {
    this.ensureSocketIsFree(socket);
    const code = inviteCodeFor(rawCode);
    const room = this.requireRoom(code);
    if (room.humans.size >= MAX_ROOM_OCCUPANTS) {
      throw new Error("이 방은 최대 10명까지 참가할 수 있습니다");
    }
    const nickname = nicknameFor(rawNickname);
    if ([...room.humans.values()].some((human) => human.nickname.localeCompare(nickname, undefined, { sensitivity: "accent" }) === 0)) {
      throw new Error("이미 사용 중인 닉네임입니다");
    }

    const player = this.createHuman(nickname, socket);
    if (room.phase !== "LOBBY") {
      player.isSpectator = true;
      player.alive = false;
    }
    room.humans.set(player.id, player);
    this.touchRoom(room);
    if (!room.hostId || !room.humans.get(room.hostId)?.connected) room.hostId = player.id;
    this.attachSocket(room, player, socket);

    if (room.phase === "LOBBY") this.emitRoomState(room);
    else this.sendGameSnapshot(room, player);
    return { code, playerId: player.id };
  }

  rejoinRoom(socket: GameSocket, rawPlayerId: unknown, rawCode: unknown): { code: string; playerId: string } {
    const code = inviteCodeFor(rawCode);
    if (typeof rawPlayerId !== "string" || !rawPlayerId) throw new Error("재접속 정보가 올바르지 않습니다");
    const room = this.requireRoom(code);
    const player = room.humans.get(rawPlayerId);
    if (!player) throw new Error("재접속 유예 시간이 지났거나 참가 정보가 없습니다");

    if (socket.data.playerId && socket.data.playerId !== player.id) {
      throw new Error("이 연결은 이미 다른 참가자에게 연결되어 있습니다");
    }
    const previousSocketId = player.socketId;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = undefined;
    player.disconnectedAt = undefined;
    player.connected = true;
    player.socketId = socket.id;
    this.touchRoom(room);
    this.attachSocket(room, player, socket);

    if (previousSocketId && previousSocketId !== socket.id) {
      const previous = this.io.sockets.sockets.get(previousSocketId);
      if (previous) previous.disconnect(true);
    }

    if (!room.hostId || !room.humans.get(room.hostId)?.connected) this.assignHost(room);
    if (room.phase === "LOBBY") this.emitRoomState(room);
    else this.sendGameSnapshot(room, player);
    return { code, playerId: player.id };
  }

  startGame(
    socket: GameSocket,
    payload: { aiCount?: unknown; rounds?: unknown; spectatorMode?: unknown; difficulty?: unknown }
  ): void {
    const { room, player } = this.contextFor(socket);
    if (room.phase !== "LOBBY") throw new Error("이미 게임이 진행 중입니다");
    if (room.hostId !== player.id) throw new Error("방장만 게임을 시작할 수 있습니다");

    const spectatorMode = payload.spectatorMode === true;
    const aiCountSetting = settingsAiCount(payload.aiCount ?? room.settings.aiCount);
    const rounds = clampInt(payload.rounds, 1, 10, room.settings.rounds);
    const difficulty = settingsDifficulty(payload.difficulty ?? room.settings.difficulty);
    const connectedHumans = [...room.humans.values()].filter((human) => human.connected);
    if (connectedHumans.length < 1) {
      throw new Error(spectatorMode ? "관전 모드는 1명 이상 필요합니다" : "게임 시작에는 인간 1명 이상이 필요합니다");
    }

    room.settings = { aiCount: aiCountSetting, rounds, spectatorMode, difficulty };
    this.touchRoom(room);
    const randomMinimum = Math.min(8, Math.max(2, connectedHumans.length - 1));
    const randomMaximum = Math.min(8, Math.max(randomMinimum, connectedHumans.length + 2));
    room.resolvedAiCount = spectatorMode
      ? randomBetween(6, 8)
      : aiCountSetting === "random"
        ? randomBetween(randomMinimum, randomMaximum)
        : aiCountSetting;

    this.clearPhaseWork(room);
    room.currentRound = 0;
    room.usedQuestions.clear();
    room.interrogationUsed = false;
    room.interrogation = undefined;
    room.chats = [];
    room.votes.clear();
    room.voteHistory = [];
    room.defenseTarget = undefined;
    room.defenseMessageSent = false;
    room.pendingVoteItems = undefined;
    room.resolvedBetRounds.clear();
    room.lastReveal = undefined;
    room.eliminationHistory = [];
    room.winner = undefined;
    room.participants = [];

    for (const human of room.humans.values()) {
      human.anonName = undefined;
      human.isSpectator = spectatorMode || !human.connected;
      human.alive = human.connected && !spectatorMode;
      human.spectatorScore = 0;
      human.spectatorBets.clear();
    }

    const humanParticipants = spectatorMode
      ? []
      : connectedHumans.map((human): Participant => ({
          id: `human:${human.id}`,
          anonName: "",
          isAI: false,
          alive: true,
          humanId: human.id,
          realNickname: human.nickname,
          answeredQuestion: false,
          roundMessageCount: 0,
          lastSpokeAt: 0,
          speaking: false,
          speechGeneration: 0
        }));

    const selectedPersonas = shuffle(PERSONAS).slice(0, room.resolvedAiCount);
    const aiParticipants = selectedPersonas.map((persona): Participant => ({
      id: `ai:${randomUUID()}`,
      anonName: "",
      isAI: true,
      alive: true,
      persona,
      answeredQuestion: false,
      roundMessageCount: 0,
      lastSpokeAt: 0,
      speaking: false,
      speechGeneration: 0
    }));

    room.participants = [...humanParticipants, ...aiParticipants];
    const names = this.generateAnonNames(room.participants.length);
    room.participants.forEach((participant, index) => {
      participant.anonName = names[index] as string;
      if (participant.humanId) {
        const human = room.humans.get(participant.humanId);
        if (human) human.anonName = participant.anonName;
      }
    });
    room.participantOrder = shuffle(room.participants.map((participant) => participant.anonName));

    for (const human of connectedHumans) this.emitGameStart(room, human);
    this.beginChat(room);
  }

  sendChat(socket: GameSocket, rawText: unknown): void {
    const { room, player } = this.contextFor(socket);
    const participant = this.participantForHuman(room, player.id);
    if (!participant?.alive || player.isSpectator) throw new Error("관전자는 채팅할 수 없습니다");
    const isDefenseMessage = room.phase === "DEFENSE" && room.defenseTarget === participant.anonName;
    if (room.phase !== "CHAT" && !isDefenseMessage) throw new Error("지금은 채팅할 수 없습니다");
    if (isDefenseMessage && room.defenseMessageSent) throw new Error("최후 변론은 한 번만 할 수 있습니다");
    if (typeof rawText !== "string") throw new Error("메시지를 입력해 주세요");
    const text = rawText.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (!text) throw new Error("빈 메시지는 보낼 수 없습니다");
    if (codePointLength(text) > 140) throw new Error("메시지는 140자까지 보낼 수 있습니다");
    this.touchRoom(room);
    this.publishChat(room, participant.anonName, text);
    participant.roundMessageCount += 1;
    participant.lastSpokeAt = Date.now();

    if (isDefenseMessage) {
      room.defenseMessageSent = true;
      this.emitRoomState(room);
      return;
    }

    if (room.interrogation?.target === participant.anonName && !room.interrogation.answered) {
      room.interrogation.answered = true;
      this.endInterrogation(room, true);
    }
  }

  useInterrogation(socket: GameSocket, rawTarget: unknown): void {
    const { room, player } = this.contextFor(socket);
    if (room.phase !== "CHAT") throw new Error("심문은 채팅 시간에만 사용할 수 있습니다");
    if (room.interrogationUsed) throw new Error("이번 게임의 심문권은 이미 사용했습니다");
    const interrogator = this.participantForHuman(room, player.id);
    if (!interrogator?.alive || player.isSpectator) throw new Error("생존한 참가자만 심문할 수 있습니다");
    if (typeof rawTarget !== "string") throw new Error("심문 대상을 선택해 주세요");
    const target = room.participants.find((entry) => entry.alive && entry.anonName === rawTarget);
    if (!target) throw new Error("생존 중인 참가자만 심문할 수 있습니다");
    if (target.id === interrogator.id) throw new Error("자기 자신은 심문할 수 없습니다");

    const now = Date.now();
    const endsAt = now + scaledMs(INTERROGATION_DURATION);
    room.interrogationUsed = true;
    room.interrogation = {
      by: interrogator.anonName,
      target: target.anonName,
      question: pick(INTERROGATION_QUESTIONS),
      endsAt,
      answered: false
    };
    this.touchRoom(room);

    // 라운드 막판에도 심문 대상에게 온전한 답변 시간을 보장한다.
    if ((room.phaseEndsAt ?? 0) < endsAt) {
      room.phaseEndsAt = endsAt;
      if (room.phaseTimer) clearTimeout(room.phaseTimer);
      room.phaseTimer = setTimeout(() => this.beginVote(room), Math.max(0, endsAt - Date.now()));
      this.emitPhase(room);
    }

    const publicPayload = this.interrogationPayload(room);
    this.io.to(room.code).emit("interrogation:start", publicPayload);
    this.emitRoomState(room);
    room.interrogationTimer = setTimeout(() => this.endInterrogation(room, false), scaledMs(INTERROGATION_DURATION));

    if (target.isAI) void this.performForcedAiSpeech(room, target, "interrogated");
  }

  placeSpectatorBet(socket: GameSocket, rawTarget: unknown): { spectatorBet: { round: number; targetAnonName: string } } {
    const { room, player } = this.contextFor(socket);
    if (room.settings.spectatorMode) throw new Error("전원 AI 관전 모드에서는 베팅할 수 없습니다");
    if (room.phase !== "CHAT" && room.phase !== "VOTE") {
      throw new Error("베팅은 채팅 또는 투표 시간에만 할 수 있습니다");
    }
    if (!player.isSpectator) throw new Error("관전자만 인간 예측 베팅을 할 수 있습니다");
    if (player.spectatorBets.has(room.currentRound)) throw new Error("이번 라운드에는 이미 베팅했습니다");
    if (typeof rawTarget !== "string") throw new Error("베팅 대상을 선택해 주세요");
    const target = room.participants.find((entry) => entry.alive && entry.anonName === rawTarget);
    if (!target) throw new Error("생존 중인 참가자에게만 베팅할 수 있습니다");

    player.spectatorBets.set(room.currentRound, target.anonName);
    this.touchRoom(room);
    this.emitRoomState(room);
    return { spectatorBet: { round: room.currentRound, targetAnonName: target.anonName } };
  }

  castVote(socket: GameSocket, rawTarget: unknown): void {
    const { room, player } = this.contextFor(socket);
    if (room.phase !== "VOTE") throw new Error("지금은 투표할 수 없습니다");
    const voter = this.participantForHuman(room, player.id);
    if (!voter?.alive || player.isSpectator) throw new Error("관전자는 투표할 수 없습니다");
    if (typeof rawTarget !== "string") throw new Error("투표 대상을 선택해 주세요");
    const target = room.participants.find((entry) => entry.alive && entry.anonName === rawTarget);
    if (!target) throw new Error("생존 중인 참가자에게만 투표할 수 있습니다");
    if (target.id === voter.id) throw new Error("자기 자신에게는 투표할 수 없습니다");
    if (room.votes.has(voter.anonName)) throw new Error("이미 이번 라운드에 투표했습니다");
    room.votes.set(voter.anonName, {
      voter: voter.anonName,
      target: target.anonName,
      reason: "그냥 제일 수상해"
    });
    this.touchRoom(room);
  }

  again(socket: GameSocket): void {
    const { room, player } = this.contextFor(socket);
    if (room.phase !== "END") throw new Error("게임이 끝난 뒤 다시 할 수 있습니다");
    this.clearPhaseWork(room);
    room.phase = "LOBBY";
    room.currentRound = 0;
    room.phaseEndsAt = undefined;
    room.questionCard = undefined;
    room.participants = [];
    room.participantOrder = [];
    room.resolvedAiCount = undefined;
    room.chats = [];
    room.votes.clear();
    room.voteHistory = [];
    room.usedQuestions.clear();
    room.interrogationUsed = false;
    room.interrogation = undefined;
    room.defenseTarget = undefined;
    room.defenseMessageSent = false;
    room.pendingVoteItems = undefined;
    room.resolvedBetRounds.clear();
    room.lastReveal = undefined;
    room.eliminationHistory = [];
    room.winner = undefined;
    this.touchRoom(room);
    for (const [id, human] of room.humans) {
      if (!human.connected) {
        if (human.disconnectTimer) clearTimeout(human.disconnectTimer);
        room.humans.delete(id);
        continue;
      }
      human.anonName = undefined;
      human.isSpectator = false;
      human.alive = true;
      human.spectatorScore = 0;
      human.spectatorBets.clear();
    }
    this.assignHost(room, room.hostId || player.id);
    this.emitRoomState(room);
  }

  disconnect(socket: GameSocket): void {
    const code = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!code || !playerId) return;
    const room = this.rooms.get(code);
    const player = room?.humans.get(playerId);
    if (!room || !player || player.socketId !== socket.id) return;

    player.connected = false;
    player.socketId = undefined;
    player.disconnectedAt = Date.now();
    this.touchRoom(room);
    if (room.hostId === player.id) this.assignHost(room);
    this.emitRoomState(room);

    const disconnectedAt = player.disconnectedAt;
    player.disconnectTimer = setTimeout(() => {
      this.expireDisconnectedPlayer(room, player, disconnectedAt);
    }, scaledMs(RECONNECT_GRACE));
  }

  private beginChat(room: Room): void {
    if (room.phase === "END") return;
    this.clearPhaseWork(room);
    room.transitioning = false;
    room.phase = "CHAT";
    room.currentRound += 1;
    room.lastReveal = undefined;
    room.defenseTarget = undefined;
    room.defenseMessageSent = false;
    room.pendingVoteItems = undefined;
    room.votes.clear();
    room.aiVoteTasks = [];
    room.questionCard = this.nextQuestion(room);
    room.lastChatAt = Date.now();
    for (const participant of room.participants) {
      participant.answeredQuestion = false;
      participant.roundMessageCount = 0;
      participant.speaking = false;
    }
    this.setPhaseDeadline(room, CHAT_DURATION);
    this.emitPhase(room);
    this.emitRoomState(room);

    room.aiScheduler = setInterval(() => void this.evaluateAiSpeech(room), scaledMs(AI_TICK));
    void this.evaluateAiSpeech(room);
    room.phaseTimer = setTimeout(() => this.beginVote(room), scaledMs(CHAT_DURATION));
  }

  private beginVote(room: Room): void {
    if (room.phase !== "CHAT" || room.transitioning) return;
    room.transitioning = true;
    if (room.interrogation) this.endInterrogation(room, room.interrogation.answered);
    this.stopAiScheduler(room);
    this.ensureAiObligations(room);
    room.phase = "VOTE";
    room.transitioning = false;
    room.votes.clear();
    room.aiVoteTasks = [];
    this.setPhaseDeadline(room, VOTE_DURATION);
    this.emitPhase(room);
    this.emitRoomState(room);

    for (const ai of room.participants.filter((participant) => participant.isAI && participant.alive)) {
      const candidates = room.participants
        .filter((candidate) => candidate.alive && candidate.id !== ai.id)
        .map((candidate) => candidate.anonName);
      if (candidates.length === 0) continue;
      const task = this.generateBalancedAiVote(ai, room, candidates).then((vote) => {
        if (room.phase !== "VOTE" || !ai.alive || !room.participants.includes(ai)) return;
        if (!room.participants.some((candidate) => candidate.alive && candidate.anonName === vote.target)) return;
        room.votes.set(ai.anonName, { voter: ai.anonName, target: vote.target, reason: vote.reason });
      }).catch((error: unknown) => {
        console.warn(`[AI vote task] ${error instanceof Error ? error.message : String(error)}`);
      });
      room.aiVoteTasks.push(task);
    }

    room.phaseTimer = setTimeout(() => this.beginDefense(room), scaledMs(VOTE_DURATION));
  }

  private async generateBalancedAiVote(
    ai: Participant,
    room: Room,
    candidates: string[]
  ): Promise<{ target: string; reason: string }> {
    const roll = Math.random();
    const randomShare = room.settings.difficulty === "mild" ? 0.3 : 0.15;
    const heuristicShare = room.settings.difficulty === "mild" ? 0.45 : 0.25;

    if (roll < randomShare) {
      return {
        target: pick(candidates),
        reason: pick(["촉이 얘라고 소리침ㅋㅋ", "걍 눈에 걸려서 찍음", "운명이 얘래;;", "내 감은 은근 맞음"])
      };
    }

    if (roll < randomShare + heuristicShare) {
      const entries = candidates
        .map((name) => room.participants.find((participant) => participant.anonName === name))
        .filter((participant): participant is Participant => participant !== undefined);
      const huntQuiet = Math.random() < 0.5;
      const extreme = huntQuiet
        ? Math.min(...entries.map((participant) => participant.roundMessageCount))
        : Math.max(...entries.map((participant) => participant.roundMessageCount));
      const tied = entries.filter((participant) => participant.roundMessageCount === extreme);
      return {
        target: pick(tied).anonName,
        reason: huntQuiet
          ? pick(["말이 없어서 더 수상함", "조용히 숨는 거 다 보임", "한마디만 하고 잠수탐"])
          : pick(["혼자 너무 열심히 떠듦ㅋㅋ", "말 많아서 오히려 티남", "계속 몰아가는 게 수상함"])
      };
    }

    // API가 없는 매운맛은 LLM 몫까지 강한 발화량 휴리스틱으로 대체한다.
    // 그렇지 않으면 60%가 무작위 폴백이 되어 순한맛보다 둔해지는 역전이 생긴다.
    if (room.settings.difficulty === "spicy" && !process.env.OPENAI_API_KEY?.trim()) {
      const entries = candidates
        .map((name) => room.participants.find((participant) => participant.anonName === name))
        .filter((participant): participant is Participant => participant !== undefined);
      const loudestCount = Math.max(...entries.map((participant) => participant.roundMessageCount));
      const loudest = entries.filter((participant) => participant.roundMessageCount === loudestCount);
      return {
        target: pick(loudest).anonName,
        reason: pick(["제일 시끄러운 게 연막 같음", "계속 말 돌리는 거 딱 걸림", "과하게 떠드는 게 사람 티남"])
      };
    }

    return generateAiVote(ai, room, candidates);
  }

  private beginDefense(room: Room): void {
    if (room.phase !== "VOTE" || room.transitioning) return;
    room.transitioning = true;
    if (room.phaseTimer) clearTimeout(room.phaseTimer);

    // API가 늦거나 실패해도 AI 표를 동기 폴백해 상태 머신을 멈추지 않는다.
    for (const ai of room.participants.filter((participant) => participant.isAI && participant.alive)) {
      if (room.votes.has(ai.anonName)) continue;
      const candidates = room.participants.filter((candidate) => candidate.alive && candidate.id !== ai.id);
      if (candidates.length === 0) continue;
      room.votes.set(ai.anonName, {
        voter: ai.anonName,
        target: pick(candidates).anonName,
        reason: pick(MOCK_REASONS)
      });
    }

    const items = [...room.votes.values()].filter((vote) =>
      room.participants.some((participant) => participant.anonName === vote.voter)
    );
    const aliveNames = new Set(room.participants.filter((participant) => participant.alive).map((participant) => participant.anonName));
    const counts = new Map<string, number>();
    for (const item of items) {
      if (aliveNames.has(item.target)) counts.set(item.target, (counts.get(item.target) ?? 0) + 1);
    }

    let defenseTarget: string | undefined;
    if (counts.size > 0) {
      const maximum = Math.max(...counts.values());
      const tied = [...counts.entries()].filter(([, count]) => count === maximum).map(([name]) => name);
      // 동점 추첨은 한 번만 해야 한다. find 콜백 안에서 매번 뽑으면 후보마다
      // 결과가 바뀌어 드물게 아무도 일치하지 않는 플래키가 생긴다.
      defenseTarget = pick(tied);
    }

    room.voteHistory.push({ round: room.currentRound, items: items.map((item) => ({ ...item })) });
    room.pendingVoteItems = items;
    room.defenseTarget = defenseTarget;
    room.defenseMessageSent = false;

    if (!defenseTarget) {
      room.transitioning = false;
      this.beginReveal(room);
      return;
    }

    room.phase = "DEFENSE";
    room.transitioning = false;
    this.setPhaseDeadline(room, DEFENSE_DURATION);
    this.emitPhase(room);
    this.emitRoomState(room);

    const target = room.participants.find((participant) => participant.alive && participant.anonName === defenseTarget);
    if (target?.isAI) void this.performForcedAiSpeech(room, target, "defense");
    room.phaseTimer = setTimeout(() => this.beginReveal(room), scaledMs(DEFENSE_DURATION));
  }

  private beginReveal(room: Room): void {
    if ((room.phase !== "DEFENSE" && room.phase !== "VOTE") || room.transitioning) return;
    room.transitioning = true;
    if (room.phaseTimer) clearTimeout(room.phaseTimer);

    const items = room.pendingVoteItems ?? [];
    const target = room.defenseTarget
      ? room.participants.find((participant) => participant.alive && participant.anonName === room.defenseTarget)
      : undefined;
    const eliminated = target ? this.eliminate(room, target) : null;
    this.resolveSpectatorBets(room);

    room.phase = "REVEAL";
    room.transitioning = false;
    const revealPayload: RevealPayload = { items, eliminated };
    room.lastReveal = revealPayload;
    const revealDuration = Math.max(REVEAL_DURATION, 3_000 + items.length * 800);
    this.setPhaseDeadline(room, revealDuration);
    this.emitPhase(room);
    this.io.to(room.code).emit("vote:reveal", revealPayload);
    this.emitRoomState(room);
    room.phaseTimer = setTimeout(() => this.finishReveal(room), scaledMs(revealDuration));
  }

  private finishReveal(room: Room): void {
    if (room.phase !== "REVEAL" || room.transitioning) return;
    const alive = room.participants.filter((participant) => participant.alive);
    const aliveHumans = alive.filter((participant) => !participant.isAI);
    if (room.settings.spectatorMode) {
      if (room.currentRound >= room.settings.rounds || alive.length <= 1) {
        this.endGame(room, "NONE");
        return;
      }
    } else {
      if (aliveHumans.length === 0) {
        this.endGame(room, "AI");
        return;
      }
      if (room.currentRound >= room.settings.rounds || alive.length <= 1) {
        this.endGame(room, "HUMAN");
        return;
      }
    }
    this.beginChat(room);
  }

  private endGame(room: Room, winner: Winner): void {
    if (room.phase === "END") return;
    this.clearPhaseWork(room);
    room.phase = "END";
    room.winner = winner;
    room.phaseEndsAt = Date.now();
    room.questionCard = undefined;
    this.touchRoom(room);
    console.info(JSON.stringify({
      event: "game_complete",
      difficulty: room.settings.difficulty,
      winner,
      humans: room.participants.filter((participant) => !participant.isAI).length,
      aiCount: room.participants.filter((participant) => participant.isAI).length,
      roundsPlayed: room.currentRound
    }));
    this.emitPhase(room);
    this.io.to(room.code).emit("game:over", this.gameOverPayload(room));
    this.emitRoomState(room);
  }

  private async evaluateAiSpeech(room: Room): Promise<void> {
    if (room.phase !== "CHAT") return;
    const now = Date.now();
    const remaining = Math.max(0, (room.phaseEndsAt ?? now) - now);

    // 한 번에 여러 생성 요청이 시작되면 대화가 아니라 AI 답변 목록처럼 보인다.
    // 예약 대기까지 speaking에 포함되므로 방마다 자연 발화는 하나씩만 진행한다.
    if (room.participants.some((participant) => participant.isAI && participant.speaking)) return;

    const latestMessage = room.chats.at(-1);
    const latestSpeaker = latestMessage
      ? room.participants.find((participant) => participant.anonName === latestMessage.from)
      : undefined;
    if (
      latestMessage &&
      latestSpeaker?.isAI &&
      now - latestMessage.ts < scaledMs(AI_TURN_GAP)
    ) return;

    const recent = room.chats.slice(-8);
    const eligible = room.participants.filter((participant) =>
      participant.isAI && participant.alive && !participant.speaking && participant.roundMessageCount < 6 &&
      now - participant.lastSpokeAt >= scaledMs(AI_COOLDOWN)
    );
    if (eligible.length === 0) return;

    const silenceForced = now - room.lastChatAt >= scaledMs(SILENCE_THRESHOLD);
    const mentionCutoff = now - scaledMs(DIRECT_MENTION_WINDOW);
    const ranked = shuffle(eligible).map((ai) => {
      const latestMention = [...recent].reverse().find((message) =>
        message.from !== ai.anonName &&
        message.ts > Math.max(ai.lastSpokeAt, mentionCutoff) &&
        message.text.includes(ai.anonName)
      );
      return {
        ai,
        mentionedAt: latestMention?.ts ?? 0,
        priority: latestMention ? 2 : !ai.answeredQuestion ? 1 : 0
      };
    }).sort((left, right) =>
      right.priority - left.priority ||
      right.mentionedAt - left.mentionedAt ||
      left.ai.roundMessageCount - right.ai.roundMessageCount ||
      left.ai.lastSpokeAt - right.ai.lastSpokeAt
    );

    const selected = ranked[0];
    if (!selected) return;
    const trigger = selected.priority === 2
      ? "mentioned"
      : !selected.ai.answeredQuestion
        ? "question"
        : "natural";
    let probability = trigger === "mentioned" ? 1 : trigger === "question" ? 0.65 : 0.2;
    if (silenceForced || (remaining <= scaledMs(15_000) && trigger === "question")) probability = 1;
    if (Math.random() < probability) this.scheduleAiSpeech(room, selected.ai, trigger);
  }

  private scheduleAiSpeech(room: Room, participant: Participant, trigger: "natural" | "question" | "mentioned"): void {
    if (participant.speaking || room.phase !== "CHAT") return;
    const generation = ++participant.speechGeneration;
    participant.speaking = true;
    const now = Date.now();
    room.scheduledAiStarts = room.scheduledAiStarts.filter(
      (time) => time >= now - scaledMs(AI_START_GAP)
    );
    const latestStart = room.scheduledAiStarts.length > 0 ? Math.max(...room.scheduledAiStarts) : now - scaledMs(AI_START_GAP);
    const typingStart = Math.max(now, latestStart + scaledMs(AI_START_GAP));
    room.scheduledAiStarts.push(typingStart);

    setTimeout(() => {
      if (
        participant.speechGeneration !== generation ||
        room.phase !== "CHAT" ||
        !participant.alive ||
        !room.participants.includes(participant)
      ) {
        if (participant.speechGeneration === generation) participant.speaking = false;
        return;
      }
      void this.performAiSpeech(room, participant, trigger, generation);
    }, Math.max(0, typingStart - now));
  }

  private async performAiSpeech(
    room: Room,
    participant: Participant,
    trigger: "natural" | "question" | "mentioned",
    generation: number
  ): Promise<void> {
    this.io.to(room.code).emit("chat:typing", { isTyping: true });
    try {
      const minimumDelay = scaledMs(randomBetween(1_500, 6_000));
      const [generated] = await Promise.all([
        generateAiChat(participant, room, trigger),
        sleep(minimumDelay)
      ]);
      if (
        participant.speechGeneration !== generation ||
        room.phase !== "CHAT" ||
        !participant.alive ||
        !room.participants.includes(participant)
      ) return;
      const acceptedKeys = new Set<string>();
      const lines = generated.slice(0, 2).map((line) => this.postProcessAiText(line)).filter((line) => {
        if (!line || this.isRecentRepeat(room, line)) return false;
        const key = this.normalizedChatText(line);
        if (!key || [...acceptedKeys].some((accepted) => this.chatKeysRepeat(accepted, key))) return false;
        acceptedKeys.add(key);
        return true;
      });
      this.io.to(room.code).emit("chat:typing", { isTyping: false });
      for (let index = 0; index < lines.length; index += 1) {
        if (
          participant.speechGeneration !== generation ||
          room.phase !== "CHAT" ||
          !participant.alive ||
          !room.participants.includes(participant)
        ) break;
        if (index > 0) await sleep(scaledMs(randomBetween(700, 1_500)));
        if (
          participant.speechGeneration !== generation ||
          room.phase !== "CHAT" ||
          !participant.alive ||
          !room.participants.includes(participant)
        ) break;
        this.publishChat(room, participant.anonName, lines[index] as string);
      }
      if (lines.length > 0) {
        participant.roundMessageCount += 1;
        participant.lastSpokeAt = Date.now();
        if (trigger === "question") participant.answeredQuestion = true;
      } else {
        // 중복 출력을 버린 직후 같은 요청을 다시 보내는 비용/반복 루프를 막는다.
        participant.lastSpokeAt = Date.now();
      }
    } catch (error) {
      console.warn(`[AI speech] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (participant.speechGeneration === generation) {
        this.io.to(room.code).emit("chat:typing", { isTyping: false });
        participant.speaking = false;
      }
    }
  }

  private async performForcedAiSpeech(
    room: Room,
    participant: Participant,
    trigger: "interrogated" | "defense"
  ): Promise<void> {
    const stillRelevant = (): boolean => trigger === "interrogated"
      ? room.phase === "CHAT" && room.interrogation?.target === participant.anonName && !room.interrogation.answered
      : room.phase === "DEFENSE" && room.defenseTarget === participant.anonName && !room.defenseMessageSent;
    if (!participant.alive || !room.participants.includes(participant) || !stillRelevant()) return;

    // 강제 발화가 시작되면 이미 예약되거나 생성 중인 자연 발화를 무효화한다.
    const generation = ++participant.speechGeneration;
    participant.speaking = true;
    this.io.to(room.code).emit("chat:typing", { isTyping: true });
    try {
      const forcedDeadline = Math.min(room.phaseEndsAt ?? Number.POSITIVE_INFINITY, Date.now() + 3_500);
      const [generated] = await Promise.all([
        generateAiChat(participant, room, trigger, forcedDeadline),
        sleep(scaledMs(500))
      ]);
      if (
        participant.speechGeneration !== generation ||
        !participant.alive ||
        !room.participants.includes(participant) ||
        !stillRelevant()
      ) return;
      const text = this.postProcessAiText(generated[0] ?? pick(MOCK_LINES));
      if (!text) return;
      this.publishChat(room, participant.anonName, text);
      participant.roundMessageCount += 1;
      participant.lastSpokeAt = Date.now();

      if (trigger === "interrogated" && room.interrogation) {
        room.interrogation.answered = true;
        this.endInterrogation(room, true);
      } else if (trigger === "defense") {
        room.defenseMessageSent = true;
        this.emitRoomState(room);
      }
    } catch (error) {
      console.warn(`[AI forced speech] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (participant.speechGeneration === generation) {
        this.io.to(room.code).emit("chat:typing", { isTyping: false });
        participant.speaking = false;
      }
    }
  }

  private interrogationPayload(room: Room): Record<string, unknown> | undefined {
    const interrogation = room.interrogation;
    if (!interrogation) return undefined;
    return {
      target: interrogation.target,
      question: interrogation.question,
      endsAt: interrogation.endsAt
    };
  }

  private endInterrogation(room: Room, answered: boolean): void {
    const interrogation = room.interrogation;
    if (!interrogation) return;
    if (room.interrogationTimer) clearTimeout(room.interrogationTimer);
    room.interrogationTimer = undefined;
    room.interrogation = undefined;
    this.io.to(room.code).emit("interrogation:end", {
      target: interrogation.target,
      question: interrogation.question,
      answered,
      endedAt: Date.now()
    });
    this.emitRoomState(room);
  }

  private resolveSpectatorBets(room: Room): void {
    if (room.resolvedBetRounds.has(room.currentRound)) return;
    room.resolvedBetRounds.add(room.currentRound);
    for (const human of room.humans.values()) {
      const targetName = human.spectatorBets.get(room.currentRound);
      if (!targetName) continue;
      const target = room.participants.find((participant) => participant.anonName === targetName);
      if (target && !target.isAI) human.spectatorScore += 1;
    }
  }

  private ensureAiObligations(room: Room): void {
    const aliveAis = room.participants.filter((participant) => participant.isAI && participant.alive);
    // 누군가 이미 질문에 답했다면 라운드 종료 순간에 메시지를 억지로 끼워 넣지 않는다.
    if (aliveAis.some((ai) => ai.answeredQuestion)) return;

    const ai = shuffle(aliveAis).sort((left, right) =>
      left.roundMessageCount - right.roundMessageCount || left.lastSpokeAt - right.lastSpokeAt
    )[0];
    if (!ai || ai.roundMessageCount > 0) return;

    const fallback = this.contextualQuestionFallback(room, ai);
    if (!fallback) return;
    this.publishChat(room, ai.anonName, fallback);
    ai.answeredQuestion = true;
    ai.roundMessageCount += 1;
    ai.lastSpokeAt = Date.now();
  }

  private contextualQuestionFallback(room: Room, participant: Participant): string | undefined {
    const card = room.questionCard ?? "";
    const persona = participant.persona;
    const interest = persona?.interests.split(",")[0]?.trim();
    const job = persona?.job.split(",")[0]?.trim();
    let profileAnswer: string | undefined;

    if (interest && card.includes("사진")) profileAnswer = `${interest} 찍은거`;
    else if (interest && card.includes("검색")) profileAnswer = `${interest} 검색했지`;
    else if (interest && card.includes("스트레스")) profileAnswer = `${interest} 하면서 품`;
    else if (job && (card.includes("카톡") || card.includes("오래 얘기"))) profileAnswer = `${job} 사람이랑`;
    else if (persona && (card.includes("아침") || card.includes("일어났"))) {
      profileAnswer = `${6 + (persona.age % 5)}시쯤 일어남`;
    }

    for (const raw of [profileAnswer, mockQuestionAnswer(participant, room.questionCard)]) {
      if (!raw || this.isRecentRepeat(room, raw)) continue;
      const processed = this.postProcessAiText(raw);
      if (processed && !this.isRecentRepeat(room, processed)) return processed;
    }
    return undefined;
  }

  private normalizedChatText(text: string): string {
    return text
      .toLocaleLowerCase("ko-KR")
      .replace(/[ㅋㅎㅠㅜ]+/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  private isRecentRepeat(room: Room, text: string): boolean {
    const candidate = this.normalizedChatText(text);
    if (!candidate) return true;
    return room.chats.slice(-16).some((message) => {
      const previous = this.normalizedChatText(message.text);
      return previous ? this.chatKeysRepeat(previous, candidate) : false;
    });
  }

  private chatKeysRepeat(left: string, right: string): boolean {
    if (left === right) return true;
    const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
    return shorter.length >= 4 && longer.length - shorter.length <= 2 && longer.includes(shorter);
  }

  private postProcessAiText(raw: string): string {
    let text = raw.replace(/[\r\n]+/g, " ").replace(/^['\"“”]|['\"“”]$/g, "").trim();
    if (codePointLength(text) > 30) {
      const firstSentence = text.split(/[.!?。！？]/, 1)[0]?.trim() || text;
      text = truncateCodePoints(firstSentence, 30);
    }
    if (text && Math.random() < 0.15) text = this.injectTypo(text);
    return text;
  }

  private injectTypo(text: string): string {
    const characters = Array.from(text);
    const hangulIndexes = characters
      .map((character, index) => ({ code: character.codePointAt(0) ?? 0, index }))
      .filter(({ code }) => code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 > 0);
    if (hangulIndexes.length > 0 && Math.random() < 0.5) {
      const chosen = pick(hangulIndexes);
      const code = characters[chosen.index]?.codePointAt(0) ?? 0;
      characters[chosen.index] = String.fromCodePoint(code - ((code - 0xac00) % 28));
      return characters.join("");
    }
    const swappable = characters
      .map((character, index) => ({ character, index }))
      .filter(({ character, index }) => index < characters.length - 1 && character !== " " && characters[index + 1] !== " ");
    if (swappable.length === 0) return text;
    const { index } = pick(swappable);
    [characters[index], characters[index + 1]] = [characters[index + 1] as string, characters[index] as string];
    return characters.join("");
  }

  private expireDisconnectedPlayer(room: Room, player: HumanPlayer, disconnectedAt: number): void {
    if (player.connected || player.disconnectedAt !== disconnectedAt) return;
    player.disconnectTimer = undefined;
    const participant = this.participantForHuman(room, player.id);
    if (activeGamePhase(room) && participant?.alive) {
      const eliminated = this.eliminate(room, participant);
      const payload: RevealPayload = { items: [], eliminated, automatic: true };
      // 60초 유예가 끝난 기존 playerId는 더 이상 참가자로 복구할 수 없다.
      // 공개 정보와 최종 실명은 Participant에 보존되므로 Human 레코드는 제거한다.
      room.humans.delete(player.id);
      if (room.hostId === player.id) this.assignHost(room);
      if (room.humans.size === 0) {
        this.destroyRoom(room);
        return;
      }
      // 먼저 authoritative phase/alive 상태를 동기화한 뒤 자동 추방 카드를
      // 덧씌운다. 반대 순서면 클라이언트가 곧바로 기존 phase로 돌아가
      // 정체 공개를 전혀 보지 못한다.
      this.emitRoomState(room);
      this.io.to(room.code).emit("vote:reveal", payload);
      if (!room.settings.spectatorMode && room.participants.every((entry) => entry.isAI || !entry.alive)) {
        this.resolveSpectatorBets(room);
        setTimeout(() => {
          if (room.phase !== "END" && room.participants.every((entry) => entry.isAI || !entry.alive)) {
            this.endGame(room, "AI");
          }
        }, scaledMs(1_000));
      }
      return;
    }

    room.humans.delete(player.id);
    if (room.hostId === player.id) this.assignHost(room);
    if (room.humans.size === 0) {
      this.destroyRoom(room);
      return;
    }
    this.emitRoomState(room);
  }

  private eliminate(room: Room, participant: Participant): EliminatedInfo {
    participant.alive = false;
    participant.speaking = false;
    if (participant.humanId) {
      const human = room.humans.get(participant.humanId);
      if (human) {
        human.alive = false;
        human.isSpectator = true;
      }
    }
    const eliminated: EliminatedInfo = {
      anonName: participant.anonName,
      wasAI: participant.isAI,
      revealName: participant.isAI
        ? personaSummary(participant.persona)
        : participant.realNickname ?? room.humans.get(participant.humanId ?? "")?.nickname ?? "연결이 끊긴 인간"
    };
    room.eliminationHistory.push(eliminated);
    return eliminated;
  }

  private publishChat(room: Room, from: string, text: string): void {
    const message = { from, text, ts: Date.now() };
    room.chats.push(message);
    if (room.chats.length > MAX_CHAT_HISTORY) {
      room.chats.splice(0, room.chats.length - MAX_CHAT_HISTORY);
    }
    room.lastChatAt = message.ts;
    room.lastActivityAt = message.ts;
    this.io.to(room.code).emit("chat:new", message);
  }

  private emitGameStart(room: Room, human: HumanPlayer): void {
    if (!human.socketId) return;
    this.io.to(human.socketId).emit("game:start", {
      yourAnonName: human.anonName ?? "",
      isSpectator: human.isSpectator,
      participants: room.participantOrder,
      playerId: human.id,
      rounds: room.settings.rounds,
      difficulty: room.settings.difficulty,
      round: room.currentRound || 1
    });
  }

  private sendGameSnapshot(room: Room, human: HumanPlayer): void {
    this.emitGameStart(room, human);
    if (!human.socketId) return;
    this.io.to(human.socketId).emit("room:state", this.roomState(room, human.id));
    this.io.to(human.socketId).emit("phase:change", this.phasePayload(room));
    if (room.interrogation) {
      this.io.to(human.socketId).emit("interrogation:start", this.interrogationPayload(room));
    }
    for (const chat of room.chats) this.io.to(human.socketId).emit("chat:new", chat);
    if (room.phase === "REVEAL" && room.lastReveal) {
      this.io.to(human.socketId).emit("vote:reveal", room.lastReveal);
    }
    if (room.phase === "END") this.io.to(human.socketId).emit("game:over", this.gameOverPayload(room));
  }

  private emitRoomState(room: Room): void {
    for (const human of room.humans.values()) {
      if (human.connected && human.socketId) {
        this.io.to(human.socketId).emit("room:state", this.roomState(room, human.id));
      }
    }
  }

  private roomState(room: Room, viewerId: string): Record<string, unknown> {
    const revealNicknames = room.phase === "LOBBY" || room.phase === "END";
    const viewer = room.humans.get(viewerId);
    const viewerParticipant = this.participantForHuman(room, viewerId);
    return {
      code: room.code,
      players: [...room.humans.values()].map((human) => ({
        // human.id is the bearer token for room:rejoin. Only its owner may see it.
        id: human.id === viewerId ? human.id : human.publicId,
        nickname: revealNicknames ? human.nickname : human.id === viewerId ? "나" : "익명 참가자",
        connected: human.connected,
        isHost: room.hostId === human.id,
        isSpectator: human.isSpectator,
        anonName: revealNicknames || human.id === viewerId ? human.anonName : undefined,
        alive: revealNicknames || human.id === viewerId ? human.alive : undefined,
        isYou: human.id === viewerId
      })),
      settings: room.settings,
      hostId: room.hostId === viewerId
        ? room.hostId
        : room.humans.get(room.hostId)?.publicId ?? "",
      phase: room.phase,
      lifecycle: room.phase === "LOBBY" ? "LOBBY" : room.phase === "END" ? "END" : "PLAYING",
      round: room.currentRound,
      endsAt: room.phaseEndsAt,
      questionCard: room.questionCard,
      participants: room.participantOrder,
      eliminatedNames: room.participants.filter((participant) => !participant.alive).map((participant) => participant.anonName),
      eliminationHistory: room.eliminationHistory,
      yourAnonName: viewer?.anonName ?? "",
      isSpectator: viewer?.isSpectator ?? true,
      messages: room.chats,
      reveal: room.lastReveal,
      result: room.phase === "END" ? this.gameOverPayload(room) : undefined,
      hasVoted: viewerParticipant ? room.votes.has(viewerParticipant.anonName) : false,
      defenseTarget: room.phase === "DEFENSE" ? room.defenseTarget : undefined,
      defenseMessageSent: room.phase === "DEFENSE" ? room.defenseMessageSent : false,
      interrogationUsed: room.interrogationUsed,
      interrogation: this.interrogationPayload(room),
      spectatorBet: viewer?.spectatorBets.has(room.currentRound)
        ? {
            round: room.currentRound,
            targetAnonName: viewer.spectatorBets.get(room.currentRound)
          }
        : undefined
    };
  }

  private phasePayload(room: Room): Record<string, unknown> {
    return {
      phase: room.phase,
      endsAt: room.phaseEndsAt ?? Date.now(),
      round: room.currentRound,
      ...(room.phase === "CHAT" && room.questionCard ? { questionCard: room.questionCard } : {}),
      ...(room.phase === "DEFENSE" && room.defenseTarget ? { defenseTarget: room.defenseTarget } : {})
    };
  }

  private emitPhase(room: Room): void {
    this.io.to(room.code).emit("phase:change", this.phasePayload(room));
  }

  private gameOverPayload(room: Room): Record<string, unknown> {
    return {
      winner: room.winner ?? "NONE",
      reveal: room.participantOrder.map((anonName) => {
        const participant = room.participants.find((entry) => entry.anonName === anonName);
        if (!participant) return { anonName, isAI: true, personaSummary: "알 수 없음" };
        if (participant.isAI) {
          return { anonName, isAI: true, personaSummary: personaSummary(participant.persona) };
        }
        return {
          anonName,
          isAI: false,
          realNickname: participant.realNickname ?? room.humans.get(participant.humanId ?? "")?.nickname ?? "퇴장한 참가자"
        };
      }),
      spectatorMode: room.settings.spectatorMode,
      message: room.settings.spectatorMode ? "전원 AI였습니다" : undefined,
      awards: this.calculateAwards(room),
      betLeaderboard: [...room.humans.values()]
        .map((human) => ({ nickname: human.nickname, score: human.spectatorScore, total: human.spectatorBets.size }))
        .filter((entry) => entry.total > 0)
        .sort((left, right) => right.score - left.score || left.total - right.total || left.nickname.localeCompare(right.nickname))
    };
  }

  private calculateAwards(room: Room): GameAward[] {
    const receivedVotes = new Map<string, number>();
    const detectiveHits = new Map<string, number>();
    for (const history of room.voteHistory) {
      for (const vote of history.items) {
        receivedVotes.set(vote.target, (receivedVotes.get(vote.target) ?? 0) + 1);
        const voter = room.participants.find((participant) => participant.anonName === vote.voter);
        const target = room.participants.find((participant) => participant.anonName === vote.target);
        if (voter && !voter.isAI && target?.isAI) {
          detectiveHits.set(voter.anonName, (detectiveHits.get(voter.anonName) ?? 0) + 1);
        }
      }
    }

    const order = (participant: Participant): number => {
      const index = room.participantOrder.indexOf(participant.anonName);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const awards: GameAward[] = [];
    const aiParticipants = room.participants.filter((participant) => participant.isAI);
    if (aiParticipants.length > 0) {
      const humanlike = [...aiParticipants].sort((left, right) =>
        (receivedVotes.get(left.anonName) ?? 0) - (receivedVotes.get(right.anonName) ?? 0) || order(left) - order(right)
      )[0] as Participant;
      const votes = receivedVotes.get(humanlike.anonName) ?? 0;
      awards.push({
        id: "humanlike_ai",
        title: "가장 인간 같았던 AI",
        recipient: humanlike.anonName,
        detail: `누적 ${votes}표만 받고 인간 행세에 성공`
      });
    }

    const humanParticipants = room.participants.filter((participant) => !participant.isAI);
    if (humanParticipants.length > 0) {
      const suspected = [...humanParticipants].sort((left, right) =>
        (receivedVotes.get(right.anonName) ?? 0) - (receivedVotes.get(left.anonName) ?? 0) || order(left) - order(right)
      )[0] as Participant;
      const votes = receivedVotes.get(suspected.anonName) ?? 0;
      awards.push({
        id: "most_suspected_human",
        title: "가장 의심받은 인간",
        recipient: suspected.anonName,
        detail: `인간인데 누적 ${votes}표를 받음`
      });

      const detective = [...humanParticipants].sort((left, right) =>
        (detectiveHits.get(right.anonName) ?? 0) - (detectiveHits.get(left.anonName) ?? 0) || order(left) - order(right)
      )[0] as Participant;
      const hits = detectiveHits.get(detective.anonName) ?? 0;
      if (hits > 0) {
        awards.push({
          id: "detective",
          title: "명탐정",
          recipient: detective.realNickname ?? detective.anonName,
          detail: `AI를 ${hits}번 정확히 지목`
        });
      }
    }
    return awards;
  }

  private nextQuestion(room: Room): string {
    if (room.usedQuestions.size >= QUESTION_CARDS.length) room.usedQuestions.clear();
    const available = QUESTION_CARDS.filter((question) => !room.usedQuestions.has(question));
    const chosen = pick(available);
    room.usedQuestions.add(chosen);
    return chosen;
  }

  private setPhaseDeadline(room: Room, duration: number): void {
    room.phaseEndsAt = Date.now() + scaledMs(duration);
  }

  private stopAiScheduler(room: Room): void {
    if (room.aiScheduler) clearInterval(room.aiScheduler);
    room.aiScheduler = undefined;
    room.scheduledAiStarts = [];
    for (const participant of room.participants) {
      if (participant.speaking) {
        participant.speechGeneration += 1;
        this.io.to(room.code).emit("chat:typing", { isTyping: false });
        participant.speaking = false;
      }
    }
  }

  private clearPhaseWork(room: Room): void {
    if (room.phaseTimer) clearTimeout(room.phaseTimer);
    room.phaseTimer = undefined;
    if (room.interrogationTimer) clearTimeout(room.interrogationTimer);
    room.interrogationTimer = undefined;
    room.interrogation = undefined;
    this.stopAiScheduler(room);
  }

  private createHuman(nickname: string, socket: GameSocket): HumanPlayer {
    return {
      id: randomUUID(),
      publicId: `public:${randomUUID()}`,
      nickname,
      socketId: socket.id,
      connected: true,
      joinedAt: Date.now(),
      isSpectator: false,
      alive: true,
      spectatorScore: 0,
      spectatorBets: new Map()
    };
  }

  private attachSocket(room: Room, player: HumanPlayer, socket: GameSocket): void {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    player.socketId = socket.id;
    player.connected = true;
    void socket.join(room.code);
  }

  private ensureSocketIsFree(socket: GameSocket): void {
    if (socket.data.roomCode || socket.data.playerId) throw new Error("이미 방에 참가한 연결입니다");
  }

  private contextFor(socket: GameSocket): { room: Room; player: HumanPlayer } {
    const room = socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
    const player = room && socket.data.playerId ? room.humans.get(socket.data.playerId) : undefined;
    if (!room || !player || !player.connected || player.socketId !== socket.id) {
      throw new Error("먼저 방에 참가해 주세요");
    }
    return { room, player };
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error("존재하지 않는 방입니다");
    return room;
  }

  private participantForHuman(room: Room, humanId: string): Participant | undefined {
    return room.participants.find((participant) => participant.humanId === humanId);
  }

  private assignHost(room: Room, preferredId?: string): void {
    const preferred = preferredId ? room.humans.get(preferredId) : undefined;
    const next = preferred?.connected
      ? preferred
      : [...room.humans.values()].filter((human) => human.connected).sort((left, right) => left.joinedAt - right.joinedAt)[0];
    room.hostId = next?.id ?? "";
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < 4; index += 1) code += CODE_ALPHABET[randomBetween(0, CODE_ALPHABET.length - 1)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("방 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요");
  }

  private generateAnonNames(count: number): string[] {
    const combinations = ADJECTIVES.flatMap((adjective) => ANIMALS.map((animal) => `${adjective}${animal}`));
    if (count > combinations.length) throw new Error("참가자가 너무 많습니다");
    return shuffle(combinations).slice(0, count);
  }

  private touchRoom(room: Room): void {
    room.lastActivityAt = Date.now();
  }

  private sweepRooms(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const absoluteExpired = now - room.createdAt >= ROOM_ABSOLUTE_TTL;
      const idleExpired =
        (room.phase === "LOBBY" || room.phase === "END") &&
        now - room.lastActivityAt >= ROOM_IDLE_TTL;
      if (!absoluteExpired && !idleExpired) continue;

      const reason = absoluteExpired
        ? "방의 최대 이용 시간이 지나 종료되었습니다"
        : "오랫동안 활동이 없어 방이 종료되었습니다";
      this.io.to(room.code).emit("error", {
        message: reason
      });
      this.destroyRoom(room, reason);
    }
  }

  private destroyRoom(room: Room, reason = "방이 종료되었습니다"): void {
    this.clearPhaseWork(room);
    for (const human of room.humans.values()) {
      if (human.disconnectTimer) clearTimeout(human.disconnectTimer);
      if (!human.socketId) continue;
      const socket = this.io.sockets.sockets.get(human.socketId);
      if (!socket) continue;
      socket.emit("room:closed", { code: room.code, reason });
      if (socket.data.roomCode === room.code && socket.data.playerId === human.id) {
        socket.data.roomCode = undefined;
        socket.data.playerId = undefined;
      }
      void socket.leave(room.code);
    }
    this.rooms.delete(room.code);
  }
}
