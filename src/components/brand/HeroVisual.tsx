export function HeroVisual() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 grid-fade opacity-70" />
      <div className="absolute left-[calc(50%+100px)] top-[42%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(59,130,246,0.25)] anim-pulse" />
      <div className="absolute left-[calc(50%+100px)] top-[42%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(6,182,212,0.2)]" />
      <svg
        className="absolute left-[calc(50%+100px)] top-[38%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 opacity-55"
        viewBox="0 0 400 400"
        fill="none"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1="40"
            x2="360"
            y1={40 + i * 45.7}
            y2={40 + i * 45.7}
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={`v-${i}`}
            y1="40"
            y2="360"
            x1={40 + i * 45.7}
            x2={40 + i * 45.7}
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="1"
          />
        ))}
        {/* 2 white + 1 black stones, ~30% larger */}
        <circle
          cx="200"
          cy="200"
          r="7.8"
          fill="#e8eef9"
          stroke="rgba(15,23,42,0.35)"
          strokeWidth="1"
        />
        <circle
          cx="154"
          cy="154"
          r="6.5"
          fill="#e8eef9"
          stroke="rgba(15,23,42,0.35)"
          strokeWidth="1"
        />
        <circle
          cx="246"
          cy="246"
          r="6.5"
          fill="#0b1220"
          stroke="rgba(148,163,184,0.4)"
          strokeWidth="1"
        />

        {/* Xiangqi general — 帅 */}
        <g className="anim-rise" style={{ animationDelay: "200ms" }}>
          <circle
            cx="131.4"
            cy="268.5"
            r="28"
            fill="rgba(11,15,25,0.72)"
            stroke="#f87171"
            strokeWidth="1.5"
          />
          <text
            x="131.4"
            y="268.5"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#f87171"
            fontSize="28"
            fontFamily="var(--font-display), 'Noto Sans SC', sans-serif"
            fontWeight="600"
          >
            帅
          </text>
        </g>

        {/* Chess knight */}
        <g className="anim-rise-delay">
          <circle
            cx="268.5"
            cy="131.4"
            r="28"
            fill="rgba(11,15,25,0.72)"
            stroke="#06B6D4"
            strokeWidth="1.5"
          />
          <text
            x="268.5"
            y="134"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#e8eef9"
            fontSize="34"
            fontFamily="var(--font-display), serif"
          >
            ♘
          </text>
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--bg)] to-transparent" />
    </div>
  );
}
