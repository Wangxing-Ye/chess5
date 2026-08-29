/**
 * Smoke test: engines + match store (create → move → terminal) + DB stats.
 */

const games = ["chess", "xiangqi", "gomoku", "go", "othello"];

async function main() {
  const { getEngine } = await import("../src/lib/games/index.ts");
  const { createMatch, getMatch } = await import("../src/lib/match/store.ts");
  const { applyPlayerMove, resign } = await import("../src/lib/match/engine.ts");
  const { hvmSummary, mvmSummary, listMatchRecords } = await import(
    "../src/lib/db/matches.ts"
  );

  for (const id of games) {
    const engine = getEngine(id);
    let state = engine.newGame(id === "go" ? { size: 9 } : undefined);
    const legal = engine.legalMoves(state);
    if (legal.length === 0) throw new Error(`${id}: no legal moves at start`);
    const move = legal.find((m) => m.san !== "pass") ?? legal[0];
    state = engine.applyMove(state, move);
    const term = engine.isTerminal(state);
    const prompt = engine.toPromptView(state);
    if (!prompt.includes("JSON")) throw new Error(`${id}: prompt missing JSON hint`);
    console.log(
      `OK ${id}: moved ${move.san}, over=${term.over}, history=${state.moveHistory.length}`,
    );

    const match = createMatch({
      gameId: id,
      mode: "human_vs_model",
      players: {
        w: { kind: "human" },
        b: { kind: "model", provider: "openai", model: "gpt-5.6-luna", name: "OpenAI" },
      },
      goSize: id === "go" ? 9 : undefined,
    });
    const mLegal = getEngine(id).legalMoves(match.state);
    const mMove = mLegal.find((x) => x.san !== "pass") ?? mLegal[0];
    applyPlayerMove(match, mMove);
    resign(match, "b");
    const stored = getMatch(match.id);
    if (!stored || stored.status !== "finished") {
      throw new Error(`${id}: match lifecycle failed`);
    }
    console.log(`OK match/${id}: ${match.id} finished by resign`);
  }

  // Chess checkmate
  const chess = getEngine("chess");
  let c = chess.newGame();
  for (const san of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7"]) {
    c = chess.applyMove(c, san);
  }
  const mate = chess.isTerminal(c);
  if (!mate.over || mate.result?.reason !== "checkmate") {
    throw new Error(`chess scholar mate failed: ${JSON.stringify(mate)}`);
  }
  console.log("OK chess scholar's mate");

  // Gomoku five-in-a-row
  const gomoku = getEngine("gomoku");
  let g = gomoku.newGame();
  const seq = ["H8", "A1", "H7", "A2", "H6", "A3", "H5", "A4", "H4"];
  for (const san of seq) g = gomoku.applyMove(g, san);
  const gw = gomoku.isTerminal(g);
  if (!gw.over || gw.result?.winner !== "w") {
    throw new Error(`gomoku win failed: ${JSON.stringify(gw)}`);
  }
  console.log("OK gomoku five-in-a-row");

  // Othello opening flip
  const othello = getEngine("othello");
  let o = othello.newGame();
  const first = othello.legalMoves(o).map((m) => m.san).sort();
  if (JSON.stringify(first) !== JSON.stringify(["C4", "D3", "E6", "F5"])) {
    throw new Error(`othello opening moves wrong: ${first.join(",")}`);
  }
  o = othello.applyMove(o, "D3");
  const matrix = othello.getBoardMatrix?.(o) ?? [];
  // D3 placed black; D4 should flip to black
  if (matrix[5][3] !== "w" || matrix[4][3] !== "w") {
    throw new Error(`othello flip failed after D3`);
  }
  console.log("OK othello opening flip");

  // Model-vs-model match for mvm aggregation
  const mvmMatch = createMatch({
    gameId: "gomoku",
    mode: "model_vs_model",
    players: {
      w: { kind: "model", provider: "openai", model: "gpt-5.6-luna", name: "OpenAI" },
      b: {
        kind: "model",
        provider: "anthropic",
        model: "claude-sonnet-5",
        name: "Anthropic",
      },
    },
  });
  applyPlayerMove(mvmMatch, "H8");
  resign(mvmMatch, "b");

  // DB stats
  const hvm = hvmSummary();
  if (hvm.total < games.length) {
    throw new Error(`hvm summary too small: ${JSON.stringify(hvm)}`);
  }
  if (hvm.humanWins < games.length) {
    throw new Error(`hvm humanWins mismatch: ${JSON.stringify(hvm)}`);
  }
  const mvm = mvmSummary();
  if (mvm.total < 1 || mvm.decided < 1) {
    throw new Error(`mvm summary missing match: ${JSON.stringify(mvm)}`);
  }
  const gptRecord = mvm.models.find((m) => m.model.startsWith("OpenAI"));
  if (!gptRecord || gptRecord.wins < 1) {
    throw new Error(`mvm per-model record wrong: ${JSON.stringify(mvm.models)}`);
  }
  const recent = listMatchRecords(10);
  if (recent.length === 0) throw new Error("no match records in DB");
  if (!recent[0].ended_at) throw new Error("finished match missing ended_at");
  if (typeof recent[0].seq !== "number" || recent[0].seq < 1) {
    throw new Error(`match seq missing: ${JSON.stringify(recent[0])}`);
  }
  console.log(
    `OK db: hvm total=${hvm.total} humanWins=${hvm.humanWins}, mvm total=${mvm.total} models=${mvm.models.length}, recent=${recent.length}, latest=#${recent[0].seq}`,
  );

  console.log("All smoke tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
