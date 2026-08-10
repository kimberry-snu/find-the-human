import type { Server as HttpServer } from "node:http";
import type { Server, Socket } from "socket.io";

export type Phase = "LOBBY" | "CHAT" | "VOTE" | "REVEAL" | "END";
export type Winner = "HUMAN" | "AI" | "NONE";
export type AiSetting = number | "random";

export interface Persona {
  age: number;
  job: string;
  tone: string;
  interests: string;
  quirk: string;
}

export interface HumanPlayer {
  id: string;
  nickname: string;
  socketId?: string;
  connected: boolean;
  joinedAt: number;
  disconnectedAt?: number;
  disconnectTimer?: NodeJS.Timeout;
  isSpectator: boolean;
  anonName?: string;
  alive: boolean;
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
}

export interface Room {
  code: string;
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
  phaseEndsAt?: number;
  phaseTimer?: NodeJS.Timeout;
  aiScheduler?: NodeJS.Timeout;
  scheduledAiStarts: number[];
  chats: ChatMessage[];
  votes: Map<string, VoteRecord>;
  aiVoteTasks: Promise<void>[];
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
