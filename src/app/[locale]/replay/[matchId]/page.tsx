import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ReplayRoom } from "@/components/match/ReplayRoom";
import { getMatchRecord, parseRow } from "@/lib/db/matches";

export const dynamic = "force-dynamic";

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ locale: string; matchId: string }>;
}) {
  const { locale, matchId } = await params;
  setRequestLocale(locale);

  const row = getMatchRecord(matchId);
  if (!row) notFound();

  const parsed = parseRow(row);
  return (
    <ReplayRoom
      record={{
        id: parsed.id,
        seq: parsed.seq,
        gameId: parsed.game_id,
        mode: parsed.mode,
        startedAt: parsed.started_at,
        endedAt: parsed.ended_at,
        winner: parsed.winner,
        winReason: parsed.win_reason,
        playerW: parsed.playerW,
        playerB: parsed.playerB,
        moves: parsed.moves,
        outputs: parsed.outputs,
        failures: parsed.failures,
      }}
    />
  );
}
