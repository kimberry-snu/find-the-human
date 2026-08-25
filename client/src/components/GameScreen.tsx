import { useEffect, useRef, useState, type FormEvent, type UIEvent } from 'react';
import { avatarFor, avatarToneFor, formatClock, phaseLabel } from '../lib/game-utils';
import type { ChatMessage, EliminatedPlayer, GamePhase, Interrogation, SpectatorBet } from '../types';
import { useCountdown } from '../hooks/useCountdown';
import { BrandMark } from './BrandMark';
import { EyeIcon, SendIcon } from './icons';
import { VoteModal } from './VoteModal';

interface GameScreenProps {
  phase: GamePhase;
  round: number;
  totalRounds: number;
  endsAt: number | null;
  questionCard: string | null;
  messages: ChatMessage[];
  typingNames: string[];
  yourAnonName: string | null;
  isSpectator: boolean;
  participants: string[];
  eliminatedNames: Set<string>;
  eliminationHistory: EliminatedPlayer[];
  hasVoted: boolean;
  connected: boolean;
  spectatorMode: boolean;
  interrogation: Interrogation | null;
  interrogationUsed: boolean;
  spectatorBet: SpectatorBet | null;
  onSend: (text: string) => Promise<void>;
  onVote: (target: string) => void;
  onUseInterrogation: (target: string) => void;
  onPlaceSpectatorBet: (target: string) => void;
}

