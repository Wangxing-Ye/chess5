import type { JSX } from "react";
import type { GameId } from "@/lib/games/types";

const iconClass = "h-10 w-10 text-[var(--cyan)]";

type IconProps = { className?: string };

const STONE_BLACK = "#020617";
const STONE_WHITE = "#f1f5f9";
const STONE_STROKE = "currentColor";

function Stone({
  cx,
  cy,
  r,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  color: "black" | "white";
}) {
  const isBlack = color === "black";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={isBlack ? STONE_BLACK : STONE_WHITE}
      stroke={STONE_STROKE}
      strokeWidth={isBlack ? 1.8 : 1.25}
    />
  );
}

/** Chess — knight (horse) icon */
function ChessKnightIcon({ className = iconClass }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden
    >
      <circle
        cx="24"
        cy="24"
        r="17"
        fill="rgba(6,182,212,0.1)"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        fontSize="26"
        fontFamily="Georgia,'Times New Roman',serif"
      >
        ♘
      </text>
    </svg>
  );
}

/** Go — four stones, 2 white + 2 black */
function GoStonesIcon({ className = iconClass }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <Stone cx={15.5} cy={15.5} r={7.4} color="black" />
      <Stone cx={32.5} cy={15.5} r={7.4} color="white" />
      <Stone cx={15.5} cy={32.5} r={7.4} color="white" />
      <Stone cx={32.5} cy={32.5} r={7.4} color="black" />
    </svg>
  );
}

/** Xiangqi — 帅 */
function XiangqiGeneralIcon({ className = iconClass }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle
        cx="24"
        cy="24"
        r="17"
        fill="rgba(248,113,113,0.12)"
        stroke="#f87171"
        strokeWidth="1.75"
      />
      <text
        x="24"
        y="31.5"
        textAnchor="middle"
        fill="#f87171"
        fontSize="22"
        fontWeight="700"
        fontFamily="'Songti SC','Noto Serif SC','STSong','SimSun',serif"
      >
        帅
      </text>
    </svg>
  );
}

/** Gomoku — five connected stones at 45° */
function GomokuFiveIcon({ className = iconClass }: IconProps) {
  // Diagonal NW→SE, slightly overlapping so they read as connected
  const stones = [
    [10, 10],
    [17, 17],
    [24, 24],
    [31, 31],
    [38, 38],
  ] as const;
  const r = 5.6;

  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <line
        x1={stones[0][0]}
        y1={stones[0][1]}
        x2={stones[4][0]}
        y2={stones[4][1]}
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.35"
      />
      {stones.map(([cx, cy], i) => (
        <Stone key={i} cx={cx} cy={cy} r={r} color="black" />
      ))}
    </svg>
  );
}

/** Othello — one disc, half white / half black */
function OthelloDiscIcon({ className = iconClass }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle
        cx="24"
        cy="24"
        r="17"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M24 7.2a16.8 16.8 0 0 0 0 33.6Z" fill={STONE_BLACK} />
      <path d="M24 7.2a16.8 16.8 0 0 1 0 33.6Z" fill={STONE_WHITE} />
    </svg>
  );
}

const ICONS: Record<GameId, (props: IconProps) => JSX.Element> = {
  chess: ChessKnightIcon,
  go: GoStonesIcon,
  xiangqi: XiangqiGeneralIcon,
  gomoku: GomokuFiveIcon,
  othello: OthelloDiscIcon,
};

export function GameIcon({
  gameId,
  className = iconClass,
}: {
  gameId: GameId;
  className?: string;
}) {
  const Icon = ICONS[gameId];
  return <Icon className={className} />;
}
