import { normalizeWinner } from '../lib/game-utils';
import type { GameResult } from '../types';
import { BrandMark } from './BrandMark';
import { RefreshIcon } from './icons';

interface ResultScreenProps {
  result: GameResult;
  spectatorMode: boolean;
  roomCode: string | null;
  isHost: boolean;
  onAgain: () => void;
}

export function ResultScreen({
  result,
  spectatorMode,
  roomCode,
  isHost,
  onAgain,
}: ResultScreenProps) {
  const winner = spectatorMode ? 'SPECTATOR' : normalizeWinner(result.winner);
  const humanCount = result.reveal.filter((identity) => !identity.isAI).length;
  const aiCount = result.reveal.length - humanCount;

  const headline =
    winner === 'AI'
      ? { eyebrow: 'AI victory', title: 'AI가 인간을 찾아냈다', emoji: '🤖', color: 'text-violet-200' }
      : winner === 'HUMAN'
        ? { eyebrow: 'Human survived', title: '인간이 끝까지 살아남았다', emoji: '🧑', color: 'text-electric' }
        : { eyebrow: 'Spectator mode', title: '놀랍게도 전원 AI였다', emoji: '👁', color: 'text-white' };

  return (
    <main className="relative min-h-dvh overflow-hidden px-5 pb-[max(30px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -right-28 top-20 h-72 w-72 rounded-full bg-violet-400/[0.09] blur-3xl" />
      <div className="pointer-events-none absolute -left-28 top-72 h-72 w-72 rounded-full bg-electric/[0.07] blur-3xl" />
      <header className="relative flex items-center justify-between">
        <BrandMark compact />
        {roomCode ? (
          <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 font-mono text-[10px] font-black tracking-[0.15em] text-white/35">
            {roomCode}
          </span>
        ) : null}
      </header>

      <section className="relative mt-9 text-center">
        <span className="mx-auto grid h-20 w-20 animate-result-pop place-items-center rounded-[28px] border border-white/10 bg-white/[0.055] text-[40px] shadow-2xl" aria-hidden="true">
          {headline.emoji}
        </span>
        <p className={`mt-5 text-[10px] font-black uppercase tracking-[0.24em] ${headline.color}`}>
          {headline.eyebrow}
        </p>
        <h1 className="mx-auto mt-2 max-w-[340px] text-[30px] font-black leading-[1.15] tracking-[-0.055em] text-white">
          {headline.title}
        </h1>
        <p className="mt-3 text-xs font-medium text-white/35">
          {winner === 'SPECTATOR'
            ? '인간 없는 심리전의 모든 정체를 공개합니다.'
            : '끝까지 숨겨졌던 참가자들의 정체를 공개합니다.'}
        </p>

        <div className="mx-auto mt-5 flex w-fit items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[10px] font-bold text-white/35">
          <span className="text-electric">인간 {humanCount}</span>
          <span className="text-white/15">·</span>
          <span className="text-violet-200">AI {aiCount}</span>
        </div>
      </section>

      <section className="relative mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black text-white/80">전체 정체</h2>
          <span className="text-[9px] font-black uppercase tracking-widest text-white/25">Identity log</span>
        </div>
        <div className="space-y-2">
          {result.reveal.map((identity, index) => (
            <article
              key={identity.anonName}
              className="flex animate-list-in items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3"
              style={{ animationDelay: `${index * 65}ms` }}
            >
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ${
                  identity.isAI
                    ? 'bg-violet-300/10 ring-1 ring-violet-300/15'
                    : 'bg-electric/10 ring-1 ring-electric/15'
                }`}
                aria-hidden="true"
              >
                {identity.isAI ? '🤖' : '🧑'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-xs font-black text-white/80">{identity.anonName}</h3>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase ${
                      identity.isAI
                        ? 'bg-violet-300/10 text-violet-200/75'
                        : 'bg-electric/10 text-electric/75'
                    }`}
                  >
                    {identity.isAI ? 'AI' : 'Human'}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] font-semibold text-white/35">
                  {identity.isAI
                    ? identity.personaSummary || '정체를 완벽하게 숨긴 AI'
                    : `실제 닉네임 · ${identity.realNickname || '익명의 인간'}`}
                </p>
              </div>
              <span className="font-mono text-[9px] font-bold text-white/15">
                {String(index + 1).padStart(2, '0')}
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="relative mt-7">
        <button
          type="button"
          onClick={onAgain}
          className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-black text-black transition hover:bg-electric-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
        >
          <RefreshIcon className="h-5 w-5" />
          같은 방에서 다시 하기
        </button>
        <p className="mt-2.5 text-center text-[10px] font-medium text-white/25">
          {isHost ? '모두 함께 로비로 돌아가 새 게임을 설정합니다.' : '다시 하기를 누르면 같은 방 로비로 돌아갑니다.'}
        </p>
      </section>
    </main>
  );
}
