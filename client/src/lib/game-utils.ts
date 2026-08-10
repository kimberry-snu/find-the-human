import type { GamePhase } from '../types';

const AVATAR_EMOJIS = [
  '🐼',
  '🦊',
  '🐸',
  '🐯',
  '🐰',
  '🐧',
  '🦦',
  '🐙',
  '🦝',
  '🐨',
  '🦆',
  '🐢',
] as const;

const AVATAR_TONES = [
  'bg-cyan-300/15 text-cyan-200 ring-cyan-200/20',
  'bg-violet-300/15 text-violet-200 ring-violet-200/20',
  'bg-amber-300/15 text-amber-200 ring-amber-200/20',
  'bg-rose-300/15 text-rose-200 ring-rose-200/20',
  'bg-lime-300/15 text-lime-200 ring-lime-200/20',
  'bg-blue-300/15 text-blue-200 ring-blue-200/20',
] as const;

export function hashName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function avatarFor(name: string): string {
  return AVATAR_EMOJIS[hashName(name) % AVATAR_EMOJIS.length];
}

export function avatarToneFor(name: string): string {
  return AVATAR_TONES[hashName(name) % AVATAR_TONES.length];
}

export function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}`;
}

export function phaseLabel(phase: GamePhase): string {
  switch (phase) {
    case 'CHAT':
      return '익명 대화';
    case 'VOTE':
      return '인간 지목';
    case 'REVEAL':
      return '정체 공개';
    case 'END':
      return '게임 종료';
    default:
      return '대기 중';
  }
}

export function sanitizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export function normalizeWinner(winner: string): 'AI' | 'HUMAN' | 'SPECTATOR' {
  const normalized = winner.trim().toUpperCase();
  if (normalized.includes('AI')) return 'AI';
  if (
    normalized.includes('SPECT') ||
    normalized.includes('NONE') ||
    normalized.includes('DRAW')
  ) {
    return 'SPECTATOR';
  }
  return 'HUMAN';
}
