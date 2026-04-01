"use client";

import { useState, useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentMode = "shooter-pays-all" | "split";
type Config = {
  paymentMode: PaymentMode;
  enableGang: boolean;
  enableMini: boolean;
  fanCap: number;
  multiplier: number;
  falseWinPenalty: number; // pts per player
  eightFlowerTai: number;
};
type Player = { name: string; balance: number };
type WinType = "zimo" | "discard";
type GangType = "open" | "concealed";
type MiniFrom = "all" | number;
type RoundType = "win" | "gang" | "mini" | "draw" | "false-win" | "flower-win";
type AddTab = "win" | "gang" | "bonus" | "other";
type Screen = "setup" | "game" | "add" | "settle";
type Round = { type: RoundType; changes: number[]; label: string; detail: string; dealerRotated?: boolean };

// ─── Scoring helpers ──────────────────────────────────────────────────────────

// SG rules: base = 2^tai (capped), half = base/2 (min 1)
// Discard (split):  shooter pays base+half, others pay base each
// Discard (shooter-pays-all): shooter pays full total (3×base + half)
// Zimo:             each pays base+half
// Bao:              responsible player pays full total (3×(base+half))

function fanBase(fan: number, cap: number) {
  return Math.pow(2, Math.min(fan, cap));
}

function fanHalf(fan: number, cap: number) {
  return Math.max(1, Math.pow(2, Math.min(fan, cap) - 1));
}

function computeWinChanges(
  w: number,
  wt: WinType,
  d: number | null,
  fan: number,
  cap: number,
  mode: PaymentMode,
  baoPlayer: number | null = null
): number[] {
  const base = fanBase(fan, cap);
  const half = fanHalf(fan, cap);
  const c = [0, 0, 0, 0];

  if (baoPlayer !== null) {
    // Bao: one player pays the full zimo-equivalent total
    const total = 3 * (base + half);
    c[baoPlayer] -= total;
    c[w] += total;
    return c;
  }

  if (wt === "zimo") {
    for (let i = 0; i < 4; i++) {
      if (i === w) continue;
      c[i] -= base + half;
      c[w] += base + half;
    }
  } else if (d !== null) {
    const total = 3 * base + half;
    if (mode === "shooter-pays-all") {
      c[d] -= total;
      c[w] += total;
    } else {
      for (let i = 0; i < 4; i++) {
        if (i === w) continue;
        const pay = i === d ? base + half : base;
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
const WINDS = ["E", "S", "W", "N"];

// Anti-clockwise display order for 2×2 grids:
// East  | North
// South | West
const GRID_ORDER = [0, 3, 1, 2];

function seatWind(playerIdx: number, dealer: number) {
  return WINDS[(playerIdx - dealer + 4) % 4];
}

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

function generateSettlementText(players: Player[], pv: number, mult: number) {
  const txns = getSettlement(players, pv, mult);
  let text = "🀄 Mahjong Settlement\n━━━━━━━━━━━━━━━━━━\n";
  for (const p of players) {
    text += `${p.name}: ${fmtDollar(p.balance, pv, mult)}\n`;
  }
  if (txns.length > 0) {
    text += "━━━━━━━━━━━━━━━━━━\nPayments:\n";
    for (const t of txns) {
      text += `${players[t.from].name} → ${players[t.to].name}: ${fmtAmt(t.amt)}\n`;
    }
  } else {
    text += "\nAll square! No payments needed.\n";
  }
  return text;
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

// ─── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "mahjong-calc-state";

type SavedState = {
  screen: Screen;
  players: Player[];
  pv: number;
  config: Config;
  rounds: Round[];
  dealer: number;
};

function loadSaved(): SavedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const saved = useRef(loadSaved()).current;

  const [screen, setScreen] = useState<Screen>(saved?.screen ?? "setup");
  const [players, setPlayers] = useState<Player[]>(
    saved?.players ?? DEFAULT_NAMES.map((n) => ({ name: n, balance: 0 }))
  );
  const [pv, setPv] = useState(saved?.pv ?? 0.1);
  const [config, setConfig] = useState<Config>({
    paymentMode: "shooter-pays-all",
    enableGang: true,
    enableMini: true,
    fanCap: 5,
    multiplier: 1,
    falseWinPenalty: 48,
    eightFlowerTai: 5,
    ...saved?.config,
  });
  const [rounds, setRounds] = useState<Round[]>(saved?.rounds ?? []);
  const [dealer, setDealer] = useState(saved?.dealer ?? 0);

  // persist game state on every change
  useEffect(() => {
    const state: SavedState = { screen, players, pv, config, rounds, dealer };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [screen, players, pv, config, rounds, dealer]);

  // setup form (pre-populate from saved state if available)
  const [names, setNames] = useState(saved?.players?.map((p) => p.name) ?? DEFAULT_NAMES);
  const [pvInput, setPvInput] = useState(saved?.pv?.toString() ?? "0.10");
  const [multInput, setMultInput] = useState(saved?.config?.multiplier?.toString() ?? "1");
  const [fanCapInput, setFanCapInput] = useState(saved?.config?.fanCap?.toString() ?? "5");
  const [dealerInput, setDealerInput] = useState(saved?.dealer ?? 0);

  // add screen
  const [addTab, setAddTab] = useState<AddTab>("win");

  // win state
  const [winner, setWinner] = useState<number | null>(null);
  const [winType, setWinType] = useState<WinType | null>(null);
  const [discarder, setDiscarder] = useState<number | null>(null);
  const [fan, setFan] = useState<number | null>(null);
  const [baoEnabled, setBaoEnabled] = useState(false);
  const [baoPlayer, setBaoPlayer] = useState<number | null>(null);

  // gang state
  const [gangCollector, setGangCollector] = useState<number | null>(null);
  const [gangType, setGangType] = useState<GangType | null>(null);

  // mini state
  const [miniCollector, setMiniCollector] = useState<number | null>(null);
  const [miniReason, setMiniReason] = useState("");
  const [miniFrom, setMiniFrom] = useState<MiniFrom | null>(null);
  const [miniPts, setMiniPts] = useState<number>(1);

  // special tab state
  const [flowerPlayer, setFlowerPlayer] = useState<number | null>(null);
  const [falseWinPlayer, setFalseWinPlayer] = useState<number | null>(null);

  const MINI_PRESETS: { label: string; pts: number; from: "all" | "one" }[] = [
    { label: "🐱🐭 Cat & Rat",           pts: 2, from: "all" },
    { label: "🐔🐛 Rooster & Centipede", pts: 2, from: "all" },
    { label: "×4 Animal Set",            pts: 2, from: "all" },
    { label: "🌸 Matching Flower Pair",  pts: 2, from: "all" },
    { label: "🌸×4 Flower Set",          pts: 2, from: "all" },
    { label: "🍂×4 Season Set",          pts: 2, from: "all" },
    { label: "🌺 Eat Flower",       pts: 1, from: "one" },
  ];

  function resetAddState() {
    setWinner(null); setWinType(null); setDiscarder(null); setFan(null);
    setBaoEnabled(false); setBaoPlayer(null);
    setGangCollector(null); setGangType(null);
    setMiniCollector(null); setMiniReason(""); setMiniFrom(null); setMiniPts(1);
    setFlowerPlayer(null); setFalseWinPlayer(null);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  function applyRound(round: Round, winnerIdx?: number) {
    // Determine if dealer rotates
    let rotates = false;
    if (round.type === "draw") {
      rotates = true;
    } else if (round.type === "win" || round.type === "flower-win") {
      rotates = winnerIdx !== undefined && winnerIdx !== dealer;
    }
    const roundWithFlag = { ...round, dealerRotated: rotates };
    setPlayers((prev) =>
      prev.map((p, i) => ({ ...p, balance: p.balance + round.changes[i] }))
    );
    setRounds((prev) => [...prev, roundWithFlag]);
    if (rotates) setDealer((d) => (d + 1) % 4);
    setScreen("game");
  }

  function submitWin() {
    if (winner === null || winType === null || fan === null) return;
    if (winType === "discard" && discarder === null) return;
    if (baoEnabled && (baoPlayer === null || baoPlayer === winner)) return;
    const changes = computeWinChanges(
      winner, winType, discarder, fan, config.fanCap, config.paymentMode,
      baoEnabled ? baoPlayer : null
    );
    const base = fanBase(fan, config.fanCap);
    const half = fanHalf(fan, config.fanCap);
    const winnerGets = changes[winner];
    const baoTag = baoEnabled && baoPlayer !== null ? ` · 包 ${players[baoPlayer].name}` : "";
    const modeTag =
      !baoEnabled && winType === "discard" && config.paymentMode === "split" ? " (split)" : "";
    applyRound({
      type: "win",
      changes,
      label: `${players[winner].name} wins`,
      detail:
        winType === "zimo"
          ? `自摸 · ${fan}tai · each pays ${base + half}pts${baoTag}`
          : `${players[discarder!].name} 放炮${modeTag} · ${fan}tai · +${winnerGets}pts${baoTag}`,
    }, winner);
    resetAddState();
  }

  function submitGang() {
    if (gangCollector === null || gangType === null) return;
    // Open gang: each pays 1pt, Concealed gang: each pays 2pt
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
    resetAddState();
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
    resetAddState();
  }

  function submitDraw() {
    applyRound({
      type: "draw",
      changes: [0, 0, 0, 0],
      label: "荒庄 Draw",
      detail: "No winner",
    });
    resetAddState();
  }

  function submitFlowerWin() {
    if (flowerPlayer === null) return;
    const tai = config.eightFlowerTai;
    const base = fanBase(tai, config.fanCap);
    const half = fanHalf(tai, config.fanCap);
    const c = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      if (i === flowerPlayer) continue;
      c[i] -= base + half;
      c[flowerPlayer] += base + half;
    }
    applyRound({
      type: "flower-win",
      changes: c,
      label: `${players[flowerPlayer].name} 八花`,
      detail: `8 flowers · ${tai}tai · each pays ${base + half}pts`,
    }, flowerPlayer);
    resetAddState();
  }

  function submitFalseWin() {
    if (falseWinPlayer === null) return;
    const penalty = config.falseWinPenalty;
    const c = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      if (i === falseWinPlayer) continue;
      c[i] += penalty;
      c[falseWinPlayer] -= penalty;
    }
    applyRound({
      type: "false-win",
      changes: c,
      label: `${players[falseWinPlayer].name} 诈胡`,
      detail: `False win · pays ${penalty}pts to each`,
    });
    resetAddState();
  }

  function undoLast() {
    if (!rounds.length) return;
    const last = rounds[rounds.length - 1];
    setPlayers((prev) =>
      prev.map((p, i) => ({ ...p, balance: p.balance - last.changes[i] }))
    );
    setRounds((prev) => prev.slice(0, -1));
    if (last.dealerRotated) {
      setDealer((d) => (d + 3) % 4); // reverse rotation
    }
  }

  async function shareSettlement() {
    const text = generateSettlementText(players, pv, config.multiplier);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard!");
    }
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  if (screen === "setup")
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">{"🀄"}</div>
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

          {/* Starting dealer */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">Starting Dealer (East)</p>
            <div className="flex gap-2">
              {names.map((name, i) => (
                <button
                  key={i}
                  onClick={() => setDealerInput(i)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors truncate px-1 ${
                    dealerInput === i
                      ? "border-emerald-500 bg-emerald-950 text-white"
                      : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {name.trim() || `P${i + 1}`}
                </button>
              ))}
            </div>
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
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={multInput}
                  onChange={(e) => setMultInput(e.target.value)}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  placeholder="e.g. 0.5, 1, 2"
                />
                <span className="text-slate-500 text-sm">×</span>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-3">
              e.g. 3tai zimo → each pays {8 + 4}pts × ${parseFloat(pvInput) || 0.1} × {parseFloat(multInput) || 1} ={" "}
              {fmtAmt(12 * (parseFloat(pvInput) || 0.1) * (parseFloat(multInput) || 1))} per player
            </p>
          </div>

          {/* Tai cap */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Tai Cap</p>
            <p className="text-xs text-slate-600 mb-3">Max tai counted (default 5 = base 32 + half 16)</p>
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
                  ["split", "Split", "Shooter pays base+half, others pay base"],
                  ["shooter-pays-all", "Shooter pays all", "Shooter covers full total, others pay 0"],
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
          <div className="bg-slate-900 rounded-2xl p-5 mb-4 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Enable Round Types
            </p>
            {(
              [
                ["enableGang", "杠 Gang / Kong", "Open 1× or Concealed 2×"],
                ["enableMini", "🌸 Bonus Payments", "Flowers, animals, bonus collections"],
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
                  className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 flex items-center px-0.5 ${
                    config[key as keyof Config] ? "bg-emerald-600" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-white transition-all ${
                      config[key as keyof Config]
                        ? "ml-auto"
                        : "ml-0"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Advanced: penalties & flower wins */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-6 border border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
              Special Rules
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{"诈胡"} False win penalty (pts/player)</p>
                <input
                  type="number"
                  value={config.falseWinPenalty}
                  min="1"
                  max="999"
                  onChange={(e) => setConfig((c) => ({ ...c, falseWinPenalty: Math.max(1, parseInt(e.target.value) || 48) }))}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-center focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{"八花"} 8 flowers tai</p>
                <input
                  type="number"
                  value={config.eightFlowerTai}
                  min="1"
                  max="10"
                  onChange={(e) => setConfig((c) => ({ ...c, eightFlowerTai: Math.max(1, parseInt(e.target.value) || 5) }))}
                  className="w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-center focus:outline-none focus:border-emerald-500 text-sm"
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              const newPv = parseFloat(pvInput) || 0.1;
              const newMult = parseFloat(multInput) || 1;
              const newCap = parseInt(fanCapInput) || 5;
              setPv(newPv);
              setConfig((c) => ({ ...c, multiplier: newMult, fanCap: newCap }));
              setPlayers(names.map((n) => ({ name: n.trim() || "Player", balance: 0 })));
              setRounds([]);
              setDealer(dealerInput);
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
            <h1 className="text-lg font-bold text-emerald-400">{"🀄"} Mahjong</h1>
            <p className="text-xs text-slate-500">
              {rounds.length} round{rounds.length !== 1 ? "s" : ""} {"·"}{" "}
              {config.paymentMode === "split" ? "split" : "shooter pays all"} {"·"}{" "}
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
                if (window.confirm("Go back to setup? Current game will be preserved.")) {
                  setScreen("setup");
                }
              }}
              className="text-xs text-slate-400 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              Setup
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          {GRID_ORDER.map((i) => {
            const p = players[i];
            const wind = seatWind(i, dealer);
            const isDealer = wind === "E";
            return (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`text-xs font-bold ${isDealer ? "text-emerald-400" : "text-slate-600"}`}>
                  {wind}
                </span>
                <p className="text-xs text-slate-500 truncate">{p.name}</p>
              </div>
              <p className={`text-xl font-bold ${balClass(p.balance)}`}>
                {fmtDollar(p.balance, pv, config.multiplier)}
              </p>
              <p className="text-xs text-slate-600">
                {p.balance > 0 ? "+" : ""}
                {p.balance} pts
              </p>
            </div>
            );
          })}
        </div>

        <div className="flex gap-3 mb-5">
          <button
            onClick={() => {
              resetAddState();
              setAddTab("win");
              setScreen("add");
            }}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            + Add
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
                      <span className="text-xs text-slate-500 ml-2 flex-shrink-0 max-w-[50%] truncate">
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
            <p className="text-slate-600 text-sm">No rounds yet — tap + Add</p>
          </div>
        )}
      </div>
    );

  // ── Add Round ──────────────────────────────────────────────────────────────

  if (screen === "add") {
    const tabs: { id: AddTab; label: string; show: boolean }[] = [
      { id: "win",     label: "🏆 Win",     show: true },
      { id: "gang",    label: "杠 Gang",    show: config.enableGang },
      { id: "bonus",   label: "🌸 Bonus",   show: config.enableMini },
      { id: "other",   label: "⚡ Other",   show: true },
    ];

    // live preview for win
    const winPreview =
      winner !== null &&
      winType !== null &&
      fan !== null &&
      (winType === "zimo" || discarder !== null) &&
      (!baoEnabled || baoPlayer !== null)
        ? computeWinChanges(
            winner, winType, discarder, fan, config.fanCap, config.paymentMode,
            baoEnabled ? baoPlayer : null
          )
        : null;

    const winReady =
      winner !== null &&
      winType !== null &&
      fan !== null &&
      (winType === "zimo" || discarder !== null) &&
      (!baoEnabled || baoPlayer !== null);
    const gangReady = gangCollector !== null && gangType !== null;
    const miniReady = miniCollector !== null && miniFrom !== null;

    // base + half for current fan selection
    const base = fan !== null ? fanBase(fan, config.fanCap) : null;
    const half = fan !== null ? fanHalf(fan, config.fanCap) : null;

    return (
      <div className="min-h-screen bg-slate-950 text-white p-4 max-w-lg mx-auto pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pt-2">
          <button
            onClick={() => setScreen("game")}
            className="text-slate-400 hover:text-white text-xl leading-none"
          >
            {"←"}
          </button>
          <h2 className="text-lg font-semibold">Add Payment</h2>
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
                      if (baoPlayer === i) setBaoPlayer(null);
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
                      ["zimo",    "🤲 Zimo (自摸)",       "Each pays base + half"],
                      ["discard", "🎴 Discard (放炮)",
                        config.paymentMode === "split"
                          ? "Shooter base+half, others base"
                          : "Shooter pays all"],
                    ] as const
                  ).map(([t, label, sub]) => (
                    <button
                      key={t}
                      onClick={() => {
                        setWinType(t);
                        if (t === "zimo") { setDiscarder(null); setBaoEnabled(false); setBaoPlayer(null); }
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

            {/* Bao toggle */}
            {winner !== null && winType === "discard" && discarder !== null && (
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{"包"} Bao (responsible player)</p>
                    <p className="text-xs text-slate-500">One player pays full total for all</p>
                  </div>
                  <button
                    onClick={() => {
                      setBaoEnabled(!baoEnabled);
                      if (baoEnabled) setBaoPlayer(null);
                      else setBaoPlayer(discarder); // default to discarder
                    }}
                    className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 flex items-center px-0.5 ${
                      baoEnabled ? "bg-emerald-600" : "bg-slate-700"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full bg-white transition-all ${
                        baoEnabled ? "ml-auto" : "ml-0"
                      }`}
                    />
                  </button>
                </div>
                {baoEnabled && (
                  <div className="mt-3">
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
                      Who is responsible?
                    </p>
                    <div className="flex gap-2">
                      {players.map((p, i) => (
                        <PlayerBtn
                          key={i}
                          player={p.name}
                          balance={p.balance}
                          pv={pv}
                          mult={config.multiplier}
                          selected={baoPlayer === i}
                          disabled={i === winner}
                          onClick={() => setBaoPlayer(i)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tai count */}
            {winner !== null && winType !== null && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                  Tai ({"台数"})
                </p>
                <p className="text-xs text-slate-600 mb-3">
                  Cap: {config.fanCap}tai = base {fanBase(config.fanCap, config.fanCap)} + half {fanHalf(config.fanCap, config.fanCap)}
                </p>
                <FanPicker value={fan} onChange={setFan} cap={config.fanCap} />
                {base !== null && half !== null && (
                  <p className="text-xs text-slate-500 mt-2">
                    {fan}tai {"→"} base {base} + half {half}
                    {baoEnabled
                      ? ` · bao pays ${3 * (base + half)}pts total`
                      : winType === "zimo"
                      ? ` · each pays ${base + half}pts (${fmtAmt((base + half) * pv * config.multiplier)})`
                      : config.paymentMode === "split"
                      ? ` · shooter −${base + half}pts, others −${base}pts`
                      : ` · shooter pays ${3 * base + half}pts total`}
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

        {/* ── Bonus tab ────────────────────────────────────────────────────── */}
        {addTab === "bonus" && (
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
              <div className="flex gap-2 flex-wrap mb-3">
                {MINI_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const active = miniReason === preset.label;
                      setMiniReason(active ? "" : preset.label);
                      if (!active) {
                        setMiniPts(preset.pts);
                        if (preset.from === "all") setMiniFrom("all");
                        else setMiniFrom(null); // user must pick payer
                      }
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                      miniReason === preset.label
                        ? "border-emerald-500 bg-emerald-950 text-white"
                        : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
                    }`}
                  >
                    {preset.label} {"·"} {preset.pts}pt
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

            {/* Bonus preview */}
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

        {/* ── Special tab ──────────────────────────────────────────────────── */}
        {addTab === "other" && (
          <div className="space-y-6">
            {/* Draw */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{"荒庄"} Draw</p>
                  <p className="text-xs text-slate-500">No winner, dealer rotates</p>
                </div>
                <button
                  onClick={() => { if (window.confirm("Record a draw?")) submitDraw(); }}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  Record Draw
                </button>
              </div>
            </div>

            {/* Seven / Eight Flowers */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-medium mb-1">{"八花"} 8 Flowers</p>
              <p className="text-xs text-slate-500 mb-3">Instant win — all others pay (like zimo)</p>
              <div className="mb-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Who?</p>
                <div className="flex gap-2">
                  {players.map((p, i) => (
                    <PlayerBtn
                      key={i}
                      player={p.name}
                      balance={p.balance}
                      pv={pv}
                      mult={config.multiplier}
                      selected={flowerPlayer === i}
                      onClick={() => setFlowerPlayer(i)}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={() => submitFlowerWin()}
                disabled={flowerPlayer === null}
                className="w-full bg-amber-700 hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {"八花"} 8 Flowers ({Math.min(config.eightFlowerTai, config.fanCap)}tai)
              </button>
              {flowerPlayer !== null && (
                <p className="text-xs text-slate-500 mt-2">
                  Each pays {fanBase(config.eightFlowerTai, config.fanCap) + fanHalf(config.eightFlowerTai, config.fanCap)}pts
                </p>
              )}
            </div>

            {/* False Win */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-medium mb-1">{"诈胡"} False Win</p>
              <p className="text-xs text-slate-500 mb-3">Offender pays {config.falseWinPenalty}pts to each other player</p>
              <div className="mb-3">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Who declared falsely?</p>
                <div className="flex gap-2">
                  {players.map((p, i) => (
                    <PlayerBtn
                      key={i}
                      player={p.name}
                      balance={p.balance}
                      pv={pv}
                      mult={config.multiplier}
                      selected={falseWinPlayer === i}
                      onClick={() => setFalseWinPlayer(i)}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={submitFalseWin}
                disabled={falseWinPlayer === null}
                className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Confirm False Win ({falseWinPlayer !== null ? `−${config.falseWinPenalty * 3}pts` : "..."})
              </button>
            </div>
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
        <div className="flex items-center justify-between mb-6 pt-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setScreen("game")}
              className="text-slate-400 hover:text-white text-xl leading-none"
            >
              {"←"}
            </button>
            <h2 className="text-lg font-semibold">Settle Up</h2>
          </div>
          <button
            onClick={shareSettlement}
            className="text-xs text-slate-400 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500 px-3 py-1.5 rounded-lg transition-colors"
          >
            Share
          </button>
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
          Final Balances
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6">
          {GRID_ORDER.map((i) => {
            const p = players[i];
            return (
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
            );
          })}
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-wide mb-3">
          Transactions
        </p>
        {txns.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
            <p className="text-2xl mb-2">{"✅"}</p>
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
              setDealer(0);
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
