"use client";

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMode = "shooter-pays-all" | "split";
type Config = {
  paymentMode: PaymentMode;
  enableGang: boolean;
  enableMini: boolean;
  fanCap: number;
  multiplier: number;
};
type Player = { name: string; balance: number };
type WinType = "zimo" | "discard";
type GangType = "open" | "concealed";
type MiniFrom = "all" | number;
type AddTab = "win" | "gang" | "mini";
type Screen = "setup" | "game" | "add" | "settle";
type Round = { type: AddTab; changes: number[]; label: string; detail: string };

// ─── Scoring helpers ──────────────────────────────────────────────────────────

// SG rules: base = 2^fan (capped at fanCap)
// Discard win (split): discarder pays 2×base, each other pays 1×base → winner gets 4×base
// Discard win (shooter-pays-all): discarder pays full total (4×base), others pay 0
// Self-draw (zimo): each non-winner pays 2×base → winner gets 6×base

function fanBase(fan: number, cap: number) {
  return Math.pow(2, Math.min(fan, cap));
}

function computeWinChanges(
  w: number,
  wt: WinType,
  d: number | null,
  fan: number,
  cap: number,
  mode: PaymentMode
): number[] {
  const base = fanBase(fan, cap);
  const c = [0, 0, 0, 0];
  if (wt === "zimo") {
    for (let i = 0; i < 4; i++) {
      if (i === w) continue;
      c[i] -= base * 2;
      c[w] += base * 2;
    }
  } else if (d !== null) {
    if (mode === "shooter-pays-all") {
      const total = base * 4; // what all 3 would have paid in split
      c[d] -= total;
      c[w] += total;
    } else {
      for (let i = 0; i < 4; i++) {
        if (i === w) continue;
        const pay = i === d ? base * 2 : base;
        c[i] -= pay;
        c[w] += pay;
      }
    }
  }
  return c;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmtDollar = (pts: number, pv: number, mult: number) =>
  (pts >= 0 ? "+" : "−") + "$" + Math.abs(pts * pv * mult).toFixed(2);

const fmtAmt = (amt: number) => "$" + amt.toFixed(2);
const balClass = (b: number) =>
  b > 0 ? "text-emerald-400" : b < 0 ? "text-red-400" : "text-slate-400";

const DEFAULT_NAMES = ["East", "South", "West", "North"];

// ─── Settlement ───────────────────────────────────────────────────────────────

function getSettlement(players: Player[], pv: number, mult: number) {
  const b = players.map((p, i) => ({ i, bal: p.balance * pv * mult }));
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

// ─── PlayerBtn ────────────────────────────────────────────────────────────────

function PlayerBtn({
  player, balance, pv, mult, selected, onClick, disabled,
}: {
  player: string; balance: number; pv: number; mult: number;
  selected: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 min-w-0 rounded-xl py-3 px-2 border-2 transition-colors text-center ${
        disabled
          ? "opacity-30 cursor-not-allowed border-slate-800 bg-slate-900"
          : selected
          ? "border-emerald-500 bg-emerald-950"
          : "border-slate-700 bg-slate-900 hover:border-slate-600"
      }`}
    >
      <p className="text-sm font-semibold truncate">{player}</p>
      <p className={`text-xs mt-0.5 ${balClass(balance)}`}>
        {fmtDollar(balance, pv, mult)}
      </p>
    </button>
  );
}

// ─── Fan picker ───────────────────────────────────────────────────────────────

function FanPicker({
  value, onChange, cap,
}: {
  value: number | null; onChange: (n: number) => void; cap: number;
}) {
  const fans = Array.from({ length: cap + 1 }, (_, i) => i);
  return (
    <div className="flex gap-2 flex-wrap">
      {fans.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`w-12 h-12 rounded-xl border-2 text-sm font-bold transition-colors ${
            value === f
              ? "border-emerald-500 bg-emerald-950 text-white"
              : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
          }`}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [players, setPlayers] = useState<Player[]>(
    DEFAULT_NAMES.map((n) => ({ name: n, balance: 0 }))
  );
  const [pv, setPv] = useState(0.1);
  const [config, setConfig] = useState<Config>({
    paymentMode: "shooter-pays-all",
    enableGang: true,
    enableMini: true,
    fanCap: 5,
    multiplier: 1,
  });
  const [rounds, setRounds] = useState<Round[]>([]);

  // setup form
  const [names, setNames] = useState(DEFAULT_NAMES);
  const [pvInput, setPvInput] = useState("0.10");
  const [multInput, setMultInput] = useState("1");
  const [fanCapInput, setFanCapInput] = useState("5");

  // add screen
  const [addTab, setAddTab] = useState<AddTab>("win");

  // win state
  const [winner, setWinner] = useState<number | null>(null);
  const [winType, setWinType] = useState<WinType | null>(null);
  const [discarder, setDiscarder] = useState<number | null>(null);
  const [fan, setFan] = useState<number | null>(null);

  // gang state
  const [gangCollector, setGangCollector] = useState<number | null>(null);
  const [gangType, setGangType] = useState<GangType | null>(null);

  // mini state
  const [miniCollector, setMiniCollector] = useState<number | null>(null);
  const [miniReason, setMiniReason] = useState("");
  const [miniFrom, setMiniFrom] = useState<MiniFrom | null>(null);
  const [miniPts, setMiniPts] = useState<number>(1);

  const MINI_PRESETS: { label: string; pts: number; from: "all" | "one" }[] = [
    { label: "🐱🐭 Cat & Mouse",        pts: 2, from: "all" },
    { label: "🐔🐛 Chicken & Centipede", pts: 2, from: "all" },
    { label: "🦁 Single Animal",         pts: 1, from: "all" },
    { label: "🦁×4 Animal Set",          pts: 4, from: "all" },
    { label: "🌸 Matching Flower Pair",  pts: 2, from: "all" },
    { label: "🌸×4 Flower Set",          pts: 4, from: "all" },
    { label: "🍂×4 Season Set",          pts: 4, from: "all" },
  ];

  // ── Actions ────────────────────────────────────────────────────────────────

  function applyRound(round: Round) {
    setPlayers((prev) =>
      prev.map((p, i) => ({ ...p, balance: p.balance + round.changes[i] }))
    );
    setRounds((prev) => [...prev, round]);
    setScreen("game");
  }

  function submitWin() {
    if (winner === null || winType === null || fan === null) return;
    if (winType === "discard" && discarder === null) return;
    const changes = computeWinChanges(
      winner, winType, discarder, fan, config.fanCap, config.paymentMode
    );
    const base = fanBase(fan, config.fanCap);
    const winnerGets = changes[winner];
    const modeTag =
      winType === "discard" && config.paymentMode === "split" ? " (split)" : "";
    applyRound({
      type: "win",
      changes,
      label: `${players[winner].name} wins`,
      detail:
        winType === "zimo"
          ? `自摸 · ${fan}fan · base ${base}pts · each pays ${base * 2}`
          : `${players[discarder!].name} 放炮${modeTag} · ${fan}fan · +${winnerGets}pts`,
    });
    setWinner(null); setWinType(null); setDiscarder(null); setFan(null);
  }

  function submitGang() {
    if (gangCollector === null || gangType === null) return;
    // SG rules: both gang types pay 2pts from each
    const mult = gangType === "concealed" ? 2 : 1;
    const c = [0, 0, 0, 0];
    c[gangCollector] += mult * 3;
    for (let i = 0; i < 4; i++) if (i !== gangCollector) c[i] -= mult;
    applyRound({
      type: "gang",
      changes: c,
      label: `${players[gangCollector].name} 杠`,
      detail: `${gangType === "concealed" ? "暗杠 ×2" : "明杠 ×1"} · +${mult * 3}pts`,
    });
    setGangCollector(null); setGangType(null);
  }

  function submitMini() {
    if (miniCollector === null || miniFrom === null) return;
    const c = [0, 0, 0, 0];
    if (miniFrom === "all") {
      c[miniCollector] += miniPts * 3;
      for (let i = 0; i < 4; i++) if (i !== miniCollector) c[i] -= miniPts;
    } else {
      c[miniCollector] += miniPts;
      c[miniFrom as number] -= miniPts;
    }
    applyRound({
      type: "mini",
      changes: c,
      label: `${players[miniCollector].name} collects`,
      detail: `${miniReason || "misc"} · ${miniPts}pt${miniPts > 1 ? "s" : ""} · ${
        miniFrom === "all"
          ? "from all"
          : `from ${players[miniFrom as number].name}`
      }`,
    });
    setMiniCollector(null); setMiniReason(""); setMiniFrom(null); setMiniPts(1);
  }

  function undoLast() {
    if (!rounds.length) return;
    const last = rounds[rounds.length - 1];
    setPlayers((prev) =>
      prev.map((p, i) => ({ ...p, balance: p.balance - last.changes[i] }))
    );
    setRounds((prev) => prev.slice(0, -1));
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  if (screen === "setup")
    return (
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
                  type="text"
                  value={name}
                  maxLength={12}
                  onChange={(e) =>
                    setNames((p) => p.map((n, j) => (j === i ? e.target.value : n)))
                  }
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  placeholder={`Player ${i + 1}`}
                />
              </div>
            ))}
          </div>

          {/* Point value + multiplier */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Bet Configuration
            </p>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-slate-400 text-sm w-28 flex-shrink-0">$ per point</span>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  value={pvInput}
                  min="0.01"
                  step="0.01"
                  onChange={(e) => setPvInput(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm w-28 flex-shrink-0">Multiplier</span>
              <div className="flex gap-2 flex-1">
                {[1, 2, 3, 5].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMultInput(String(m))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                      multInput === String(m)
                        ? "border-emerald-500 bg-emerald-950 text-white"
                        : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {m}×
                  </button>
                ))}
                <input
                  type="number"
                  value={[1, 2, 3, 5].includes(Number(multInput)) ? "" : multInput}
                  placeholder="…"
                  min="1"
                  onChange={(e) => setMultInput(e.target.value)}
                  className="w-14 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-white text-center focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-3">
              e.g. 3fan self-draw → 6 × 8pts = 48pts × ${parseFloat(pvInput) || 0.1} × {parseInt(multInput) || 1} ={" "}
              {fmtAmt(48 * (parseFloat(pvInput) || 0.1) * (parseInt(multInput) || 1))} per player
            </p>
          </div>

          {/* Fan cap */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Fan Cap</p>
            <p className="text-xs text-slate-600 mb-3">Max fan counted (default 5 = 32pts base)</p>
            <div className="flex gap-2">
              {[3, 4, 5, 6, 8].map((cap) => (
                <button
                  key={cap}
                  onClick={() => setFanCapInput(String(cap))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                    fanCapInput === String(cap)
                      ? "border-emerald-500 bg-emerald-950 text-white"
                      : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          {/* Payment mode */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Discard Payment Mode
            </p>
            <div className="space-y-2">
              {(
                [
                  ["split", "Split", "Discarder 2×base, others 1×base"],
                  ["shooter-pays-all", "Shooter pays all", "Discarder covers full total, others pay 0"],
                ] as const
              ).map(([mode, label, sub]) => (
                <button
                  key={mode}
                  onClick={() => setConfig((c) => ({ ...c, paymentMode: mode }))}
                  className={`w-full text-left rounded-xl px-4 py-3 border-2 transition-colors ${
                    config.paymentMode === mode
                      ? "border-emerald-500 bg-emerald-950"
                      : "border-slate-700 bg-slate-800"
                  }`}
                >
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Round types */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-6 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Enable Round Types
            </p>
            {(
              [
                ["enableGang", "杠 Gang / Kong", "Open 1× or Concealed 2×"],
                ["enableMini", "💰 Mini Payments", "Flowers, animals, bonus collections"],
              ] as const
            ).map(([key, label, sub]) => (
              <div key={key} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-slate-500">{sub}</p>
                </div>
                <button
                  onClick={() =>
                    setConfig((c) => ({ ...c, [key]: !c[key as keyof Config] }))
                  }
                  className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ml-4 ${
                    config[key as keyof Config] ? "bg-emerald-600" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      config[key as keyof Config]
                        ? "translate-x-5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              const newPv = parseFloat(pvInput) || 0.1;
              const newMult = parseInt(multInput) || 1;
              const newCap = parseInt(fanCapInput) || 5;
              setPv(newPv);
              setConfig((c) => ({ ...c, multiplier: newMult, fanCap: newCap }));
              setPlayers(names.map((n) => ({ name: n.trim() || "Player", balance: 0 })));
              setRounds([]);
              setScreen("game");
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Start Game
          </button>
        </div>
      </div>
    );

  // ── Game ───────────────────────────────────────────────────────────────────

  if (screen === "game")
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4 pt-2">
          <div>
            <h1 className="text-lg font-bold text-emerald-400">🀄 Mahjong</h1>
            <p className="text-xs text-slate-500">
              {rounds.length} round{rounds.length !== 1 ? "s" : ""} ·{" "}
              {config.paymentMode === "split" ? "split" : "shooter pays all"} ·{" "}
              ${pv.toFixed(2)}/pt{config.multiplier > 1 ? ` × ${config.multiplier}` : ""}
            </p>
          </div>
          <div className="flex gap-2">
            {rounds.length > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("Undo last round?")) undoLast();
                }}
                className="text-xs text-slate-400 hover:text-amber-400 border border-slate-700 hover:border-amber-500 px-3 py-1.5 rounded-lg transition-colors"
              >
                Undo
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm("Reset scores?")) {
                  setPlayers((p) => p.map((x) => ({ ...x, balance: 0 })));
                  setRounds([]);
                }
              }}
              className="text-xs text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              New
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {players.map((p, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <p className="text-xs text-slate-500 truncate mb-1">{p.name}</p>
              <p className={`text-xl font-bold ${balClass(p.balance)}`}>
                {fmtDollar(p.balance, pv, config.multiplier)}
              </p>
              <p className="text-xs text-slate-600">
                {p.balance > 0 ? "+" : ""}
                {p.balance} pts
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-3 mb-5">
          <button
            onClick={() => {
              setAddTab("win");
              setScreen("add");
            }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            + Add Round
          </button>
          <button
            onClick={() => setScreen("settle")}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
          >
            Settle Up
          </button>
        </div>

        {rounds.length > 0 ? (
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">History</p>
            <div className="space-y-2">
              {[...rounds].reverse().map((r, ri) => {
                const rNum = rounds.length - ri;
                return (
                  <div
                    key={ri}
                    className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-slate-600 flex-shrink-0">R{rNum}</span>
                        <span className="text-sm font-medium truncate">{r.label}</span>
                      </div>
                      <span className="text-xs text-slate-500 ml-2 flex-shrink-0">
                        {r.detail}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1.5 flex-wrap">
                      {r.changes.map((c, i) =>
                        c !== 0 ? (
                          <span
                            key={i}
                            className={`text-xs ${c > 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {players[i].name} {c > 0 ? "+" : ""}
                            {c}
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12">
            <p className="text-slate-600 text-sm">No rounds yet — tap Add Round</p>
          </div>
        )}
      </div>
    );

  // ── Add Round ──────────────────────────────────────────────────────────────

  if (screen === "add") {
    const tabs: { id: AddTab; label: string; show: boolean }[] = [
      { id: "win",  label: "🏆 Win",  show: true },
      { id: "gang", label: "杠 Gang", show: config.enableGang },
      { id: "mini", label: "💰 Mini", show: config.enableMini },
    ];

    // live preview for win
    const winPreview =
      winner !== null &&
      winType !== null &&
      fan !== null &&
      (winType === "zimo" || discarder !== null)
        ? computeWinChanges(winner, winType, discarder, fan, config.fanCap, config.paymentMode)
        : null;

    const winReady =
      winner !== null &&
      winType !== null &&
      fan !== null &&
      (winType === "zimo" || discarder !== null);
    const gangReady = gangCollector !== null && gangType !== null;
    const miniReady = miniCollector !== null && miniFrom !== null;

    // base for current fan selection
    const base = fan !== null ? fanBase(fan, config.fanCap) : null;

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pt-2">
          <button
            onClick={() => setScreen("game")}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            ←
          </button>
          <h2 className="text-lg font-semibold">Add Round</h2>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 mb-6 bg-slate-900 p-1 rounded-xl border border-slate-800">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setAddTab(t.id)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  addTab === t.id
                    ? "bg-slate-700 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {/* ── Win tab ─────────────────────────────────────────────────────── */}
        {addTab === "win" && (
          <div className="space-y-5">
            {/* Winner */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Who won?
              </p>
              <div className="flex gap-2">
                {players.map((p, i) => (
                  <PlayerBtn
                    key={i}
                    player={p.name}
                    balance={p.balance}
                    pv={pv}
                    mult={config.multiplier}
                    selected={winner === i}
                    onClick={() => {
                      setWinner(i);
                      if (discarder === i) setDiscarder(null);
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Win type */}
            {winner !== null && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                  Win type
                </p>
                <div className="flex gap-2">
                  {(
                    [
                      ["zimo",    "🤲 Zimo (自摸)",       "Each player pays 2×base"],
                      ["discard", "🎴 Discard (放炮)",
                        config.paymentMode === "split"
                          ? "Discarder 2×, others 1×"
                          : "Discarder pays all (4×base)"],
                    ] as const
                  ).map(([t, label, sub]) => (
                    <button
                      key={t}
                      onClick={() => {
                        setWinType(t);
                        if (t === "zimo") setDiscarder(null);
                      }}
                      className={`flex-1 rounded-xl px-3 py-3 border-2 text-left transition-colors ${
                        winType === t
                          ? "border-emerald-500 bg-emerald-950"
                          : "border-slate-700 bg-slate-900 hover:border-slate-600"
                      }`}
                    >
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Discarder */}
            {winner !== null && winType === "discard" && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                  Who discarded?
                </p>
                <div className="flex gap-2">
                  {players.map((p, i) => (
                    <PlayerBtn
                      key={i}
                      player={p.name}
                      balance={p.balance}
                      pv={pv}
                      mult={config.multiplier}
                      selected={discarder === i}
                      disabled={i === winner}
                      onClick={() => setDiscarder(i)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Fan count */}
            {winner !== null && winType !== null && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Fan count (台数)
                </p>
                <p className="text-xs text-slate-600 mb-3">
                  Cap: {config.fanCap}fan = {fanBase(config.fanCap, config.fanCap)}pts base
                </p>
                <FanPicker value={fan} onChange={setFan} cap={config.fanCap} />
                {base !== null && (
                  <p className="text-xs text-slate-500 mt-2">
                    {fan}fan → base {base}pts
                    {winType === "zimo"
                      ? ` · each pays ${base * 2}pts (${fmtAmt(base * 2 * pv * config.multiplier)})`
                      : config.paymentMode === "split"
                      ? ` · discarder −${base * 2}pts, others −${base}pts`
                      : ` · discarder pays ${base * 4}pts total`}
                  </p>
                )}
              </div>
            )}

            {/* Preview */}
            {winPreview && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                  Preview
                </p>
                {winPreview.map((c, i) =>
                  c !== 0 ? (
                    <div key={i} className="flex justify-between text-sm py-0.5">
                      <span className="text-slate-400">{players[i].name}</span>
                      <span className={c > 0 ? "text-emerald-400" : "text-red-400"}>
                        {c > 0 ? "+" : "−"}
                        {Math.abs(c)} pts (
                        {fmtAmt(Math.abs(c) * pv * config.multiplier)})
                      </span>
                    </div>
                  ) : null
                )}
              </div>
            )}

            <button
              onClick={submitWin}
              disabled={!winReady}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Confirm Win
            </button>
          </div>
        )}

        {/* ── Gang tab ─────────────────────────────────────────────────────── */}
        {addTab === "gang" && (
          <div className="space-y-5">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Who declared the Gang?
              </p>
              <div className="flex gap-2">
                {players.map((p, i) => (
                  <PlayerBtn
                    key={i}
                    player={p.name}
                    balance={p.balance}
                    pv={pv}
                    mult={config.multiplier}
                    selected={gangCollector === i}
                    onClick={() => setGangCollector(i)}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Gang type
              </p>
              <div className="flex gap-2">
                {(
                  [
                    ["open",       "明杠 Open",       "Each pays 1pt · +" + fmtAmt(3 * pv * config.multiplier)],
                    ["concealed",  "暗杠 Concealed",   "Each pays 2pts · +" + fmtAmt(6 * pv * config.multiplier)],
                  ] as const
                ).map(([t, label, sub]) => (
                  <button
                    key={t}
                    onClick={() => setGangType(t)}
                    className={`flex-1 rounded-xl px-3 py-3 border-2 text-left transition-colors ${
                      gangType === t
                        ? "border-emerald-500 bg-emerald-950"
                        : "border-slate-700 bg-slate-900 hover:border-slate-600"
                    }`}
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {gangReady && gangCollector !== null && gangType !== null && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                  Preview
                </p>
                {players.map((p, i) => {
                  const m = gangType === "concealed" ? 2 : 1;
                  const c = i === gangCollector ? m * 3 : -m;
                  return (
                    <div key={i} className="flex justify-between text-sm py-0.5">
                      <span className="text-slate-400">{p.name}</span>
                      <span className={c > 0 ? "text-emerald-400" : "text-red-400"}>
                        {c > 0 ? "+" : "−"}
                        {Math.abs(c)} pts ({fmtAmt(Math.abs(c) * pv * config.multiplier)})
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              onClick={submitGang}
              disabled={!gangReady}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Confirm Gang
            </button>
          </div>
        )}

        {/* ── Mini tab ─────────────────────────────────────────────────────── */}
        {addTab === "mini" && (
          <div className="space-y-5">
            {/* Collector */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Who collects?
              </p>
              <div className="flex gap-2">
                {players.map((p, i) => (
                  <PlayerBtn
                    key={i}
                    player={p.name}
                    balance={p.balance}
                    pv={pv}
                    mult={config.multiplier}
                    selected={miniCollector === i}
                    onClick={() => {
                      setMiniCollector(i);
                      if (typeof miniFrom === "number" && miniFrom === i)
                        setMiniFrom(null);
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Presets */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Reason
              </p>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {MINI_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const active = miniReason === preset.label;
                      setMiniReason(active ? "" : preset.label);
                      if (!active) {
                        setMiniPts(preset.pts);
                        if (preset.from === "all") setMiniFrom("all");
                      }
                    }}
                    className={`rounded-xl px-3 py-2.5 text-left border transition-colors ${
                      miniReason === preset.label
                        ? "border-emerald-500 bg-emerald-950 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    <p className="text-xs font-medium leading-tight">{preset.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{preset.pts}pt · from all</p>
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={MINI_PRESETS.some((p) => p.label === miniReason) ? "" : miniReason}
                onChange={(e) => setMiniReason(e.target.value)}
                placeholder="Custom reason (optional)"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Amount */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Amount (pts)
              </p>
              <div className="flex gap-2">
                {[1, 2, 4].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setMiniPts(amt)}
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-bold transition-colors ${
                      miniPts === amt
                        ? "border-emerald-500 bg-emerald-950 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {amt}pt
                  </button>
                ))}
              </div>
            </div>

            {/* Collect from */}
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                Collect from
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setMiniFrom("all")}
                  className={`w-full text-left rounded-xl px-4 py-3 border-2 transition-colors ${
                    miniFrom === "all"
                      ? "border-emerald-500 bg-emerald-950"
                      : "border-slate-700 bg-slate-900 hover:border-slate-600"
                  }`}
                >
                  <p className="text-sm font-medium">Everyone</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Each other player pays {miniPts}pt (
                    {fmtAmt(miniPts * pv * config.multiplier)})
                  </p>
                </button>
                <div className="flex gap-2">
                  {players.map((p, i) => (
                    <PlayerBtn
                      key={i}
                      player={p.name}
                      balance={p.balance}
                      pv={pv}
                      mult={config.multiplier}
                      selected={miniFrom === i}
                      disabled={i === miniCollector}
                      onClick={() => setMiniFrom(i)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Mini preview */}
            {miniReady && miniCollector !== null && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                  Preview
                </p>
                {players.map((p, i) => {
                  let c = 0;
                  if (miniFrom === "all") {
                    c = i === miniCollector ? miniPts * 3 : -miniPts;
                  } else {
                    if (i === miniCollector) c = miniPts;
                    else if (i === miniFrom) c = -miniPts;
                  }
                  return c !== 0 ? (
                    <div key={i} className="flex justify-between text-sm py-0.5">
                      <span className="text-slate-400">{p.name}</span>
                      <span className={c > 0 ? "text-emerald-400" : "text-red-400"}>
                        {c > 0 ? "+" : "−"}
                        {Math.abs(c)}pt ({fmtAmt(Math.abs(c) * pv * config.multiplier)})
                      </span>
                    </div>
                  ) : null;
                })}
              </div>
            )}

            <button
              onClick={submitMini}
              disabled={!miniReady}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Settle ─────────────────────────────────────────────────────────────────

  if (screen === "settle") {
    const txns = getSettlement(players, pv, config.multiplier);
    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6 pt-2">
          <button
            onClick={() => setScreen("game")}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            ←
          </button>
          <h2 className="text-lg font-semibold">Settle Up</h2>
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
          Final Balances
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {players.map((p, i) => (
            <div
              key={i}
              className="bg-slate-900 border border-slate-800 rounded-xl p-3"
            >
              <p className="text-xs text-slate-500 truncate">{p.name}</p>
              <p className={`font-bold text-lg ${balClass(p.balance)}`}>
                {fmtDollar(p.balance, pv, config.multiplier)}
              </p>
              <p className="text-xs text-slate-600">
                {p.balance > 0 ? "+" : ""}
                {p.balance} pts
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
          Transactions
        </p>
        {txns.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-slate-300 font-medium">All square!</p>
            <p className="text-slate-500 text-sm">No payments needed</p>
          </div>
        ) : (
          <div className="space-y-3">
            {txns.map((t, i) => (
              <div
                key={i}
                className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-red-400 font-medium">
                    {players[t.from].name}
                  </span>
                  <span className="text-slate-500 text-sm mx-2">pays</span>
                  <span className="text-emerald-400 font-medium">
                    {players[t.to].name}
                  </span>
                </div>
                <span className="text-white font-bold text-lg">
                  {fmtAmt(t.amt)}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => {
            if (window.confirm("Start a new game?")) {
              setPlayers((p) => p.map((x) => ({ ...x, balance: 0 })));
              setRounds([]);
              setScreen("game");
            }
          }}
          className="w-full mt-6 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-3 rounded-xl border border-slate-700 transition-colors"
        >
          New Game
        </button>
      </div>
    );
  }

  return null;
}
