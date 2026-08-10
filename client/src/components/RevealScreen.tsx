import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../lib/game-utils';
import type { VoteReveal } from '../types';
import { useCountdown } from '../hooks/useCountdown';
import { BrandMark } from './BrandMark';

interface RevealScreenProps {
  reveal: VoteReveal;
  round: number;
  totalRounds: number;
  endsAt: number | null;
  yourAnonName: string | null;
}

export function RevealScreen({
  reveal,
  round,
  totalRounds,
  endsAt,
  yourAnonName,
}: RevealScreenProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const voteListRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const remainingMs = useCountdown(endsAt);

  useEffect(() => {
    setVisibleCount(0);
    setShowCard(false);
    setFlipped(false);
    const timers: number[] = [];
    const itemCount = reveal.items.length;

    if (itemCount === 0) {
      timers.push(window.setTimeout(() => setShowCard(true), 700));
    } else {
      reveal.items.forEach((_item, index) => {
        timers.push(
          window.setTimeout(() => setVisibleCount(index + 1), 450 + index * 800),
        );
      });
      timers.push(window.setTimeout(() => setShowCard(true), 750 + itemCount * 800));
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reveal, round]);

  useEffect(() => {
    if (!showCard) return undefined;
    const timer = window.setTimeout(() => setFlipped(true), 650);
    const scrollTimer = window.setTimeout(
      () => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      80,
    );
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(scrollTimer);
    };
  }, [showCard]);

  useEffect(() => {
    const list = voteListRef.current;
    if (!list || visibleCount === 0) return;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [visibleCount]);

  const eliminated = reveal.eliminated;
  const selfEliminated = eliminated?.anonName === yourAnonName;

  return (
    <main className="relative min-h-dvh overflow-hidden px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute left-1/2 top-[42%] h-80 w-80 -translate-x-1/2 rounded-full bg-signal/[0.07] blur-3xl" />
      <header className="relative flex items-center justify-between">
        <BrandMark compact />
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1.5 text-[9px] font-black text-white/35">
            R{round}/{totalRounds}
          </span>
          <span className="rounded-xl border border-signal/15 bg-signal/[0.06] px-2.5 py-1.5 font-mono text-xs font-black text-signal-soft/80">
            {endsAt === null ? 'REVEAL' : formatClock(remainingMs)}
          </span>
        </div>
      </header>

      <section className="relative mt-8 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-signal-soft/60">
          {reveal.automatic ? 'Connection verdict' : 'The verdict'}
        </p>
        <h1 className="mt-2 text-[30px] font-black tracking-[-0.05em] text-white">
          {reveal.automatic ? '재접속 유예 종료' : '의심의 화살표'}
        </h1>
        <p className="mt-2 text-xs font-medium text-white/35">
          {reveal.automatic
            ? '60초 안에 돌아오지 못한 참가자의 정체를 공개합니다'
            : 'AI들이 고른 이유를 하나씩 공개합니다'}
        </p>
      </section>

      <section
        ref={voteListRef}
        className="chat-scroll relative mx-auto mt-7 max-h-[34dvh] max-w-[430px] space-y-2.5 overflow-y-auto pr-1"
        aria-live="polite"
      >
        {reveal.items.length === 0 && visibleCount === 0 ? (
          <div className="flex h-20 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/10 text-xs font-bold text-white/35">
            집계 중
            <span className="inline-flex gap-1" aria-label="집계 중">
              <i className="typing-dot" />
              <i className="typing-dot [animation-delay:150ms]" />
              <i className="typing-dot [animation-delay:300ms]" />
            </span>
          </div>
        ) : null}

        {reveal.items.slice(0, visibleCount).map((item, index) => (
          <article
            key={`${item.voter}:${item.target}:${index}`}
            className="animate-verdict-in overflow-hidden rounded-2xl border border-white/[0.075] bg-white/[0.035]"
          >
            <div className="flex items-center gap-2.5 px-3.5 py-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-white/[0.055] font-mono text-[9px] font-black text-white/30">
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="min-w-0 flex-1 truncate text-xs font-extrabold text-white/70">
                {item.voter}
              </p>
              <span className="text-sm text-signal-soft/55" aria-hidden="true">
                →
              </span>
              <p className="min-w-0 flex-1 truncate text-right text-xs font-black text-signal-soft">
                {item.target}
              </p>
            </div>
            <blockquote className="border-t border-white/[0.06] bg-black/15 px-4 py-2.5 text-[11px] font-semibold leading-5 text-white/45">
              “{item.reason || '그냥 제일 수상함'}”
            </blockquote>
          </article>
        ))}

        {reveal.items.length > 0 && visibleCount < reveal.items.length ? (
          <div className="flex h-9 items-center justify-center gap-1.5 text-[10px] font-bold text-white/25">
            다음 지목 공개 중
            <span className="inline-flex gap-1" aria-hidden="true">
              <i className="typing-dot" />
              <i className="typing-dot [animation-delay:150ms]" />
              <i className="typing-dot [animation-delay:300ms]" />
            </span>
          </div>
        ) : null}
      </section>

      {showCard ? (
        <section
          ref={cardRef}
          className="relative mx-auto mt-7 max-w-[430px] animate-card-arrive scroll-m-6 text-center"
          aria-live="assertive"
        >
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">
            {eliminated ? 'Eliminated' : 'No elimination'}
          </p>
          {eliminated ? (
            <div className="flip-scene mx-auto h-[190px] w-full">
              <div className={`flip-card ${flipped ? 'is-flipped' : ''}`}>
                <div className="flip-face flip-front border border-signal/20 bg-gradient-to-br from-[#28131a] to-ink-900 px-6">
                  <div>
                    <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-signal/20 bg-signal/10 text-xl text-signal-soft" aria-hidden="true">
                      ?
                    </span>
                    <p className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-signal-soft/50">
                      최다 득표
                    </p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{eliminated.anonName}</h2>
                  </div>
                </div>
                <div
                  className={`flip-face flip-back border px-6 ${
                    eliminated.wasAI
                      ? 'border-violet-300/20 bg-gradient-to-br from-[#1d1831] to-ink-900'
                      : 'border-electric/20 bg-gradient-to-br from-[#102724] to-ink-900'
                  }`}
                >
                  <div>
                    <span className="text-4xl" aria-hidden="true">
                      {eliminated.wasAI ? '🤖' : '🧑'}
                    </span>
                    <p
                      className={`mt-2 text-[10px] font-black uppercase tracking-[0.2em] ${
                        eliminated.wasAI ? 'text-violet-200/60' : 'text-electric/60'
                      }`}
                    >
                      {eliminated.wasAI ? 'Artificial intelligence' : 'Real human'}
                    </p>
                    <h2 className="mt-1 text-xl font-black text-white">
                      {eliminated.wasAI ? 'AI였습니다' : '인간이었습니다'}
                    </h2>
                    <p className="mx-auto mt-2 line-clamp-2 max-w-[300px] text-[11px] font-semibold leading-4 text-white/40">
                      {eliminated.revealName}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.025] px-6 py-8">
              <span className="text-3xl" aria-hidden="true">
                ◌
              </span>
              <h2 className="mt-3 text-lg font-black text-white/70">이번 라운드는 추방자 없음</h2>
              <p className="mt-2 text-xs font-medium text-white/30">전원이 기권해 다음 라운드로 넘어갑니다.</p>
            </div>
          )}
          {selfEliminated && flipped ? (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-violet-300/15 bg-violet-300/[0.07] px-3 py-1.5 text-[10px] font-bold text-violet-200/70">
              <span aria-hidden="true">👁</span> 이제부터 관전자로 계속 볼 수 있어요
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
