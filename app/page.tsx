"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMode = "shooter-pays-all" | "split";

type Config = {
  paymentMode: PaymentMode;
  enableGang: boolean;
  enableMini: boolean;
};

type Player = { name: string; balance: number };
type WinType = "zimo" | "discard";
type GangType = "open" | "concealed";
type Screen = "setup" | "game" | "addRound" | "addGang" | "addMini" | "settle";

type Round = {
  type: "win" | "gang" | "mini";
  changes: number[];
  label: string;
  detail: string;
};

type WinWizard = {
  step: number;
  winner: number | null;
  winType: WinType | null;
  discarder: number | null;
  points: string;
};

type GangWizard = {
  step: number;
  collector: number | null;
  gangType: GangType | null;
};

type MiniWizard = {
  step: number;
  collector: number | null;
  reason: string;
  from: "all" | number | null;
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
  const [config, setConfig] = useState<Config>({ paymentMode: "shooter-pays-all", enableGang: true, enableMini: true });
  const [rounds, setRounds] = useState<Round[]>([]);

  // Setup inputs
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [pvInput, setPvInput] = useState("0.10");

  // Wizards
  const [winWiz, setWinWiz] = useState<WinWizard>({ step: 1, winner: null, winType: null, discarder: null, points: "" });
  const [gangWiz, setGangWiz] = useState<GangWizard>({ step: 1, collector: null, gangType: null });
  const [miniWiz, setMiniWiz] = useState<MiniWizard>({ step: 1, collector: null, reason: "", from: null });

  // ── Game actions ────────────────────────────────────────────────────────────

  function commitWin() {
    const { winner, winType, discarder, points } = winWiz;
    const n = parseInt(points, 10);
    if (winner === null || !n || n <= 0) return;

    const changes = [0, 0, 0, 0];

    if (winType === "zimo") {
      changes[winner] += n * 3;
      for (let i = 0; i < 4; i++) if (i !== winner) changes[i] -= n;
    } else {
      // discard
      if (discarder === null) return;
      if (config.paymentMode === "shooter-pays-all") {
        changes[winner] += n * 3;
        changes[discarder] -= n * 3;
      } else {
        // split: discarder pays 2×, other 2 each pay 1×
        for (let i = 0; i < 4; i++) {
          if (i === winner) continue;
          const pay = i === discarder ? 2 : 1;
          changes[i] -= pay * n;
          changes[winner] += pay * n;
        }
      }
    }

    applyRound({
      type: "win",
      changes,
      label: `${players[winner].name} wins`,
      detail: winType === "zimo"
        ? `自摸 · +${n * 3} pts`
        : `${players[discarder!].name} 放炮 · ${config.paymentMode === "split" ? "split" : "all"} · +${Math.abs(changes[winner])} pts`,
    });
    setWinWiz({ step: 1, winner: null, winType: null, discarder: null, points: "" });
    setScreen("game");
  }

  function commitGang() {
    const { collector, gangType } = gangWiz;
    if (collector === null || gangType === null) return;

    const mult = gangType === "concealed" ? 2 : 1;
    const changes = [0, 0, 0, 0];
    changes[collector] += mult * 3;
    for (let i = 0; i < 4; i++) if (i !== collector) changes[i] -= mult;

    applyRound({
      type: "gang",
      changes,
      label: `${players[collector].name} 杠`,
      detail: `${gangType === "concealed" ? "暗杠 (2×)" : "明杠 (1×)"} · +${mult * 3} pts`,
    });
    setGangWiz({ step: 1, collector: null, gangType: null });
    setScreen("game");
  }

  function commitMini() {
    const { collector, reason, from } = miniWiz;
    if (collector === null || from === null) return;

    const changes = [0, 0, 0, 0];
    if (from === "all") {
      changes[collector] += 3;
      for (let i = 0; i < 4; i++) if (i !== collector) changes[i] -= 1;
    } else {
      changes[collector] += 1;
      changes[from] -= 1;
    }

    applyRound({
      type: "mini",
      changes,
      label: `${players[collector].name} collects`,
      detail: `${reason || "mini"} · ${from === "all" ? "from all" : `from ${players[from as number].name}`}`,
    });
    setMiniWiz({ step: 1, collector: null, reason: "", from: null });
    setScreen("game");
  }

  function applyRound(round: Round) {
    setPlayers((prev) => prev.map((p, i) => ({ ...p, balance: p.balance + round.changes[i] })));
    setRounds((prev) => [...prev, round]);
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

  function startGame() {
    const pv = parseFloat(pvInput) || 0.1;
    setPointValue(pv);
    setPlayers(names.map((n) => ({ name: n.trim() || "Player", balance: 0 })));
    setRounds([]);
    setScreen("game");
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  if (screen === "setup") return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🀄</div>
          <h1 className="text-2xl font-bold text-emerald-400">Mahjong Calculator</h1>
          <p className="text-slate-400 text-sm mt-1">Configure before you play</p>
        </div>

        {/* Players */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Players</p>
          {names.map((name, i) => (
            <div key={i} className="flex items-center gap-3 mb-2 last:mb-0">
              <span className="text-slate-500 text-sm w-5 text-center">{i + 1}</span>
              <input
                type="text" value={name} maxLength={12}
                onChange={(e) => setNames((prev) => prev.map((n, j) => j === i ? e.target.value : n))}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                placeholder={`Player ${i + 1}`}
              />
            </div>
          ))}
        </div>

        {/* Point value */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Point Value</p>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">$</span>
            <input
              type="number" value={pvInput} min="0.01" step="0.01"
              onChange={(e) => setPvInput(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
            />
            <span className="text-slate-400 text-sm">per point</span>
          </div>
        </div>

        {/* Payment mode */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Discard Payment</p>
          <div className="space-y-2">
            {([
              ["shooter-pays-all", "Shooter pays all (3×)", "放炮者赔全部"],
              ["split", "Split — shooter pays 2×, others 1×", "各付各，放炮多1倍"],
            ] as const).map(([mode, label, sub]) => (
              <button key={mode}
                onClick={() => setConfig((c) => ({ ...c, paymentMode: mode }))}
                className={`w-full text-left rounded-xl px-4 py-3 border-2 transition-colors ${config.paymentMode === mode ? "border-emerald-500 bg-emerald-950" : "border-slate-700 bg-slate-800"}`}
              >
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Feature toggles */}
        <div className="bg-slate-900 rounded-2xl p-5 mb-6 border border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Round Types</p>
          {([
            ["enableGang", "杠 Gang / Kong", "Open 明杠 (1×) or Concealed 暗杠 (2×)"],
            ["enableMini", "Mini Payments", "Cat/mouse, flower pairs, etc."],
          ] as const).map(([key, label, sub]) => (
            <div key={key} className="flex items-center justify-between py-2 last:pb-0">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </div>
              <button
                onClick={() => setConfig((c) => ({ ...c, [key]: !c[key as keyof Config] }))}
                className={`w-11 h-6 rounded-full transition-colors relative ${config[key as keyof Config] ? "bg-emerald-600" : "bg-slate-700"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${config[key as keyof Config] ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={startGame}
          className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors"
        >Start Game</button>
      </div>
    </div>
  );

  // ── Game ───────────────────────────────────────────────────────────────────

  if (screen === "game") return (
    <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4 pt-2">
        <div>
          <h1 className="text-lg font-bold text-emerald-400">🀄 Mahjong</h1>
          <p className="text-xs text-slate-500">{rounds.length} round{rounds.length !== 1 ? "s" : ""} · {config.paymentMode === "split" ? "split" : "shooter pays all"}</p>
        </div>
        <div className="flex gap-2">
          {rounds.length > 0 && (
            <button onClick={() => { if (window.confirm("Undo last round?")) undoLast(); }}
              className="text-xs text-slate-400 hover:text-amber-400 border border-slate-700 hover:border-amber-500 px-3 py-1.5 rounded-lg transition-colors"
            >Undo</button>
          )}
          <button onClick={() => { if (window.confirm("Reset all scores?")) resetGame(); }}
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
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button
          onClick={() => { setWinWiz({ step: 1, winner: null, winType: null, discarder: null, points: "" }); setScreen("addRound"); }}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
        >+ Win</button>
        {config.enableGang && (
          <button
            onClick={() => { setGangWiz({ step: 1, collector: null, gangType: null }); setScreen("addGang"); }}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
          >杠 Gang</button>
        )}
        {config.enableMini && (
          <button
            onClick={() => { setMiniWiz({ step: 1, collector: null, reason: "", from: null }); setScreen("addMini"); }}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
          >💰 Mini</button>
        )}
        <button
          onClick={() => setScreen("settle")}
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
        >Settle Up</button>
      </div>

      {/* History */}
      {rounds.length > 0 ? (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">History</p>
          <div className="space-y-2">
            {[...rounds].reverse().map((r, ri) => {
              const rNum = rounds.length - ri;
              return (
                <div key={ri} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
                  <div className="flex justify-between items-start">
                    <span className="text-xs text-slate-500 mr-2">R{rNum}</span>
                    <span className="text-sm font-medium flex-1">{r.label}</span>
                    <span className="text-xs text-slate-500 ml-2 text-right">{r.detail}</span>
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

  // ── Win Wizard ─────────────────────────────────────────────────────────────

  if (screen === "addRound") {
    const { step, winner, winType, discarder, points } = winWiz;
    const n = parseInt(points, 10) || 0;

    function goBack() {
      if (step === 4 && winType === "discard") setWinWiz((w) => ({ ...w, step: 3, discarder: null }));
      else if (step === 4) setWinWiz((w) => ({ ...w, step: 2, winType: null }));
      else if (step === 3) setWinWiz((w) => ({ ...w, step: 2, winType: null }));
      else if (step === 2) setWinWiz((w) => ({ ...w, step: 1, winner: null }));
      else setScreen("game");
    }

    // Preview payment changes for display
    function previewChanges(): number[] {
      if (!n || winner === null) return [0, 0, 0, 0];
      const changes = [0, 0, 0, 0];
      if (winType === "zimo") {
        changes[winner] += n * 3;
        for (let i = 0; i < 4; i++) if (i !== winner) changes[i] -= n;
      } else if (winType === "discard" && discarder !== null) {
        if (config.paymentMode === "shooter-pays-all") {
          changes[winner] += n * 3;
          changes[discarder] -= n * 3;
        } else {
          for (let i = 0; i < 4; i++) {
            if (i === winner) continue;
            const pay = i === discarder ? 2 : 1;
            changes[i] -= pay * n;
            changes[winner] += pay * n;
          }
        }
      }
      return changes;
    }

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button onClick={goBack} className="text-slate-400 hover:text-white text-xl leading-none">←</button>
          <div>
            <h2 className="text-lg font-semibold">Add Win</h2>
            <p className="text-xs text-slate-500">Step {step}</p>
          </div>
        </div>

        {step === 1 && (
          <>
            <p className="text-slate-400 text-sm mb-4">Who won?</p>
            <div className="space-y-3">
              {players.map((p, i) => (
                <button key={i}
                  onClick={() => setWinWiz((w) => ({ ...w, winner: i, step: 2 }))}
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
              <span className="text-white font-medium">{players[winner].name}</span> — how did they win?
            </p>
            <div className="space-y-3">
              <button onClick={() => setWinWiz((w) => ({ ...w, winType: "zimo", step: 4 }))}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">🤲 Zimo (自摸)</p>
                <p className="text-xs text-slate-500 mt-0.5">Self-draw · each other player pays 1×</p>
              </button>
              <button onClick={() => setWinWiz((w) => ({ ...w, winType: "discard", step: 3 }))}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">🎴 Discard (放炮)</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {config.paymentMode === "shooter-pays-all"
                    ? "Shooter pays all (3×)"
                    : "Shooter 2× · others 1×"}
                </p>
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
                  onClick={() => setWinWiz((w) => ({ ...w, discarder: i, step: 4 }))}
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
                type="number" inputMode="numeric" min="1"
                value={points}
                onChange={(e) => setWinWiz((w) => ({ ...w, points: e.target.value }))}
                placeholder="e.g. 3"
                autoFocus
                className="w-full bg-transparent text-4xl font-bold text-center text-white focus:outline-none placeholder-slate-700"
              />
              <p className="text-center text-slate-500 text-sm mt-1">points / tai</p>
            </div>

            {n > 0 && (() => {
              const preview = previewChanges();
              return (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Payment Preview</p>
                  {preview.map((c, i) => c !== 0 ? (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-slate-400">{players[i].name} {c > 0 ? "gains" : "pays"}</span>
                      <span className={c > 0 ? "text-emerald-400" : "text-red-400"}>
                        {c > 0 ? "+" : "−"}{Math.abs(c)} pts ({fmtAmt(Math.abs(c) * pointValue)})
                      </span>
                    </div>
                  ) : null)}
                </div>
              );
            })()}

            <button onClick={commitWin} disabled={!n || n <= 0}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >Confirm</button>
          </>
        )}
      </div>
    );
  }

  // ── Gang Wizard ────────────────────────────────────────────────────────────

  if (screen === "addGang") {
    const { step, collector, gangType } = gangWiz;
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button onClick={() => {
            if (step === 2) setGangWiz((w) => ({ ...w, step: 1, collector: null }));
            else setScreen("game");
          }} className="text-slate-400 hover:text-white text-xl leading-none">←</button>
          <div>
            <h2 className="text-lg font-semibold">杠 Gang / Kong</h2>
            <p className="text-xs text-slate-500">Step {step}</p>
          </div>
        </div>

        {step === 1 && (
          <>
            <p className="text-slate-400 text-sm mb-4">Who declared the gang?</p>
            <div className="space-y-3">
              {players.map((p, i) => (
                <button key={i}
                  onClick={() => setGangWiz((w) => ({ ...w, collector: i, step: 2 }))}
                  className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 font-medium transition-colors"
                >
                  {p.name}
                  <span className={`text-xs ml-2 ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && collector !== null && (
          <>
            <p className="text-slate-400 text-sm mb-4">
              <span className="text-white font-medium">{players[collector].name}</span> — what type of gang?
            </p>
            <div className="space-y-3">
              <button onClick={() => { setGangWiz((w) => ({ ...w, gangType: "open" })); setTimeout(commitGang, 0); }}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">明杠 Open Gang</p>
                <p className="text-xs text-slate-500 mt-0.5">Add 4th to existing meld · each other pays <strong>1×</strong> ({fmtAmt(pointValue)})</p>
              </button>
              <button onClick={() => { setGangWiz((w) => ({ ...w, gangType: "concealed" })); setTimeout(commitGang, 0); }}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">暗杠 Concealed Gang</p>
                <p className="text-xs text-slate-500 mt-0.5">All 4 from hand · each other pays <strong>2×</strong> ({fmtAmt(pointValue * 2)})</p>
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Mini Payment Wizard ────────────────────────────────────────────────────

  if (screen === "addMini") {
    const { step, collector, reason, from } = miniWiz;

    const MINI_PRESETS = ["🐱🐭 Cat & Mouse", "🐔🐛 Chicken & Centipede", "🌸 Flower pair", "Other"];

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button onClick={() => {
            if (step === 3) setMiniWiz((w) => ({ ...w, step: 2, from: null }));
            else if (step === 2) setMiniWiz((w) => ({ ...w, step: 1, collector: null }));
            else setScreen("game");
          }} className="text-slate-400 hover:text-white text-xl leading-none">←</button>
          <div>
            <h2 className="text-lg font-semibold">💰 Mini Payment</h2>
            <p className="text-xs text-slate-500">Step {step}</p>
          </div>
        </div>

        {step === 1 && (
          <>
            <p className="text-slate-400 text-sm mb-4">Who collects?</p>
            <div className="space-y-3">
              {players.map((p, i) => (
                <button key={i}
                  onClick={() => setMiniWiz((w) => ({ ...w, collector: i, step: 2 }))}
                  className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 font-medium transition-colors"
                >
                  {p.name}
                  <span className={`text-xs ml-2 ${balClass(p.balance)}`}>{fmt(p.balance, pointValue)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && collector !== null && (
          <>
            <p className="text-slate-400 text-sm mb-4">
              <span className="text-white font-medium">{players[collector].name}</span> — what is this for?
            </p>
            <div className="space-y-2 mb-4">
              {MINI_PRESETS.map((preset) => (
                <button key={preset}
                  onClick={() => setMiniWiz((w) => ({ ...w, reason: preset === "Other" ? "" : preset, step: 3 }))}
                  className={`w-full text-left bg-slate-900 border-2 rounded-xl px-5 py-3 font-medium transition-colors ${reason === preset || (preset === "Other" && !MINI_PRESETS.slice(0,-1).includes(reason)) ? "border-emerald-500" : "border-slate-700 hover:border-slate-600"}`}
                >
                  {preset}
                </button>
              ))}
            </div>
            {/* custom reason */}
            <input
              type="text" value={reason.startsWith("🐱") || reason.startsWith("🐔") || reason.startsWith("🌸") ? "" : reason}
              onChange={(e) => setMiniWiz((w) => ({ ...w, reason: e.target.value }))}
              placeholder="Or type custom reason..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
            {(reason || !MINI_PRESETS.slice(0,-1).some(p => reason === p)) && (
              <button onClick={() => setMiniWiz((w) => ({ ...w, step: 3 }))}
                className="w-full mt-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >Next →</button>
            )}
          </>
        )}

        {step === 3 && collector !== null && (
          <>
            <p className="text-slate-400 text-sm mb-1">
              <span className="text-white font-medium">{players[collector].name}</span> collects
              {reason ? <span className="text-emerald-400"> · {reason}</span> : ""}
            </p>
            <p className="text-slate-400 text-sm mb-4">Collect from?</p>
            <div className="space-y-3">
              <button onClick={() => { setMiniWiz((w) => ({ ...w, from: "all" })); setTimeout(commitMini, 0); }}
                className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 transition-colors"
              >
                <p className="font-medium">Everyone (all pay 1 pt)</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {players.filter((_, i) => i !== collector).map(p => p.name).join(", ")} each pay {fmtAmt(pointValue)}
                </p>
              </button>
              {players.map((p, i) => i === collector ? null : (
                <button key={i}
                  onClick={() => { setMiniWiz((w) => ({ ...w, from: i })); setTimeout(commitMini, 0); }}
                  className="w-full text-left bg-slate-900 border-2 border-slate-700 hover:border-emerald-600 rounded-xl px-5 py-4 font-medium transition-colors"
                >
                  Only {p.name}
                  <span className="text-xs text-slate-500 ml-2">pays {fmtAmt(pointValue)}</span>
                </button>
              ))}
            </div>
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
              <p className="text-xs text-slate-600">{p.balance > 0 ? "+" : ""}{p.balance} pts</p>
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
        >New Game</button>
      </div>
    );
  }

  return null;
}
