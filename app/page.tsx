"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Player = { name: string; balance: number };
type WinType = "zimo" | "discard";
type Screen = "setup" | "game" | "addRound" | "settle";

type Round = {
  winner: number;
  winType: WinType;
  discarder: number | null;
  points: number;
  changes: number[];
};

type Wizard = {
  step: number;
  winner: number | null;
  winType: WinType | null;
  discarder: number | null;
  points: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSettlement(players: Player[], pointValue: number) {
  const b = players.map((p, i) => ({ i, bal: p.balance * pointValue }));
  const txns: { from: number; to: number; amt: number }[] = [];
  for (let iter = 0; iter < 20; iter++) {
    b.sort((a, x) => a.bal - x.bal);
    if (Math.abs(b[0].bal) < 0.001) break;
    const poor = b[0], rich = b[b.length - 1];
    const amt = Math.min(-poor.bal, rich.bal);
    if (amt < 0.001) break;
    txns.push({ from: poor.i, to: rich.i, amt });
    poor.bal += amt;
    rich.bal -= amt;
  }
  return txns;
}

function fmt(points: number, pointValue: number) {
  const v = points * pointValue;
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(2);
}

function fmtAmt(amt: number) {
  return "$" + amt.toFixed(2);
}

function balClass(b: number) {
  if (b > 0) return "text-emerald-400";
  if (b < 0) return "text-red-400";
  return "text-slate-400";
}

const DEFAULT_NAMES = ["East", "South", "West", "North"];

// ─── App ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [players, setPlayers] = useState<Player[]>(DEFAULT_NAMES.map((n) => ({ name: n, balance: 0 })));
  const [pointValue, setPointValue] = useState(0.1);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [pvInput, setPvInput] = useState("0.10");
  const [wizard, setWizard] = useState<Wizard>({
    step: 1, winner: null, winType: null, discarder: null, points: "",
  });

  function startGame() {
    const pv = parseFloat(pvInput) || 0.1;
    setPointValue(pv);
    setPlayers(names.map((n) => ({ name: n.trim() || "Player", balance: 0 })));
    setRounds([]);
    setScreen("game");
  }

  function commitRound() {
    const { winner, winType, discarder, points } = wizard;
    const n = parseInt(points, 10);
    if (winner === null || !n || n <= 0) return;

    const changes = [0, 0, 0, 0];
    if (winType === "zimo") {
      changes[winner] += n * 3;
      for (let i = 0; i < 4; i++) if (i !== winner) changes[i] -= n;
    } else {
      if (discarder === null) return;
      changes[winner] += n * 3;
      changes[discarder] -= n * 3;
    }

    setPlayers((prev) => prev.map((p, i) => ({ ...p, balance: p.balance + changes[i] })));
    setRounds((prev) => [...prev, { winner, winType: winType!, discarder: winType === "discard" ? discarder : null, points: n, changes }]);
    setWizard({ step: 1, winner: null, winType: null, discarder: null, points: "" });
    setScreen("game");
  }

  function undoLast() {
    if (!rounds.length) return;
    const last = rounds[rounds.length - 1];
    setPlayers((prev) => prev.map((p, i) => ({ ...p, balance: p.balance - last.changes[i] })));
    setRounds((prev) => prev.slice(0, -1));
  }

  function resetGame() {
    setPlayers((prev) => prev.map((p) => ({ ...p, balance: 0 })));
    setRounds([]);
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  if (screen === "setup") return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🀄</div>
          <h1 className="text-2xl font-bold text-emerald-400">Mahjong Calculator</h1>
          <p className="text-slate-400 text-sm mt-1">Track balances · settle up instantly</p>
        </div>

        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Player Names</p>
          {names.map((name, i) => (
            <div key={i} className="flex items-center gap-3 mb-2 last:mb-0">
              <span className="text-slate-500 text-sm w-5 text-center">{i + 1}</span>
              <input
                type="text"
                value={name}
                maxLength={12}
                onChange={(e) => setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                placeholder={`Player ${i + 1}`}
              />
            </div>
          ))}
        </div>

        <div className="bg-slate-900 rounded-2xl p-5 mb-6 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Point Value</p>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">$</span>
            <input
              type="number"
              value={pvInput}
              min="0.01"
              step="0.01"
              onChange={(e) => setPvInput(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
            <span className="text-slate-400 text-sm">per point</span>
          </div>
        </div>

        <button
          onClick={startGame}
          className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Start Game
        </button>
      </div>
    </div>
  );

  // ── Game ───────────────────────────────────────────────────────────────────

  if (screen === "game") return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4 pt-2">
        <div>
          <h1 className="text-lg font-bold text-emerald-400">🀄 Mahjong</h1>
          <p className="text-xs text-slate-500">{rounds.length} round{rounds.length !== 1 ? "s" : ""} played</p>
        </div>
        <div className="flex gap-2">
          {rounds.length > 0 && (
            <button
              onClick={() => { if (window.confirm("Undo last round?")) undoLast(); }}
              className="text-xs text-slate-400 hover:text-amber-400 border border-slate-700 hover:border-amber-500 px-3 py-1.5 rounded-lg transition-colors"
            >Undo</button>
          )}
          <button
            onClick={() => { if (window.confirm("Reset all scores?")) resetGame(); }}
            className="text-xs text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500 px-3 py-1.5 rounded-lg transition-colors"
          >New</button>
        </div>
      </div>

      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {players.map((p, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <p className="text-xs text-slate-500 truncate mb-1">{p.name}</p>
            <p className={`text-xl font-bold ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</p>
            <p className="text-xs text-slate-600">{p.balance > 0 ? "+" : ""}{p.balance} pts</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-5">
        <button
          onClick={() => { setWizard({ step: 1, winner: null, winType: null, discarder: null, points: "" }); setScreen("addRound"); }}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >+ Add Round</button>
        <button
          onClick={() => setScreen("settle")}
          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
        >Settle Up</button>
      </div>

      {/* Round history */}
      {rounds.length > 0 ? (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Round History</p>
          <div className="space-y-2">
            {[...rounds].reverse().map((r, ri) => {
              const rNum = rounds.length - ri;
              return (
                <div key={ri} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs text-slate-500 mr-2">R{rNum}</span>
                      <span className="text-sm font-medium">{players[r.winner].name}</span>
                      <span className="text-xs text-emerald-400 ml-2">+{r.points * 3} pts</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {r.winType === "zimo" ? "自摸 Zimo" : `${players[r.discarder!].name} 放炮`}
                    </span>
                  </div>
                  <div className="flex gap-3 mt-2 flex-wrap">
                    {r.changes.map((c, i) => c !== 0 ? (
                      <span key={i} className={`text-xs ${c > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {players[i].name} {c > 0 ? "+" : ""}{c}
                      </span>
                    ) : null)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-12">
          <p className="text-slate-600 text-sm">No rounds yet — add the first one!</p>
        </div>
      )}
    </div>
  );

  // ── Add Round Wizard ───────────────────────────────────────────────────────

  if (screen === "addRound") {
    const { step, winner, winType, discarder, points } = wizard;
    const n = parseInt(points, 10) || 0;

    function goBack() {
      if (step === 4 && winType === "discard") setWizard((w) => ({ ...w, step: 3, discarder: null }));
      else if (step === 4) setWizard((w) => ({ ...w, step: 2, winType: null }));
      else if (step === 3) setWizard((w) => ({ ...w, step: 2, winType: null }));
      else if (step === 2) setWizard((w) => ({ ...w, step: 1, winner: null }));
      else setScreen("game");
    }

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button onClick={goBack} className="text-slate-400 hover:text-white text-xl leading-none">←</button>
          <div>
            <h2 className="text-lg font-semibold">Add Round</h2>
            <p className="text-xs text-slate-500">Step {step}</p>
          </div>
        </div>

        {step === 1 && (
          <>
            <p className="text-slate-400 text-sm mb-4">Who won this round?</p>
            <div className="space-y-3">
              {players.map((p, i) => (
                <button key={i}
                  onClick={() => setWizard((w) => ({ ...w, winner: i, step: 2 }))}
                  className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 font-medium transition-colors"
                >
                  {p.name}
                  <span className={`text-xs ml-2 ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && winner !== null && (
          <>
            <p className="text-slate-400 text-sm mb-4">
              Winner: <span className="text-white font-medium">{players[winner].name}</span> — how did they win?
            </p>
            <div className="space-y-3">
              <button
                onClick={() => setWizard((w) => ({ ...w, winType: "zimo", step: 4 }))}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">🤲 Zimo (自摸)</p>
                <p className="text-xs text-slate-500 mt-0.5">Self-draw — all 3 players each pay</p>
              </button>
              <button
                onClick={() => setWizard((w) => ({ ...w, winType: "discard", step: 3 }))}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">🎴 Discard (放炮)</p>
                <p className="text-xs text-slate-500 mt-0.5">Shooter pays all (3×)</p>
              </button>
            </div>
          </>
        )}

        {step === 3 && winner !== null && (
          <>
            <p className="text-slate-400 text-sm mb-4">Who discarded the winning tile?</p>
            <div className="space-y-3">
              {players.map((p, i) => i === winner ? null : (
                <button key={i}
                  onClick={() => setWizard((w) => ({ ...w, discarder: i, step: 4 }))}
                  className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 font-medium transition-colors"
                >
                  {p.name}
                  <span className={`text-xs ml-2 ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 4 && winner !== null && winType !== null && (
          <>
            <p className="text-slate-400 text-sm mb-4">
              {winType === "zimo"
                ? <><span className="text-white font-medium">{players[winner].name}</span> wins (Zimo) — how many points?</>
                : <><span className="text-white font-medium">{players[winner].name}</span> wins — <span className="text-red-400">{players[discarder!].name}</span> 放炮 — how many points?</>
              }
            </p>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-4">
              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={points}
                onChange={(e) => setWizard((w) => ({ ...w, points: e.target.value }))}
                placeholder="e.g. 3"
                autoFocus
                className="w-full bg-transparent text-4xl font-bold text-center text-white focus:outline-none placeholder-slate-700"
              />
              <p className="text-center text-slate-500 text-sm mt-1">points / tai</p>
            </div>

            {n > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Payment Preview</p>
                {winType === "zimo" ? (
                  <>
                    {players.map((p, i) => i !== winner ? (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-slate-400">{p.name} pays</span>
                        <span className="text-red-400">−{n} pts ({fmtAmt(n * pointValue)})</span>
                      </div>
                    ) : null)}
                    <div className="flex justify-between text-sm font-medium mt-2 pt-2 border-t border-slate-800">
                      <span className="text-slate-300">{players[winner].name} gains</span>
                      <span className="text-emerald-400">+{n * 3} pts ({fmtAmt(n * 3 * pointValue)})</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">{players[discarder!].name} pays</span>
                      <span className="text-red-400">−{n * 3} pts ({fmtAmt(n * 3 * pointValue)})</span>
                    </div>
                    <div className="flex justify-between text-sm font-medium mt-2 pt-2 border-t border-slate-800">
                      <span className="text-slate-300">{players[winner].name} gains</span>
                      <span className="text-emerald-400">+{n * 3} pts ({fmtAmt(n * 3 * pointValue)})</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              onClick={commitRound}
              disabled={!n || n <= 0}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Confirm Round
            </button>
          </>
        )}
      </div>
    );
  }

  // ── Settle ─────────────────────────────────────────────────────────────────

  if (screen === "settle") {
    const txns = getSettlement(players, pointValue);
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button onClick={() => setScreen("game")} className="text-slate-400 hover:text-white text-xl leading-none">←</button>
          <h2 className="text-lg font-semibold">Settle Up</h2>
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Final Balances</p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {players.map((p, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <p className="text-xs text-slate-500 truncate">{p.name}</p>
              <p className={`font-bold ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Transactions</p>
        {txns.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-slate-300 font-medium">All square!</p>
            <p className="text-slate-500 text-sm">No payments needed</p>
          </div>
        ) : (
          <div className="space-y-3">
            {txns.map((t, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-4 flex items-center justify-between">
                <div>
                  <span className="text-red-400 font-medium">{players[t.from].name}</span>
                  <span className="text-slate-500 text-sm mx-2">pays</span>
                  <span className="text-emerald-400 font-medium">{players[t.to].name}</span>
                </div>
                <span className="text-white font-bold text-lg">{fmtAmt(t.amt)}</span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => { if (window.confirm("Start a new game?")) { resetGame(); setScreen("game"); } }}
          className="w-full mt-6 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
        >
          New Game
        </button>
      </div>
    );
  }

  return null;
}
