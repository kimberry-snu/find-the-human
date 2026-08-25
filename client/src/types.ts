export type GamePhase = 'LOBBY' | 'CHAT' | 'VOTE' | 'DEFENSE' | 'REVEAL' | 'END';

export type AiCount = number | 'random';

export type Difficulty = 'mild' | 'spicy';

export interface RoomPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  isHost: boolean;
  isSpectator: boolean;
  anonName?: string;
  alive?: boolean;
}

export interface RoomSettings {
  aiCount: AiCount;
  rounds: number;
  spectatorMode: boolean;
  difficulty: Difficulty;
}

export interface ChatMessage {
  key: string;
  from: string;
  text: string;
  ts: number;
}

export interface VoteItem {
  voter: string;
  target: string;
  reason: string;
}

export interface EliminatedPlayer {
  anonName: string;
  wasAI: boolean;
  revealName: string;
}

export interface VoteReveal {
  items: VoteItem[];
  eliminated: EliminatedPlayer | null;
  automatic?: boolean;
}

export interface IdentityReveal {
  anonName: string;
  isAI: boolean;
  realNickname?: string;
  personaSummary?: string;
}

export interface Interrogation {
  target: string;
  question: string;
  endsAt: number;
}

export interface SpectatorBet {
  round: number;
  targetAnonName: string;
}

export interface GameAward {
  id: string;
  title: string;
  recipient: string;
  detail: string;
}

export interface BetLeaderboardEntry {
  nickname: string;
  score: number;
  total: number;
}

export interface GameResult {
  winner: string;
  reveal: IdentityReveal[];
  awards: GameAward[];
  betLeaderboard: BetLeaderboardEntry[];
}

export interface SessionIdentity {
  playerId: string;
  roomCode: string;
}

export interface StartSettings {
  aiCount: AiCount;
  rounds: number;
  spectatorMode: boolean;
  difficulty: Difficulty;
}

export interface GameViewState {
  connected: boolean;
  connecting: boolean;
  reconnecting: boolean;
  busy: boolean;
  roomCode: string | null;
  playerId: string | null;
  players: RoomPlayer[];
  settings: RoomSettings;
  hostId: string | null;
  gameStarted: boolean;
  yourAnonName: string | null;
  isSpectator: boolean;
  participants: string[];
  eliminatedNames: Set<string>;
  eliminationHistory: EliminatedPlayer[];
  phase: GamePhase;
  endsAt: number | null;
  round: number;
  totalRounds: number;
  questionCard: string | null;
  defenseTarget: string | null;
  defenseMessageSent: boolean;
  interrogation: Interrogation | null;
  interrogationUsed: boolean;
  spectatorBet: SpectatorBet | null;
  messages: ChatMessage[];
  typingNames: string[];
  reveal: VoteReveal | null;
  automaticReveals: VoteReveal[];
  result: GameResult | null;
  hasVoted: boolean;
  notice: Notice | null;
}

export interface Notice {
  id: number;
  message: string;
  tone: 'error' | 'info' | 'success';
}

export interface GameActions {
  createRoom: (nickname: string) => Promise<void>;
  joinRoom: (nickname: string, code: string) => Promise<void>;
  startGame: (settings: StartSettings) => void;
  sendChat: (text: string) => Promise<void>;
  castVote: (targetAnonName: string) => void;
  useInterrogation: (targetAnonName: string) => void;
  placeSpectatorBet: (targetAnonName: string) => void;
  playAgain: () => void;
  dismissNotice: () => void;
  notify: (message: string, tone?: Notice['tone']) => void;
}