export function GameScreen({
  phase,
  round,
  totalRounds,
  endsAt,
  questionCard,
  messages,
  typingNames,
  yourAnonName,
  isSpectator,
  participants,
  eliminatedNames,
  eliminationHistory,
  hasVoted,
  connected,
  spectatorMode,
  interrogation,
  interrogationUsed,
  spectatorBet,
  onSend,
  onVote,
  onUseInterrogation,
  onPlaceSpectatorBet,
}: GameScreenProps) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showInterrogationPicker, setShowInterrogationPicker] = useState(false);
  const remainingMs = useCountdown(endsAt);
  const interrogationRemainingMs = useCountdown(interrogation?.endsAt ?? null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const interrogationDialogRef = useRef<HTMLElement>(null);
  const interrogationTriggerRef = useRef<HTMLButtonElement>(null);
  const firstInterrogationTargetRef = useRef<HTMLButtonElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const chatUnlocked = phase === 'CHAT' && !isSpectator && connected;
  const interrogationTargets = participants.filter(
    (participant) => participant !== yourAnonName && !eliminatedNames.has(participant),
  );
  const canInterrogate =
    phase === 'CHAT' &&
    !isSpectator &&
    !interrogationUsed &&
    !interrogation &&
    connected &&
    Boolean(yourAnonName) &&
    interrogationTargets.length > 0;
  const isInterrogationTarget = interrogation?.target === yourAnonName;
  const betLocked = spectatorBet?.round === round;
  const betCandidates = participants.filter((participant) => !eliminatedNames.has(participant));

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const element = scrollAreaRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [messages.length, typingNames.length]);

  useEffect(() => {
    if (!showInterrogationPicker) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => firstInterrogationTargetRef.current?.focus(), 80);
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowInterrogationPicker(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = interrogationDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleDialogKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else interrogationTriggerRef.current?.focus();
    };
  }, [showInterrogationPicker]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    shouldStickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!chatUnlocked || !message || isSending) return;
    setIsSending(true);
    try {
      await onSend(message);
      setDraft((current) => (current.trim() === message ? '' : current));
      shouldStickToBottomRef.current = true;
    } catch {
      // The shared socket notice reports the error and the draft remains editable.
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="flex h-dvh min-h-[560px] flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 border-b border-white/[0.07] bg-ink-950/90 px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <BrandMark compact />
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-white/40">
              R{round}/{totalRounds}
            </span>
            <span
              className={`rounded-xl border px-2.5 py-1.5 font-mono text-sm font-black ${
                remainingMs <= 10_000 && endsAt !== null
                  ? 'animate-urgent border-signal/25 bg-signal/10 text-signal-soft'
                  : 'border-electric/15 bg-electric/[0.06] text-electric-soft'
              }`}
              aria-label={`${phaseLabel(phase)} 남은 시간 ${formatClock(remainingMs)}`}
            >
              {endsAt === null ? '--:--' : formatClock(remainingMs)}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-stretch gap-2">
          <div className="grid w-[76px] shrink-0 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.035] text-center">
            <div>
              <span className={`mx-auto mb-1 block h-1.5 w-1.5 rounded-full ${phase === 'CHAT' ? 'animate-pulse bg-emerald-300' : 'bg-signal'}`} />
              <span className="block text-[9px] font-black text-white/45">{phaseLabel(phase)}</span>
            </div>
          </div>
          <section className="min-w-0 flex-1 rounded-2xl border border-violet-300/10 bg-gradient-to-r from-violet-300/[0.07] to-transparent px-3.5 py-2.5">
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-200/45">
              Question card
            </p>
            <p className="mt-1 truncate text-[11px] font-extrabold text-white/75">
              {questionCard ?? '이번 라운드 질문을 고르는 중…'}
            </p>
          </section>
        </div>
        {eliminationHistory.length > 0 ? (
          <div
            className="chat-scroll mt-2 flex gap-1.5 overflow-x-auto pb-0.5"
            aria-label="지금까지 공개된 정체"
          >
            {eliminationHistory.map((item) => (
              <span
                key={item.anonName}
                className="shrink-0 rounded-full border border-white/[0.07] bg-white/[0.035] px-2 py-1 text-[9px] font-bold text-white/45"
                title={item.revealName}
              >
                {item.wasAI ? '🤖' : '🧑'} {item.anonName}
              </span>
            ))}
          </div>
        ) : null}
        {interrogation ? (
          <section
            className={`mt-2 animate-card-arrive rounded-2xl border px-3.5 py-3 ${
              isInterrogationTarget
                ? 'animate-interrogation border-signal/35 bg-signal/[0.11]'
                : 'border-amber-300/20 bg-amber-300/[0.065]'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-200/60">
                  ⚡ 시스템 긴급 심문 · {interrogation.target} 지목
                </p>
                <p className="mt-1.5 text-xs font-black leading-5 text-white/85">
                  “{interrogation.question}”
                </p>
                {isInterrogationTarget ? (
                  <p className="mt-1 text-[10px] font-bold text-signal-soft">당신이 지목됐어요. 지금 답하세요!</p>
                ) : null}
              </div>
              <span
                className="shrink-0 rounded-lg border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs font-black text-amber-100"
                aria-hidden="true"
              >
                {formatClock(interrogationRemainingMs)}
              </span>
            </div>
          </section>
        ) : null}
      </header>

      <div
        ref={scrollAreaRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="익명 채팅 메시지"
        className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5"
      >
        {messages.length ? (
          <div className="space-y-4">
            {messages.map((message) => {
              const isMine = message.from === yourAnonName;
              return (
                <article
                  key={message.key}
                  className={`flex animate-message-in items-end gap-2 ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  {isMine ? null : (
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm ring-1 ${avatarToneFor(
                        message.from,
                      )}`}
                      aria-hidden="true"
                    >
                      {avatarFor(message.from)}
                    </span>
                  )}
                  <div className={`max-w-[76%] ${isMine ? 'text-right' : 'text-left'}`}>
                    <p className={`mb-1 px-1 text-[9px] font-bold ${isMine ? 'text-electric/55' : 'text-white/35'}`}>
                      {isMine ? `${message.from} · 나` : message.from}
                    </p>
                    <div
                      className={`inline-block break-words px-3.5 py-2.5 text-left text-[13px] font-semibold leading-[1.48] ${
                        isMine
                          ? 'rounded-[18px_18px_5px_18px] bg-electric text-[#06201d]'
                          : 'rounded-[18px_18px_18px_5px] border border-white/[0.07] bg-white/[0.065] text-white/85'
                      } ${interrogation?.target === message.from ? 'ring-2 ring-amber-300/45' : ''}`}
                    >
                      {message.text}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid h-full min-h-40 place-items-center text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03] text-xl" aria-hidden="true">
                💬
              </span>
              <p className="mt-3 text-xs font-extrabold text-white/45">첫 마디를 기다리는 중</p>
              <p className="mt-1 text-[10px] font-medium text-white/25">너무 완벽하게 말하면 의심받을지도 몰라요</p>
            </div>
          </div>
        )}

        {typingNames.length > 0 ? (
          <div className="mt-4 animate-message-in" role="status" aria-label="누군가 입력 중">
            <p className="mb-1 px-1 text-[9px] font-bold text-white/35">누군가 입력 중</p>
            <div
              className="flex h-9 w-fit items-center gap-1 rounded-2xl border border-white/[0.07] bg-white/[0.055] px-3.5"
              aria-hidden="true"
            >
              <i className="typing-dot" />
              <i className="typing-dot [animation-delay:150ms]" />
              <i className="typing-dot [animation-delay:300ms]" />
            </div>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-white/[0.07] bg-ink-950/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {isSpectator ? (
          !spectatorMode && (phase === 'CHAT' || phase === 'VOTE') ? (
            <section className="rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] p-3" aria-label="관전자 인간 예측 베팅">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <EyeIcon className="h-4 w-4 text-violet-200/70" />
                  <div>
                    <p className="text-[10px] font-black text-violet-100/80">인간 예측 베팅</p>
                    <p className="mt-0.5 text-[9px] font-semibold text-white/25">라운드마다 한 번 · 맞히면 +1</p>
                  </div>
                </div>
                <span className="rounded-full bg-violet-300/10 px-2 py-1 text-[9px] font-black text-violet-200/55">
                  R{round}
                </span>
              </div>
              {betLocked ? (
                <p className="mt-2 rounded-xl border border-electric/10 bg-electric/[0.05] px-3 py-2 text-center text-[10px] font-bold text-electric/70">
                  🔒 {spectatorBet.targetAnonName}에게 베팅 완료
                </p>
              ) : (
                <div className="chat-scroll mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                  {betCandidates.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      onClick={() => onPlaceSpectatorBet(candidate)}
                      className="shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-[10px] font-black text-white/55 transition hover:border-violet-300/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    >
                      {avatarFor(candidate)} {candidate}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-xs font-black text-violet-200/65">
              <EyeIcon className="h-4 w-4" />
              관전 중 · 채팅과 투표는 읽기 전용이에요
            </div>
          )
        ) : phase !== 'CHAT' ? (
          <div className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-signal/10 bg-signal/[0.04] text-xs font-black text-white/40">
            <span aria-hidden="true">🔒</span>
            {phase === 'VOTE' ? '투표가 진행 중이에요' : '채팅이 잠시 잠겼어요'}
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p
                className={`truncate text-[9px] font-bold ${isInterrogationTarget ? 'text-signal-soft' : 'text-white/25'}`}
              >
                {isInterrogationTarget ? '⚡ 심문 답변을 지금 보내세요' : '140자 익명 채팅'}
              </p>
              <button
                ref={interrogationTriggerRef}
                type="button"
                onClick={() => setShowInterrogationPicker(true)}
                disabled={!canInterrogate}
                className={`shrink-0 rounded-lg border px-2.5 py-1 text-[9px] font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                  interrogationUsed
                    ? 'border-white/[0.06] bg-white/[0.025] text-white/20'
                    : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100/70 disabled:opacity-35'
                }`}
                aria-haspopup="dialog"
              >
                {interrogationUsed ? '🔒 심문권 사용함' : '⚡ 심문권 사용'}
              </button>
            </div>
            <form onSubmit={submit} className="flex items-end gap-2" aria-busy={isSending}>
              <div
                className={`min-w-0 flex-1 rounded-2xl border bg-white/[0.05] px-3.5 py-2 transition ${
                  isInterrogationTarget
                    ? 'border-signal/40 ring-4 ring-signal/[0.07] focus-within:border-signal'
                    : 'border-white/10 focus-within:border-electric/35 focus-within:ring-4 focus-within:ring-electric/[0.05]'
                }`}
              >
                <label htmlFor="chat-composer" className="sr-only">
                  익명 메시지
                </label>
                <textarea
                  id="chat-composer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, 140))}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  maxLength={140}
                  enterKeyHint="send"
                  placeholder={
                    connected
                      ? isInterrogationTarget
                        ? `“${interrogation?.question ?? ''}”에 답하세요…`
                        : '들키지 않게 한마디…'
                      : '재연결 중…'
                  }
                  disabled={!chatUnlocked}
                  className="max-h-20 min-h-5 w-full resize-none bg-transparent text-[13px] font-semibold leading-5 text-white outline-none placeholder:text-white/20 disabled:cursor-not-allowed"
                />
                <div className="mt-0.5 flex justify-end text-[9px] font-bold text-white/20">
                  {draft.length}/140
                </div>
              </div>
              <button
                type="submit"
                disabled={!chatUnlocked || !draft.trim() || isSending}
                className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-ink-950 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-25 ${
                  isInterrogationTarget
                    ? 'bg-signal text-white hover:bg-signal-soft focus-visible:ring-signal'
                    : 'bg-electric hover:bg-electric-soft focus-visible:ring-electric'
                }`}
                aria-label="메시지 보내기"
              >
                <SendIcon className="h-5 w-5" />
              </button>
            </form>
          </div>
        )}
      </footer>

      {phase === 'VOTE' && !isSpectator ? (
        <VoteModal
          participants={participants}
          yourAnonName={yourAnonName}
          eliminatedNames={eliminatedNames}
          remainingMs={remainingMs}
          hasVoted={hasVoted}
          round={round}
          onVote={onVote}
        />
      ) : null}

      {showInterrogationPicker ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowInterrogationPicker(false);
          }}
        >
          <section
            ref={interrogationDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="interrogation-title"
            aria-describedby="interrogation-description"
            className="max-h-[88dvh] w-full max-w-[480px] animate-sheet-in overflow-y-auto rounded-t-[30px] border border-amber-300/15 bg-ink-900 px-5 pb-[max(22px,env(safe-area-inset-bottom))] pt-4 shadow-2xl sm:rounded-[30px] sm:p-6"
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden="true" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/65">
              ⚡ Once per game
            </p>
            <h2
              id="interrogation-title"
              className="mt-1.5 text-2xl font-black tracking-tight text-white"
            >
              누구를 심문할까?
            </h2>
            <p
              id="interrogation-description"
              className="mt-2 text-xs font-medium leading-5 text-white/35"
            >
              한 명을 압박해 15초 안에 답하게 만드세요.
              <br />
              게임당 단 한 번, 취소할 수 없어요.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {interrogationTargets.map((target, index) => (
                <button
                  key={target}
                  ref={index === 0 ? firstInterrogationTargetRef : undefined}
                  type="button"
                  onClick={() => {
                    onUseInterrogation(target);
                    setShowInterrogationPicker(false);
                  }}
                  className="flex min-h-[78px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 text-left transition hover:border-amber-300/25 hover:bg-amber-300/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg ring-1 ${avatarToneFor(target)}`}
                    aria-hidden="true"
                  >
                    {avatarFor(target)}
                  </span>
                  <span className="min-w-0 break-keep text-xs font-black leading-4 text-white/70">
                    {target}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowInterrogationPicker(false)}
              className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] text-xs font-black text-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
            >
              아직 아껴두기
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
