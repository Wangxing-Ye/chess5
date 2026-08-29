import { setRequestLocale } from "next-intl/server";
import { MatchRoom } from "@/components/match/MatchRoom";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ locale: string; matchId: string }>;
}) {
  const { locale, matchId } = await params;
  setRequestLocale(locale);
  return <MatchRoom matchId={matchId} />;
}
