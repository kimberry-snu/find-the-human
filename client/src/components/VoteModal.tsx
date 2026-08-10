import { useEffect, useMemo, useRef, useState } from 'react';
import { avatarFor, avatarToneFor, formatClock } from '../lib/game-utils';
import { CheckIcon } from './icons';

interface VoteModalProps {
  participants: string[];
  yourAnonName: string | null;
  eliminatedNames: Set<string>;
  remainingMs: number;
  hasVoted: boolean;
  round: number;
  onVote: (target: string) => void;
}

export function VoteModal({
  participants,
  yourAnonName,
  eliminatedNames,
  remainingMs,
  hasVoted,
  round,
  onVote,
}: VoteModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const firstCandidateRef = useRef<HTMLButtonElement>(null);
  const candidates = useMemo(
    () =>
      participants.filter(
        (participant) => participant !== yourAnonName && !eliminatedNames.has(participant),
      ),
    [eliminatedNames, participants, yourAnonName],
  );

  useEffect(() => {
    setSelected(null);
    const focusTimer = window.setTimeout(() => firstCandidateRef.current?.focus(), 80);
    return () => window.clearTimeout(focusTimer);
  }, [round]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="vote-title"
        aria-describedby="vote-description"
        className="max-h-[92dvh] w-full max-w-[480px] animate-sheet-in overflow-y-auto rounded-t-[30px] border border-white/10 bg-ink-900 px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 shadow-2xl sm:rounded-[30px] sm:p-6"
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15 sm:hidden" aria-hidden="true" />
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-signal-soft/70">
              Round {round} · Vote
            </p>
            <h2 id="vote-title" className="mt-1.5 text-[24px] font-black tracking-[-0.035em] text-white">
              누가 진짜 인간일까?
            </h2>
            <p id="vote-description" className="mt-2 text-xs font-medium leading-5 text-white/38">
              가장 인간처럼 느껴진 참가자 한 명을 지목하세요.
              <br />
              자기 자신에게는 투표할 수 없어요.
            </p>
          </div>
          <div
            className={`shrink-0 rounded-xl border px-2.5 py-2 font-mono text-sm font-black ${
              remainingMs <= 10_000
                ? 'animate-urgent border-signal/25 bg-signal/10 text-signal-soft'
                : 'border-white/10 bg-white/[0.04] text-white/65'
            }`}
            aria-label={`투표 남은 시간 ${formatClock(remainingMs)}`}
          >
            {formatClock(remainingMs)}
          </div>
        </header>

        {hasVoted ? (
          <div className="mt-8 grid min-h-56 place-items-center rounded-3xl border border-electric/15 bg-electric/[0.045] px-6 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-electric/15 text-electric">
                <CheckIcon className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-lg font-black text-white">지목을 마쳤어요</h3>
              <p className="mt-2 text-xs font-medium leading-5 text-white/35">
                다른 참가자들의 선택을 기다리는 중이에요.
                <br />
                과연 누가 추방될까요?
              </p>
              <span className="mt-5 inline-flex gap-1" aria-label="대기 중">
                <i className="typing-dot h-1.5 w-1.5" />
                <i className="typing-dot h-1.5 w-1.5 [animation-delay:150ms]" />
                <i className="typing-dot h-1.5 w-1.5 [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        ) : candidates.length ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              {candidates.map((candidate, index) => {
                const isSelected = selected === candidate;
                return (
                  <button
                    key={candidate}
                    ref={index === 0 ? firstCandidateRef : undefined}
                    type="button"
                    onClick={() => setSelected(candidate)}
                    aria-pressed={isSelected}
                    className={`relative flex min-h-[92px] items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric ${
                      isSelected
                        ? 'border-electric/45 bg-electric/[0.09] shadow-glow'
                        : 'border-white/[0.07] bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ring-1 ${avatarToneFor(
                        candidate,
                      )}`}
                      aria-hidden="true"
                    >
                      {avatarFor(candidate)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[9px] font-black uppercase tracking-wider text-white/25">
                        Suspect {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="mt-1 block break-keep text-xs font-extrabold leading-4 text-white/80">
                        {candidate}
                      </span>
                    </span>
                    {isSelected ? (
                      <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-electric text-ink-950">
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => selected && onVote(selected)}
              disabled={!selected}
              className="mt-5 h-[52px] w-full rounded-2xl bg-white text-sm font-black text-black transition hover:bg-electric-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {selected ? `${selected} 지목하기` : '한 명을 선택하세요'}
            </button>
            <p className="mt-3 text-center text-[10px] font-medium text-white/25">
              제출한 선택은 바꿀 수 없어요 · 미선택 시 기권
            </p>
          </>
        ) : (
          <div className="mt-7 grid min-h-48 place-items-center rounded-3xl border border-dashed border-white/10 px-6 text-center">
            <div>
              <span className="text-3xl" aria-hidden="true">
                ◌
              </span>
              <p className="mt-3 text-sm font-black text-white/70">지목할 생존자가 없어요</p>
              <p className="mt-1 text-xs text-white/30">이번 투표는 자동으로 기권 처리됩니다.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
