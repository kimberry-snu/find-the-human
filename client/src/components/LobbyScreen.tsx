import { useEffect, useMemo, useState } from 'react';
import { avatarFor, avatarToneFor } from '../lib/game-utils';
import type { AiCount, Notice, RoomPlayer, RoomSettings, StartSettings } from '../types';
import { BrandMark } from './BrandMark';
import { ArrowIcon, CopyIcon, CrownIcon, EyeIcon, UsersIcon } from './icons';

interface LobbyScreenProps {
  roomCode: string;
  playerId: string | null;
  players: RoomPlayer[];
  settings: RoomSettings;
  hostId: string | null;
  busy: boolean;
  connected: boolean;
  onStart: (settings: StartSettings) => void;
  onNotify: (message: string, tone?: Notice['tone']) => void;
}

const AI_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const ROUND_COUNTS = [1, 2, 3, 4, 5] as const;

function buildInviteUrl(roomCode: string): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  return url.toString();
}

export function LobbyScreen({
  roomCode,
  playerId,
  players,
  settings,
  hostId,
  busy,
  connected,
  onStart,
  onNotify,
}: LobbyScreenProps) {
  const [aiCount, setAiCount] = useState<AiCount>(settings.aiCount);
  const [rounds, setRounds] = useState(settings.rounds);
  const [spectatorMode, setSpectatorMode] = useState(settings.spectatorMode);
  const [difficulty, setDifficulty] = useState<RoomSettings['difficulty']>(
    settings.difficulty ?? 'mild',
  );
  const [touched, setTouched] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const inviteUrl = useMemo(() => buildInviteUrl(roomCode), [roomCode]);

  useEffect(() => {
    if (touched) return;
    setAiCount(settings.aiCount);
    setRounds(settings.rounds);
    setSpectatorMode(settings.spectatorMode);
    setDifficulty(settings.difficulty ?? 'mild');
  }, [settings.aiCount, settings.difficulty, settings.rounds, settings.spectatorMode, touched]);

  useEffect(() => {
    if (!showQr || qrDataUrl || qrFailed) return;
    let cancelled = false;

    void import('qrcode')
      .then(({ toDataURL }) =>
        toDataURL(inviteUrl, {
          width: 256,
          margin: 2,
          color: { dark: '#07080b', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [inviteUrl, qrDataUrl, qrFailed, showQr]);

  useEffect(() => {
    if (!showQr) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowQr(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showQr]);

  const isHost = hostId === playerId || players.some((player) => player.id === playerId && player.isHost);
  const connectedPlayers = players.filter((player) => player.connected);
  const minimumPlayers = 1;
  const canStart = isHost && connectedPlayers.length >= minimumPlayers && connected;

  const markTouched = () => setTouched(true);
  const chooseAiCount = (value: AiCount) => {
    markTouched();
    setAiCount(value);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      onNotify('초대코드를 복사했어요', 'success');
    } catch {
      onNotify(`초대코드: ${roomCode}`, 'info');
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      onNotify('초대 링크를 복사했어요', 'success');
    } catch {
      onNotify('링크를 복사하지 못했어요', 'error');
    }
  };

  const shareInvite = async () => {
    if (!navigator.share) {
      await copyInviteLink();
      return;
    }
    try {
      await navigator.share({
        title: '인간을 찾아라',
        text: `초대코드 ${roomCode} · AI 사이에 숨은 인간을 찾아보세요!`,
        url: inviteUrl,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      onNotify('공유하지 못했어요', 'error');
    }
  };

  return (
    <main className="min-h-dvh px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <BrandMark compact />
        <div className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[10px] font-bold text-white/40">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-300' : 'bg-amber-300'}`} />
          {connected ? '대기실 연결됨' : '재연결 중'}
        </div>
      </header>

      <section className="mt-7 overflow-hidden rounded-[28px] border border-white/[0.08] bg-gradient-to-br from-white/[0.07] to-white/[0.025] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-electric/70">
              Invite code
            </p>
            <p className="mt-1.5 font-mono text-[38px] font-black leading-none tracking-[0.16em] text-white">
              {roomCode}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
            aria-label="초대코드 복사"
          >
            <CopyIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-xs font-medium text-white/35">
          친구를 초대하거나, 혼자서 바로 AI와 게임을 시작하세요.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void copyInviteLink()}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.05] text-[10px] font-black text-white/65 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
          >
            링크 복사
          </button>
          <button
            type="button"
            onClick={() => void shareInvite()}
            className="h-10 rounded-xl border border-white/10 bg-white/[0.05] text-[10px] font-black text-white/65 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
          >
            공유하기
          </button>
          <button
            type="button"
            onClick={() => setShowQr(true)}
            className="h-10 rounded-xl border border-electric/15 bg-electric/[0.06] text-[10px] font-black text-electric-soft/80 transition hover:bg-electric/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
            aria-haspopup="dialog"
          >
            QR 띄우기
          </button>
        </div>
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/30">
              Players
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-white">참가자</h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-white/45">
            <UsersIcon className="h-4 w-4" />
            {connectedPlayers.length}명
          </div>
        </div>

        <div className="space-y-2" aria-live="polite">
          {players.length ? (
            players.map((player, index) => (
              <div
                key={player.id}
                className={`flex animate-list-in items-center gap-3 rounded-2xl border px-3.5 py-3 ${
                  player.id === playerId
                    ? 'border-electric/20 bg-electric/[0.055]'
                    : 'border-white/[0.06] bg-white/[0.025]'
                }`}
                style={{ animationDelay: `${index * 45}ms` }}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ring-1 ${avatarToneFor(
                    player.nickname,
                  )}`}
                  aria-hidden="true"
                >
                  {avatarFor(player.nickname)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-extrabold text-white">{player.nickname}</p>
                    {player.id === playerId ? (
                      <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-black text-white/45">
                        나
                      </span>
                    ) : null}
                  </div>
                  <p className={`mt-0.5 text-[10px] font-semibold ${player.connected ? 'text-emerald-300/60' : 'text-white/25'}`}>
                    {player.connected ? '접속 중' : '재접속 대기 중'}
                  </p>
                </div>
                {player.isHost || player.id === hostId ? (
                  <span className="flex items-center gap-1 rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2 py-1 text-[9px] font-black text-amber-200/80">
                    <CrownIcon className="h-3 w-3" /> 방장
                  </span>
                ) : null}
              </div>
            ))
          ) : (
            <div className="grid h-20 place-items-center rounded-2xl border border-dashed border-white/10 text-xs text-white/30">
              참가자 정보를 불러오는 중…
            </div>
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-white/[0.07] pt-7">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/30">
              Game setup
            </p>
            <h2 className="mt-1 text-lg font-black tracking-tight text-white">게임 설정</h2>
          </div>
          {isHost ? (
            <span className="rounded-full bg-electric/[0.08] px-2.5 py-1 text-[10px] font-bold text-electric/70">
              방장 전용
            </span>
          ) : null}
        </div>

        <fieldset disabled={!isHost} className="space-y-5 disabled:opacity-55">
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-extrabold text-white/70">AI 참가자 수</p>
              <span className="text-[10px] font-semibold text-white/30">
                {aiCount === 'random' ? '게임 시작까지 비공개' : `${aiCount}명`}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              <button
                type="button"
                onClick={() => chooseAiCount('random')}
                className={`col-span-2 h-10 rounded-xl border text-[11px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric ${
                  aiCount === 'random'
                    ? 'border-electric/35 bg-electric/15 text-electric-soft'
                    : 'border-white/[0.07] bg-white/[0.035] text-white/35'
                }`}
                aria-pressed={aiCount === 'random'}
              >
                ✦ 랜덤
              </button>
              {AI_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => chooseAiCount(count)}
                  className={`h-10 rounded-xl border text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric ${
                    aiCount === count
                      ? 'border-electric/35 bg-electric/15 text-electric-soft'
                      : 'border-white/[0.07] bg-white/[0.035] text-white/35'
                  }`}
                  aria-pressed={aiCount === count}
                  aria-label={`AI ${count}명`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-extrabold text-white/70">AI 추리 난이도</p>
              <span className="text-[10px] font-semibold text-white/30">순한맛 추천</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  markTouched();
                  setDifficulty('mild');
                }}
                aria-pressed={difficulty === 'mild'}
                className={`min-h-[74px] rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric ${
                  difficulty === 'mild'
                    ? 'border-electric/35 bg-electric/[0.09] text-white'
                    : 'border-white/[0.07] bg-white/[0.035] text-white/45'
                }`}
              >
                <span className="block text-xs font-black">🌿 순한맛 <span className="text-[9px] text-electric/70">추천</span></span>
                <span className="mt-1 block text-[9px] font-semibold leading-4 text-white/35">
                  AI가 실수해서 더 유쾌해요
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  markTouched();
                  setDifficulty('spicy');
                }}
                aria-pressed={difficulty === 'spicy'}
                className={`min-h-[74px] rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                  difficulty === 'spicy'
                    ? 'border-signal/35 bg-signal/[0.09] text-white'
                    : 'border-white/[0.07] bg-white/[0.035] text-white/45'
                }`}
              >
                <span className="block text-xs font-black">🌶️ 매운맛</span>
                <span className="mt-1 block text-[9px] font-semibold leading-4 text-white/35">
                  AI가 대화를 날카롭게 추리해요
                </span>
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-xs font-extrabold text-white/70">라운드 수</p>
              <span className="text-[10px] font-semibold text-white/30">기본 3라운드</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {ROUND_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => {
                    markTouched();
                    setRounds(count);
                  }}
                  className={`h-10 rounded-xl border text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric ${
                    rounds === count
                      ? 'border-white/30 bg-white text-black'
                      : 'border-white/[0.07] bg-white/[0.035] text-white/35'
                  }`}
                  aria-pressed={rounds === count}
                  aria-label={`${count}라운드`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-violet-300/10 bg-violet-300/[0.045] p-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-300/10 text-violet-200">
              <EyeIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-extrabold text-white/75">AI 관전 모드</p>
              <p className="mt-1 text-[10px] font-medium leading-4 text-white/30">
                모두 관전하고 AI 6~8명이 서로를 의심해요
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={spectatorMode}
              onClick={() => {
                markTouched();
                setSpectatorMode((current) => !current);
              }}
              className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${
                spectatorMode ? 'bg-violet-400' : 'bg-white/10'
              }`}
              aria-label="AI 관전 모드"
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                  spectatorMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </fieldset>

        {isHost ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => onStart({ aiCount, rounds, spectatorMode, difficulty })}
              disabled={!canStart || busy}
              className="flex h-[54px] w-full items-center justify-between rounded-2xl bg-signal px-5 text-sm font-black text-white shadow-signal transition hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
            >
              <span>{busy ? '게임 준비 중…' : spectatorMode ? 'AI 관전 시작' : '게임 시작하기'}</span>
              <ArrowIcon className="h-5 w-5" />
            </button>
            {!canStart ? (
              <p className="mt-2.5 text-center text-[10px] font-semibold text-amber-200/55">
                {connected
                  ? `시작하려면 접속한 인간이 ${minimumPlayers}명 이상 필요해요`
                  : '서버에 다시 연결하고 있어요'}
              </p>
            ) : (
              <p className="mt-2.5 text-center text-[10px] font-semibold text-white/25">
                {spectatorMode
                  ? '시작하면 AI들의 대화를 관전할 수 있어요'
                  : connectedPlayers.length === 1
                    ? '혼자서도 AI와 바로 시작할 수 있어요'
                    : '시작하면 모두에게 새로운 익명 이름이 배정돼요'}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-4 text-xs font-bold text-white/35">
            <span className="inline-flex gap-0.5" aria-hidden="true">
              <i className="typing-dot" />
              <i className="typing-dot [animation-delay:150ms]" />
              <i className="typing-dot [animation-delay:300ms]" />
            </span>
            방장이 게임을 준비하고 있어요
          </div>
        )}
      </section>

      {showQr ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowQr(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-title"
            aria-describedby="qr-description"
            className="w-full max-w-sm animate-sheet-in rounded-[28px] border border-white/10 bg-ink-900 p-5 text-center shadow-2xl"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-electric/65">Scan to join</p>
            <h2 id="qr-title" className="mt-2 text-xl font-black text-white">카메라로 바로 참가</h2>
            <p id="qr-description" className="mt-2 text-xs font-medium leading-5 text-white/35">
              QR을 찍으면 초대코드가 자동으로 채워져요.
            </p>
            <div className="mx-auto mt-5 grid aspect-square w-64 max-w-full place-items-center overflow-hidden rounded-3xl bg-white p-3">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`${roomCode} 방 참가 QR 코드`} className="h-full w-full" />
              ) : qrFailed ? (
                <p className="px-5 text-xs font-bold leading-5 text-black/60">QR을 만들지 못했어요.<br />링크 복사를 이용해 주세요.</p>
              ) : (
                <div className="text-xs font-black text-black/45" role="status">QR 만드는 중…</div>
              )}
            </div>
            <p className="mt-4 font-mono text-2xl font-black tracking-[0.2em] text-white">{roomCode}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void copyInviteLink()}
                className="h-11 rounded-xl bg-white text-xs font-black text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
              >
                링크 복사
              </button>
              <button
                type="button"
                onClick={() => setShowQr(false)}
                autoFocus
                className="h-11 rounded-xl border border-white/10 bg-white/[0.06] text-xs font-black text-white/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
              >
                닫기
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
