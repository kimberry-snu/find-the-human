import { useEffect, useRef, useState, type FormEvent, type UIEvent } from 'react';
import { avatarFor, avatarToneFor, formatClock, phaseLabel } from '../lib/game-utils';
import type { ChatMessage, EliminatedPlayer, GamePhase } from '../types';
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
  onSend: (text: string) => void;
  onVote: (target: string) => void;
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
  onSend,
  onVote,
}: GameScreenProps) {
  const [draft, setDraft] = useState('');
  const remainingMs = useCountdown(endsAt);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const chatUnlocked = phase === 'CHAT' && !isSpectator && connected;

  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    const element = scrollAreaRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [messages.length, typingNames.length]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    shouldStickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 100;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!chatUnlocked || !draft.trim()) return;
    onSend(draft);
    setDraft('');
    shouldStickToBottomRef.current = true;
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
                      }`}
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

        {typingNames.map((name) => (
          <div key={name} className="mt-4 flex animate-message-in items-end gap-2">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm ring-1 ${avatarToneFor(name)}`}
              aria-hidden="true"
            >
              {avatarFor(name)}
            </span>
            <div>
              <p className="mb-1 px-1 text-[9px] font-bold text-white/35">{name}</p>
              <div className="flex h-9 items-center gap-1 rounded-[16px_16px_16px_5px] border border-white/[0.07] bg-white/[0.055] px-3.5" aria-label={`${name} 입력 중`}>
                <i className="typing-dot" />
                <i className="typing-dot [animation-delay:150ms]" />
                <i className="typing-dot [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer className="shrink-0 border-t border-white/[0.07] bg-ink-950/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {isSpectator ? (
          <div className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-violet-300/15 bg-violet-300/[0.06] text-xs font-black text-violet-200/65">
            <EyeIcon className="h-4 w-4" />
            관전 중 · 채팅과 투표는 읽기 전용이에요
          </div>
        ) : phase !== 'CHAT' ? (
          <div className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-signal/10 bg-signal/[0.04] text-xs font-black text-white/40">
            <span aria-hidden="true">🔒</span>
            {phase === 'VOTE' ? '투표가 진행 중이에요' : '채팅이 잠시 잠겼어요'}
          </div>
        ) : (
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.05] px-3.5 py-2 transition focus-within:border-electric/35 focus-within:ring-4 focus-within:ring-electric/[0.05]">
              <label htmlFor="chat-composer" className="sr-only">
                익명 메시지
              </label>
              <textarea
                id="chat-composer"
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 140))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={1}
                maxLength={140}
                enterKeyHint="send"
                placeholder={connected ? '들키지 않게 한마디…' : '재연결 중…'}
                disabled={!chatUnlocked}
                className="max-h-20 min-h-5 w-full resize-none bg-transparent text-[13px] font-semibold leading-5 text-white outline-none placeholder:text-white/20 disabled:cursor-not-allowed"
              />
              <div className="mt-0.5 flex justify-end text-[9px] font-bold text-white/20">
                {draft.length}/140
              </div>
            </div>
            <button
              type="submit"
              disabled={!chatUnlocked || !draft.trim()}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-electric text-ink-950 transition hover:bg-electric-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-25"
              aria-label="메시지 보내기"
            >
              <SendIcon className="h-5 w-5" />
            </button>
          </form>
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
    </main>
  );
}
