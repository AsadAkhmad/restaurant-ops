"use client";

import React, { useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell
} from "recharts";
import {
  ChefHat, Users, Wine, Footprints, Calendar, CloudSun, CloudRain, Cloud,
  TrendingUp, TrendingDown, Minus, ArrowRight, ArrowLeft, Sparkles,
  Clock, Gauge, Receipt, UtensilsCrossed
} from "lucide-react";

/* ---------------------------------------------------------
   DESIGN TOKENS
   Palette: kitchen-line dark — char/slate surfaces, heat-lamp
   amber as the working accent, herb-teal as the secondary,
   ticket-paper ivory for printed data.
--------------------------------------------------------- */
const COLORS = {
  bg: "#161514",
  surface: "#1F1D1B",
  surface2: "#28251F",
  line: "#38342C",
  amber: "#E8A33D",
  amberDim: "#8C6526",
  teal: "#4FB3A0",
  ivory: "#F3EEE2",
  muted: "#9A9border" // placeholder unused
};

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');`;

const STAFF_POOL = ["Asad", "Sam", "John", "Maria", "David", "Sarah", "Liam", "Priya", "Noah", "Akhmad"];

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEATHERS = ["Sunny", "Rainy", "Cloudy"];
const EVENTS = ["None", "Medium", "High"];

const STEPS = [
  { id: 0, label: "Input", eyebrow: "01" },
  { id: 1, label: "Forecast", eyebrow: "02" },
  { id: 2, label: "Staffing", eyebrow: "03" },
  { id: 3, label: "Rota", eyebrow: "04" },
];

