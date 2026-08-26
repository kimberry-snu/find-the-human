interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className="flex items-center gap-2.5" aria-label="인간을 찾아라">
      <div className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] shadow-glow">
        <span className="absolute -left-1 top-0 h-6 w-6 rounded-full bg-electric/25 blur-md" />
        <span className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-signal/25 blur-md" />
        <span className="relative text-base" aria-hidden="true">
          ◉
        </span>
      </div>
      <div>
        <p className={`${compact ? 'text-[13px]' : 'text-sm'} font-black tracking-[-0.03em] text-white`}>
          인간을 찾아라
        </p>
        {compact ? null : (
          <div className="brand-reflection-stage mt-0.5 inline-block text-[9px] font-bold uppercase tracking-[0.24em]">
            <p className="relative z-10 text-white/40">Reverse Turing Game</p>
            <span className="brand-floor-reflection" aria-hidden="true">
              Reverse Turing Game
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
