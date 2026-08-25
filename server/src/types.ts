import type { Server as HttpServer } from "node:http";
import type { Server, Socket } from "socket.io";

export type Phase = "LOBBY" | "CHAT" | "VOTE" | "DEFENSE" | "REVEAL" | "END";
export type Winner = "HUMAN" | "AI" | "NONE";
export type AiSetting = number | "random";
export type Difficulty = "mild" | "spicy";

export interface Persona {
  age: number;
  job: string;
  tone: string;
  interests: string;
  quirk: string;
}

export interface HumanPlayer {
  id: string;
  publicId: string;
  nickname: string;
  socketId?: string;
  connected: boolean;
  joinedAt: number;
  disconnectedAt?: number;
  disconnectTimer?: NodeJS.Timeout;
  isSpectator: boolean;
  anonName?: string;
  alive: boolean;
  spectatorScore: number;
  spectatorBets: Map<number, string>;
}

export interface Participant {
  id: string;
  anonName: string;
  isAI: boolean;
  alive: boolean;
  humanId?: string;
  realNickname?: string;
  persona?: Persona;
  answeredQuestion: boolean;
  roundMessageCount: number;
  lastSpokeAt: number;
  speaking: boolean;
  speechGeneration: number;
}

export interface ChatMessage {
  from: string;
  text: string;
  ts: number;
}

export interface VoteRecord {
  voter: string;
  target: string;
  reason: string;
}

export interface RoomSettings {
  aiCount: AiSetting;
  rounds: number;
  spectatorMode: boolean;
  difficulty: Difficulty;
}

export interface InterrogationState {
  by: string;
  target: string;
  question: string;
  endsAt: number;
  answered: boolean;
}

export interface VoteHistoryEntry {
  round: number;
  items: VoteRecord[];
}

export interface GameAward {
  id: "humanlike_ai" | "most_suspected_human" | "detective";
  title: string;
  recipient: string;
  detail: string;
}

export interface Room {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  hostId: string;
  humans: Map<string, HumanPlayer>;
  phase: Phase;
  settings: RoomSettings;
  resolvedAiCount?: number;
  participants: Participant[];
  participantOrder: string[];
  currentRound: number;
  questionCard?: string;
  usedQuestions: Set<string>;
  interrogationUsed: boolean;
  interrogation?: InterrogationState;
  interrogationTimer?: NodeJS.Timeout;
  phaseEndsAt?: number;
  phaseTimer?: NodeJS.Timeout;
  aiScheduler?: NodeJS.Timeout;
  scheduledAiStarts: number[];
  chats: ChatMessage[];
  votes: Map<string, VoteRecord>;
  voteHistory: VoteHistoryEntry[];
  aiVoteTasks: Promise<void>[];
  defenseTarget?: string;
  defenseMessageSent: boolean;
  pendingVoteItems?: VoteRecord[];
  resolvedBetRounds: Set<number>;
  transitioning: boolean;
  lastChatAt: number;
  lastReveal?: RevealPayload;
  eliminationHistory: EliminatedInfo[];
  winner?: Winner;
}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
}

export interface EliminatedInfo {
  anonName: string;
  wasAI: boolean;
  revealName: string;
}

export interface RevealPayload {
  items: VoteRecord[];
  eliminated: EliminatedInfo | null;
  automatic?: boolean;
}

export type GameIo = Server<any, any, any, SocketData>;
export type GameSocket = Socket<any, any, any, SocketData>;
export type GameHttpServer = HttpServer;

export type Ack = (response: Record<string, unknown>) => void;