/* ---------------------------------------------------------
   RULE-BASED FORECAST ENGINE (simulated, not ML)
--------------------------------------------------------- */
function runForecast(input) {
  const { day, weather, bookings, event, avgSpend } = input;
  const spend = avgSpend && Number(avgSpend) > 0 ? Number(avgSpend) : 28;

  let dayMult = 1.0;
  if (["Friday", "Saturday"].includes(day)) dayMult = 1.35;
  else if (day === "Sunday") dayMult = 1.15;
  else if (day === "Monday") dayMult = 0.8;
  else dayMult = 0.95;

  let weatherMult = 1.0;
  let weatherNote = { text: "Cloudy skies — neutral effect on walk-ins", sign: 0 };
  if (weather === "Sunny") { weatherMult = 1.12; weatherNote = { text: "Sunny weather increases walk-in traffic", sign: 1 }; }
  if (weather === "Rainy") { weatherMult = 0.82; weatherNote = { text: "Rain suppresses walk-ins and delays covers", sign: -1 }; }

  let eventMult = 1.0;
  let eventNote = { text: "No local events — baseline demand only", sign: 0 };
  if (event === "Medium") { eventMult = 1.15; eventNote = { text: "Medium local event lifts evening footfall", sign: 1 }; }
  if (event === "High") { eventMult = 1.32; eventNote = { text: "High-intensity local event boosts evening peak sharply", sign: 1 }; }

  const bookingsNum = Number(bookings) || 0;
  const baseFromBookings = bookingsNum * 2.1; // avg party size ~2.1
  const baseline = 60 + baseFromBookings;

  const likely = Math.round(baseline * dayMult * weatherMult * eventMult);
  const min = Math.round(likely * 0.82);
  const max = Math.round(likely * 1.22);

  // walk-in % — higher with good weather/events, lower with heavy pre-bookings
  let walkIn = 30 + (weather === "Sunny" ? 8 : weather === "Rainy" ? -10 : 0) + (event !== "None" ? 6 : 0);
  walkIn -= Math.min(15, Math.round(bookingsNum / 6));
  walkIn = Math.max(8, Math.min(65, Math.round(walkIn)));

  const revenue = Math.round(likely * spend);

  let confidence = 74;
  confidence += bookingsNum > 20 ? 8 : bookingsNum > 8 ? 4 : -4;
  confidence += weather !== "Cloudy" ? 3 : 0;
  confidence += event === "None" ? 4 : -2;
  confidence = Math.max(58, Math.min(96, confidence));

  // hourly curve, 11:00–23:00, lunch + dinner bumps
  const hours = ["11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];
  const lunchPeakIdx = 2; // 13:00
  const dinnerPeakIdx = event === "High" ? 9 : 8; // 20:00 or 19:00, pushed later with big events
  const shape = hours.map((h, i) => {
    const lunch = Math.exp(-Math.pow(i - lunchPeakIdx, 2) / 4) * 0.55;
    const dinner = Math.exp(-Math.pow(i - dinnerPeakIdx, 2) / 6) * 1.0;
    return lunch + dinner;
  });
  const shapeSum = shape.reduce((a, b) => a + b, 0);
  const hourly = shape.map((s, i) => ({
    hour: `${h(hours[i])}`,
    customers: Math.max(2, Math.round((s / shapeSum) * likely)),
  }));

  const peakHour = hourly.reduce((a, b) => (b.customers > a.customers ? b : a), hourly[0]);

  function h(v) {
    const n = Number(v);
    return n <= 12 ? `${n === 0 ? 12 : n}${n < 12 ? "am" : "pm"}` : `${n - 12}pm`;
  }

  const factors = [
    { text: `${day} ${dayMult >= 1.2 ? "significantly increases" : dayMult >= 1 ? "modestly lifts" : "reduces"} baseline demand`, sign: dayMult > 1.05 ? 1 : dayMult < 0.95 ? -1 : 0 },
    weatherNote,
    eventNote,
    { text: bookingsNum > 15 ? "Strong advance bookings raise the demand floor" : bookingsNum > 0 ? "Light advance bookings — walk-ins carry more weight" : "No advance bookings recorded — forecast leans on baseline patterns", sign: bookingsNum > 15 ? 1 : 0 },
    { text: "No active discount campaign — baseline held, not boosted", sign: -1 },
  ];

  return { min, likely, max, walkIn, revenue, confidence, hourly, peakHour, factors, spend };
}

/* ---------------------------------------------------------
   STAFFING RULE ENGINE
--------------------------------------------------------- */
function runStaffing(forecast) {
  const peak = forecast.peakHour.customers * 4; // concurrent → approx covers across peak window
  const likely = forecast.likely;

  const servers = Math.max(2, Math.ceil(likely / 18));
  const chefs = Math.max(2, Math.ceil(likely / 40));
  const bartenders = Math.max(1, Math.ceil(likely / 60));
  const hosts = Math.max(1, Math.ceil(likely / 80));

  return { servers, chefs, bartenders, hosts, total: servers + chefs + bartenders + hosts };
}

/* ---------------------------------------------------------
   ROTA GENERATOR
--------------------------------------------------------- */
function runRota(staffing) {
  const shifts = [
    { name: "Morning", time: "08:00 – 14:00" },
    { name: "Mid", time: "11:00 – 17:00" },
    { name: "Evening", time: "16:00 – 22:00" },
    { name: "Close", time: "19:00 – 01:00" },
  ];
  const roles = [
    { key: "chefs", label: "Chef", count: staffing.chefs, icon: "chef" },
    { key: "servers", label: "Server", count: staffing.servers, icon: "server" },
    { key: "bartenders", label: "Bartender", count: staffing.bartenders, icon: "bar" },
    { key: "hosts", label: "Host/Runner", count: staffing.hosts, icon: "host" },
  ];

  let poolIdx = 0;
  const nextStaff = () => STAFF_POOL[poolIdx++ % STAFF_POOL.length];

  // distribute each role's headcount across shifts, weighted toward mid/evening
  const weights = [0.2, 0.3, 0.35, 0.15];
  const rows = [];
  roles.forEach((role) => {
    let remaining = role.count;
    const alloc = weights.map((w, i) => {
      if (i === weights.length - 1) return remaining; // last shift takes the rest
      const c = Math.max(role.count >= 3 ? 1 : 0, Math.round(role.count * w));
      remaining -= c;
      return c;
    });
    alloc[alloc.length - 1] = Math.max(0, alloc[alloc.length - 1]);
    // ensure total matches role.count, trim/add on first shift if needed
    let sum = alloc.reduce((a, b) => a + b, 0);
    alloc[0] += role.count - sum;
    if (alloc[0] < 0) alloc[0] = 0;

    shifts.forEach((shift, i) => {
      const cnt = Math.max(0, alloc[i]);
      for (let n = 0; n < cnt; n++) {
        rows.push({ shift: shift.name, time: shift.time, role: role.label, name: nextStaff() });
      }
    });
  });

  return { shifts, rows };
}

/* ---------------------------------------------------------
   SMALL UI PRIMITIVES
--------------------------------------------------------- */
function TicketCard({ children, className = "" }) {
  return (
    <div
      className={`relative rounded-lg border ${className}`}
      style={{ background: COLORS.surface, borderColor: COLORS.line }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <div
      className="text-xs tracking-[0.2em] uppercase mb-2"
      style={{ color: COLORS.amber, fontFamily: "'JetBrains Mono', monospace" }}
    >
      {children}
    </div>
  );
}

function StatBlock({ label, value, sub, accent }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider" style={{ color: "#8E887A", fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
      <span
        className="text-3xl md:text-4xl font-semibold"
        style={{ color: accent || COLORS.ivory, fontFamily: "'Oswald', sans-serif" }}
      >
        {value}
      </span>
      {sub && <span className="text-xs" style={{ color: "#6F6A5E" }}>{sub}</span>}
    </div>
  );
}

function SignBadge({ sign }) {
  if (sign > 0) return <TrendingUp size={16} color={COLORS.teal} />;
  if (sign < 0) return <TrendingDown size={16} color="#D9634B" />;
  return <Minus size={16} color="#8E887A" />;
}

/* ---------------------------------------------------------
   MAIN APP
--------------------------------------------------------- */
export default function App() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    day: "Friday",
    weather: "Sunny",
    bookings: 24,
    event: "Medium",
    avgSpend: 32,
  });
  const [result, setResult] = useState(null);

  const forecast = useMemo(() => (result ? runForecast(result) : null), [result]);
  const staffing = useMemo(() => (forecast ? runStaffing(forecast) : null), [forecast]);
  const rota = useMemo(() => (staffing ? runRota(staffing) : null), [staffing]);

  function handleGenerate() {
    setResult({ ...form });
    setStep(1);
  }

  const weatherIcon = form.weather === "Sunny" ? <CloudSun size={16} /> : form.weather === "Rainy" ? <CloudRain size={16} /> : <Cloud size={16} />;

  return (
    <div style={{ background: COLORS.bg, minHeight: "100%", fontFamily: "'Inter', sans-serif" }} className="w-full min-h-screen">
      <style>{`
        ${FONT_IMPORT}
        .mono { font-family: 'JetBrains Mono', monospace; }
        .display { font-family: 'Oswald', sans-serif; }
        .ticket-edge {
          background-image: radial-gradient(circle at 8px 8px, ${COLORS.bg} 4px, transparent 4.5px);
          background-size: 16px 16px;
          background-position: -8px -8px;
        }
      `}</style>

      {/* HEADER */}
      <header className="border-b" style={{ borderColor: COLORS.line }}>
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-md flex items-center justify-center"
              style={{ background: COLORS.amber }}
            >
              <UtensilsCrossed size={18} color={COLORS.bg} />
            </div>
            <div>
              <div className="display text-lg tracking-wide" style={{ color: COLORS.ivory }}>THE PASS</div>
              <div className="text-[11px] mono tracking-widest uppercase" style={{ color: "#8E887A" }}>AI Restaurant Operations Assistant</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs mono px-3 py-1.5 rounded-full border" style={{ borderColor: COLORS.line, color: COLORS.teal }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.teal }} />
            SIMULATED DATA · DEMO MODE
          </div>
        </div>

        {/* STEP NAV */}
        <div className="max-w-6xl mx-auto px-5 md:px-8 pb-4 flex gap-2 overflow-x-auto">
          {STEPS.map((s) => {
            const active = step === s.id;
            const enabled = s.id === 0 || result;
            return (
              <button
                key={s.id}
                disabled={!enabled}
                onClick={() => enabled && setStep(s.id)}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors"
                style={{
                  background: active ? COLORS.amber : "transparent",
                  color: active ? COLORS.bg : enabled ? COLORS.ivory : "#544F45",
                  border: `1px solid ${active ? COLORS.amber : COLORS.line}`,
                  fontFamily: "'Oswald', sans-serif",
                }}
              >
                <span className="mono text-[11px] opacity-70">{s.eyebrow}</span>
                {s.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        {step === 0 && <InputStep form={form} setForm={setForm} onGenerate={handleGenerate} />}
        {step === 1 && forecast && <ForecastStep input={result} forecast={forecast} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && staffing && forecast && <StaffingStep staffing={staffing} forecast={forecast} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && rota && staffing && <RotaStep rota={rota} staffing={staffing} onBack={() => setStep(2)} />}
      </main>

      <footer className="max-w-6xl mx-auto px-5 md:px-8 py-8 text-xs mono" style={{ color: "#544F45" }}>
        Prototype build — forecasts generated by rule-based simulation, not live ML. Built to demonstrate product UX.
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------
   STEP 1 — INPUT DASHBOARD
--------------------------------------------------------- */
function InputStep({ form, setForm, onGenerate }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target?.value ?? e });

  return (
    <div className="grid md:grid-cols-5 gap-6">
      <div className="md:col-span-3">
        <Eyebrow>01 · Service Inputs</Eyebrow>
        <h1 className="display text-3xl md:text-4xl mb-2" style={{ color: COLORS.ivory }}>
          Set tonight's conditions
        </h1>
        <p className="text-sm mb-6" style={{ color: "#9A9488" }}>
          Enter what you know about the service ahead. The engine below turns it into a demand forecast, staffing plan, and rota.
        </p>

        <TicketCard className="p-5 md:p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Date" icon={<Calendar size={14} />}>
              <input type="date" value={form.date} onChange={set("date")} style={inputStyle} />
            </Field>
            <Field label="Day of week" icon={<Calendar size={14} />}>
              <select value={form.day} onChange={set("day")} style={inputStyle}>
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Weather">
              <select value={form.weather} onChange={set("weather")} style={inputStyle}>
                {WEATHERS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Local event intensity">
              <select value={form.event} onChange={set("event")} style={inputStyle}>
                {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Number of bookings">
              <input type="number" min="0" value={form.bookings} onChange={set("bookings")} style={inputStyle} />
            </Field>
            <Field label="Avg spend / customer ($, optional)">
              <input type="number" min="0" value={form.avgSpend} onChange={set("avgSpend")} style={inputStyle} placeholder="28" />
            </Field>
          </div>

          <div>
            <span className="text-xs uppercase tracking-wider mono" style={{ color: "#8E887A" }}>Staff availability (prefilled)</span>
            <div className="flex flex-wrap gap-2 mt-2">
              {STAFF_POOL.slice(0, 7).map((s) => (
                <span key={s} className="text-xs px-2.5 py-1 rounded-full mono" style={{ background: COLORS.surface2, color: COLORS.ivory, border: `1px solid ${COLORS.line}` }}>{s}</span>
              ))}
            </div>
          </div>

          <button
            onClick={onGenerate}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md font-semibold display text-base tracking-wide transition-transform active:scale-[0.99]"
            style={{ background: COLORS.amber, color: COLORS.bg }}
          >
            <Sparkles size={17} /> Generate Forecast
          </button>
        </TicketCard>
      </div>

      <div className="md:col-span-2">
        <Eyebrow>Preview</Eyebrow>
        <TicketCard className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="display text-lg" style={{ color: COLORS.ivory }}>Docket Preview</span>
            <Receipt size={16} color={COLORS.amber} />
          </div>
          <div className="space-y-3 mono text-sm" style={{ color: "#B8B2A4" }}>
            <Row label="Date" value={form.date} />
            <Row label="Day" value={form.day} />
            <Row label="Weather" value={form.weather} />
            <Row label="Event" value={form.event} />
            <Row label="Bookings" value={form.bookings} />
            <Row label="Avg spend" value={`$${form.avgSpend || 28}`} />
          </div>
          <div className="mt-5 pt-4 border-t text-xs" style={{ borderColor: COLORS.line, color: "#6F6A5E" }}>
            Forecast engine runs entirely client-side on rule-based logic — no external calls, instant results.
          </div>
        </TicketCard>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: "#6F6A5E" }}>{label}</span>
      <span style={{ color: COLORS.ivory }}>{value}</span>
    </div>
  );
}

function Field({ label, icon, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider mono flex items-center gap-1.5" style={{ color: "#8E887A" }}>
        {icon}{label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: COLORS.surface2,
  border: `1px solid ${COLORS.line}`,
  borderRadius: "6px",
  padding: "9px 11px",
  color: COLORS.ivory,
  fontSize: "14px",
  outline: "none",
  fontFamily: "'Inter', sans-serif",
};

/* ---------------------------------------------------------
   STEP 2 — FORECAST OUTPUT
--------------------------------------------------------- */
function ForecastStep({ input, forecast, onNext, onBack }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Eyebrow>02 · Demand Forecast</Eyebrow>
          <h1 className="display text-3xl md:text-4xl" style={{ color: COLORS.ivory }}>{input.day}, {input.date}</h1>
        </div>
        <NavButtons onBack={onBack} onNext={onNext} nextLabel="View staffing plan" />
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <TicketCard className="p-5 md:col-span-2">
          <span className="text-xs uppercase tracking-wider mono" style={{ color: "#8E887A" }}>Expected customers</span>
          <div className="flex items-end gap-4 mt-2">
            <StatBlock label="Min" value={forecast.min} />
            <StatBlock label="Most likely" value={forecast.likely} accent={COLORS.amber} />
            <StatBlock label="Max" value={forecast.max} />
          </div>
        </TicketCard>
        <TicketCard className="p-5">
          <StatBlock label="Walk-in %" value={`${forecast.walkIn}%`} sub="of total covers" />
        </TicketCard>
        <TicketCard className="p-5">
          <StatBlock label="Expected revenue" value={`$${forecast.revenue.toLocaleString()}`} sub={`@ $${forecast.spend}/head`} accent={COLORS.teal} />
        </TicketCard>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <TicketCard className="p-5 md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <span className="display text-lg" style={{ color: COLORS.ivory }}>Hourly customer curve</span>
            <span className="text-xs mono flex items-center gap-1" style={{ color: COLORS.amber }}>
              <Clock size={13} /> Peak {forecast.peakHour.hour}
            </span>
          </div>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={forecast.hourly} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillCust" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="hour" stroke="#6F6A5E" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#6F6A5E" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.line}`, borderRadius: 8, color: COLORS.ivory }} />
                <Area type="monotone" dataKey="customers" stroke={COLORS.amber} strokeWidth={2} fill="url(#fillCust)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </TicketCard>

        <TicketCard className="p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="display text-lg" style={{ color: COLORS.ivory }}>Confidence</span>
            <Gauge size={16} color={COLORS.teal} />
          </div>
          <div className="mt-3">
            <div className="text-4xl display" style={{ color: COLORS.teal }}>{forecast.confidence}%</div>
            <div className="w-full h-2 rounded-full mt-3 overflow-hidden" style={{ background: COLORS.surface2 }}>
              <div className="h-full rounded-full" style={{ width: `${forecast.confidence}%`, background: COLORS.teal }} />
            </div>
            <p className="text-xs mt-3" style={{ color: "#6F6A5E" }}>
              Based on booking volume, weather stability, and event predictability.
            </p>
          </div>
        </TicketCard>
      </div>

      <ExplanationPanel factors={forecast.factors} />
    </div>
  );
}

function ExplanationPanel({ factors }) {
  return (
    <TicketCard className="p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles size={16} color={COLORS.amber} />
        <span className="display text-lg" style={{ color: COLORS.ivory }}>Why this forecast?</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {factors.map((f, i) => (
          <div key={i} className="flex items-start gap-2.5 text-sm py-1">
            <SignBadge sign={f.sign} />
            <span style={{ color: "#C9C3B6" }}>{f.text}</span>
          </div>
        ))}
      </div>
    </TicketCard>
  );
}

/* ---------------------------------------------------------
   STEP 3 — STAFFING RECOMMENDATION
--------------------------------------------------------- */
function StaffingStep({ staffing, forecast, onNext, onBack }) {
  const cards = [
    { label: "Servers", value: staffing.servers, ratio: "1 per 18 covers", icon: <Users size={18} /> },
    { label: "Chefs", value: staffing.chefs, ratio: "1 per 40 covers", icon: <ChefHat size={18} /> },
    { label: "Bartenders", value: staffing.bartenders, ratio: "1 per 60 covers", icon: <Wine size={18} /> },
    { label: "Hosts / Runners", value: staffing.hosts, ratio: "1 per 80 covers", icon: <Footprints size={18} /> },
  ];
  const chartData = cards.map((c) => ({ name: c.label, value: c.value }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Eyebrow>03 · Staffing Recommendation</Eyebrow>
          <h1 className="display text-3xl md:text-4xl" style={{ color: COLORS.ivory }}>{staffing.total} staff recommended</h1>
        </div>
        <NavButtons onBack={onBack} onNext={onNext} nextLabel="Generate rota" />
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <TicketCard key={c.label} className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-9 h-9 rounded-md flex items-center justify-center" style={{ background: COLORS.surface2, color: COLORS.amber }}>{c.icon}</div>
            </div>
            <StatBlock label={c.label} value={c.value} sub={c.ratio} />
          </TicketCard>
        ))}
      </div>

      <TicketCard className="p-5">
        <span className="display text-lg" style={{ color: COLORS.ivory }}>Role distribution</span>
        <div style={{ width: "100%", height: 220 }} className="mt-3">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} vertical={false} />
              <XAxis dataKey="name" stroke="#6F6A5E" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#6F6A5E" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.line}`, borderRadius: 8, color: COLORS.ivory }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={[COLORS.amber, COLORS.teal, "#C97B4A", "#7A9B8E"][i % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TicketCard>

      <TicketCard className="p-5 flex items-start gap-3">
        <Gauge size={18} color={COLORS.teal} className="mt-0.5" />
        <p className="text-sm" style={{ color: "#B8B2A4" }}>
          Sized for a peak of <strong style={{ color: COLORS.ivory }}>{forecast.peakHour.customers} covers</strong> around <strong style={{ color: COLORS.ivory }}>{forecast.peakHour.hour}</strong>. Ratios pad slightly above the raw math so no station runs single-handed during the rush.
        </p>
      </TicketCard>
    </div>
  );
}

/* ---------------------------------------------------------
   STEP 4 — ROTA
--------------------------------------------------------- */
function RotaStep({ rota, staffing, onBack }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Eyebrow>04 · Auto Rota</Eyebrow>
          <h1 className="display text-3xl md:text-4xl" style={{ color: COLORS.ivory }}>Shift schedule</h1>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm mono border"
          style={{ borderColor: COLORS.line, color: COLORS.ivory }}
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {rota.shifts.map((shift) => {
          const shiftRows = rota.rows.filter((r) => r.shift === shift.name);
          return (
            <TicketCard key={shift.name} className="overflow-hidden">
              <div className="px-4 py-3 border-b" style={{ borderColor: COLORS.line, background: COLORS.surface2 }}>
                <div className="display text-base" style={{ color: COLORS.amber }}>{shift.name}</div>
                <div className="text-xs mono" style={{ color: "#8E887A" }}>{shift.time}</div>
              </div>
              <div className="p-3 space-y-2">
                {shiftRows.length === 0 && (
                  <div className="text-xs" style={{ color: "#544F45" }}>No coverage assigned</div>
                )}
                {shiftRows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-sm px-2.5 py-1.5 rounded" style={{ background: COLORS.surface2 }}>
                    <span style={{ color: COLORS.ivory }}>{r.name}</span>
                    <span className="text-xs mono" style={{ color: "#8E887A" }}>{r.role}</span>
                  </div>
                ))}
              </div>
            </TicketCard>
          );
        })}
      </div>

      <TicketCard className="p-5">
        <span className="display text-lg" style={{ color: COLORS.ivory }}>Coverage summary</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
          <Row label="Servers scheduled" value={rota.rows.filter(r => r.role === "Server").length} />
          <Row label="Chefs scheduled" value={rota.rows.filter(r => r.role === "Chef").length} />
          <Row label="Bartenders scheduled" value={rota.rows.filter(r => r.role === "Bartender").length} />
          <Row label="Hosts scheduled" value={rota.rows.filter(r => r.role === "Host/Runner").length} />
        </div>
      </TicketCard>
    </div>
  );
}

function NavButtons({ onBack, onNext, nextLabel }) {
  return (
    <div className="flex gap-2">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm mono border" style={{ borderColor: COLORS.line, color: COLORS.ivory }}>
          <ArrowLeft size={14} /> Back
        </button>
      )}
      {onNext && (
        <button onClick={onNext} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm display font-medium" style={{ background: COLORS.amber, color: COLORS.bg }}>
          {nextLabel} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
