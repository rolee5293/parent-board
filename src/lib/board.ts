/**
 * 家长看板数据层：直读 Supabase progress 表（REST，无 SDK），
 * 从两个应用上传的完整存档 JSON 中计算汇总指标。
 * 存档结构计算逻辑复制自两个学习应用（streak / 段位 / 当日完成判定）。
 */

const SUPA_URL = "https://rzpdymowshzgnmckzebi.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6cGR5bW93c2h6Z25tY2t6ZWJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3ODE1MzEsImV4cCI6MjEwMDM1NzUzMX0.b7l91Tj-zdF5PVT6tMnfFHemsLBYpvzE7UpPy4dgfE8";

export interface ProgressRow {
  app: string;
  data: RawSave;
  updated_at: string;
}

/** 网络失败返回 null；无数据返回 [] */
export async function fetchProgress(): Promise<ProgressRow[] | null> {
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/progress?select=app,data,updated_at`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return (await res.json()) as ProgressRow[];
  } catch {
    return null;
  }
}

/* ================= 存档结构（宽松类型，防御性读取） ================= */

interface DayRecordRaw {
  xp?: number;
  newTask?: { done?: boolean; known?: number };
  reviewTask?: { done?: boolean; known?: number };
  quizTask?: { done?: boolean };
  readingTask?: { done?: boolean };
}

interface RawSave {
  version?: number;
  xpRate?: number;
  xp?: number;
  wordCursor?: number;
  badges?: string[];
  daily?: Record<string, DayRecordRaw>;
  stats?: {
    masteredCount?: number;
    quizQuestions?: number;
    quizCorrect?: number;
    perfectQuizzes?: number;
    readingsDone?: number;
    readingsPerfect?: number;
    bestCombo?: number;
    perfectDays?: number;
  };
}

/* ================= 多设备合并 ================= */

/**
 * 云端每台设备独占一行，app 形如 "raz#<设备ID>"；迁移前的历史行是无后缀的 "raz"。
 * 家长端必须把同一应用的所有行合并后再统计，否则只会看到某一台设备的进度。
 *
 * 合并准则与学习端一致：累计量取 max（单台设备内单调递增，取 max 不会重复计数），
 * 完成标记取或，集合取并。
 */
function baseApp(app: string): string {
  const i = app.indexOf("#");
  return i === -1 ? app : app.slice(0, i);
}

const biggest = (a = 0, b = 0) => (a > b ? a : b);

function mergeDayRaw(a: DayRecordRaw, b: DayRecordRaw): DayRecordRaw {
  // known 必须一起带上：补差要按每天真实答对的词数重算，丢了就全按 0 算
  const done = (x?: { done?: boolean; known?: number }, y?: { done?: boolean; known?: number }) => ({
    done: !!x?.done || !!y?.done,
    known: biggest(x?.known, y?.known),
  });
  return {
    xp: biggest(a.xp, b.xp),
    newTask: done(a.newTask, b.newTask),
    reviewTask: done(a.reviewTask, b.reviewTask),
    quizTask: done(a.quizTask, b.quizTask),
    readingTask: done(a.readingTask, b.readingTask),
  };
}

function mergeSaveRaw(a: RawSave, b: RawSave): RawSave {
  const daily: Record<string, DayRecordRaw> = { ...(a.daily ?? {}) };
  for (const [d, rec] of Object.entries(b.daily ?? {})) {
    const cur = daily[d];
    daily[d] = cur ? mergeDayRaw(cur, rec) : rec;
  }
  return {
    version: 1,
    // 这个对象是重建的，漏一个字段就等于把它抹掉
    xpRate: biggest(a.xpRate, b.xpRate),
    xp: biggest(a.xp, b.xp),
    wordCursor: biggest(a.wordCursor, b.wordCursor),
    badges: Array.from(new Set([...(a.badges ?? []), ...(b.badges ?? [])])),
    daily,
    stats: {
      masteredCount: biggest(a.stats?.masteredCount, b.stats?.masteredCount),
      quizQuestions: biggest(a.stats?.quizQuestions, b.stats?.quizQuestions),
      quizCorrect: biggest(a.stats?.quizCorrect, b.stats?.quizCorrect),
      perfectQuizzes: biggest(a.stats?.perfectQuizzes, b.stats?.perfectQuizzes),
      readingsDone: biggest(a.stats?.readingsDone, b.stats?.readingsDone),
      readingsPerfect: biggest(a.stats?.readingsPerfect, b.stats?.readingsPerfect),
      bestCombo: biggest(a.stats?.bestCombo, b.stats?.bestCombo),
      perfectDays: biggest(a.stats?.perfectDays, b.stats?.perfectDays),
    },
  };
}

/** 按应用归并多设备行；updated_at 取该应用各行的最大值（历史行时间戳很旧，取错会误报未同步） */
/**
 * 逐行补差后再合并——顺序不能反。
 * 应用侧是每台设备各自补差、上传后取 max；看板若先合并再补差，
 * 合并存档里的每日 known 与 stats 来自不同设备，反推出的阅读答对数会偏，
 * 算出来的总分跟孩子手机上看到的对不上（实测差 160 分）。
 */
function migrateRow(row: ProgressRow, app: "ielts" | "raz"): ProgressRow {
  const data = row.data ?? {};
  if ((data.xpRate ?? 1) >= 2) return row;
  return { ...row, data: { ...data, xp: migratedXp(app, data), xpRate: 2 } };
}

export function mergeRowsByApp(rows: ProgressRow[]): ProgressRow[] {
  const byApp = new Map<string, ProgressRow>();
  for (const raw of rows) {
    const app = baseApp(raw.app);
    if (app !== "raz" && app !== "ielts") continue; // 忽略历史测试行
    const row = migrateRow(raw, app);
    const cur = byApp.get(app);
    if (!cur) {
      byApp.set(app, { ...row, app });
      continue;
    }
    byApp.set(app, {
      app,
      data: mergeSaveRaw(cur.data ?? {}, row.data ?? {}),
      updated_at: row.updated_at > cur.updated_at ? row.updated_at : cur.updated_at,
    });
  }
  return [...byApp.values()];
}

/* ================= 日期工具 ================= */

function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

/* ================= 段位（与两个应用同表） ================= */

const TIERS: Array<{ cn: string; color: string }> = [
  { cn: "黑铁", color: "#5A6068" },
  { cn: "青铜", color: "#A97C50" },
  { cn: "白银", color: "#C4CDD4" },
  { cn: "黄金", color: "#FFC24B" },
  { cn: "铂金", color: "#3DDBD9" },
  { cn: "钻石", color: "#C38BF5" },
  { cn: "超凡", color: "#6FD66F" },
  { cn: "神话", color: "#E5484D" },
  { cn: "辐能战魂", color: "#FFF3B0" },
];
const ROMAN = ["I", "II", "III"];

/** 段位满级线（RADIANT III）。两个应用 2026-08-18 起统一为 200 + i*80 */
export const MAX_RANK_XP = 31200;

function rankFor(xp: number): { name: string; color: string } {
  let idx = 0;
  let c = 0;
  for (let i = 0; i < 27; i++) {
    if (xp >= c) idx = i;
    c += 200 + i * 80;
  }
  const t = TIERS[Math.floor(idx / 3)];
  return { name: `${t.cn} ${ROMAN[idx % 3]}`, color: t.color };
}

/* ================= XP 补差（与两个应用同一套公式） ================= */

/**
 * 看板直读 Supabase，而云端的行要等孩子在自己设备上打开应用才会写成新费率。
 * 这中间的窗口期里，若看板不做同样的换算，屏幕上会是旧分数，
 * 跟孩子手机上看到的对不上——那正是这次要解决的问题本身。
 * 只读复算，不写回云端。
 */
const LEGACY_RATE = {
  raz: { w: 1, wb: 5, q: 8, qp: 10, r: 5, rb: 10, rp: 5, b: 20 },
  ielts: { w: 2, wb: 10, q: 10, qp: 50, r: 10, rb: 30, rp: 30, b: 50 },
} as const;
const RATE = LEGACY_RATE.ielts; // 统一后的费率就是原 ielts 那套

function migratedXp(app: "ielts" | "raz", save: RawSave): number {
  const xp = save.xp ?? 0;
  if ((save.xpRate ?? 1) >= 2) return xp;
  const L = LEGACY_RATE[app];
  const st = save.stats ?? {};
  let known = 0;
  let tasks = 0;
  for (const rec of Object.values(save.daily ?? {})) {
    for (const t of [rec.newTask, rec.reviewTask]) {
      if (t?.done) {
        tasks++;
        known += t.known ?? 0;
      }
    }
  }
  const qc = st.quizCorrect ?? 0;
  const pq = st.perfectQuizzes ?? 0;
  const pd = st.perfectDays ?? 0;
  const rd = st.readingsDone ?? 0;
  const rp = st.readingsPerfect ?? 0;
  const readingCorrect = Math.round(
    (xp - (known * L.w + tasks * L.wb + qc * L.q + pq * L.qp + pd * L.b) - rd * L.rb - rp * L.rp) / L.r,
  );
  if (!Number.isFinite(readingCorrect) || readingCorrect < 0) return xp;
  const recomputed =
    known * RATE.w + tasks * RATE.wb + qc * RATE.q + pq * RATE.qp +
    readingCorrect * RATE.r + rd * RATE.rb + rp * RATE.rp + pd * RATE.b;
  return Math.max(xp, recomputed);
}

/* ================= 巅峰层（与两个应用同表） ================= */

const PEAK_XP = [31200, 33560, 36000, 38520, 41120, 43800, 46560, 49400, 52320, 55320];
const PEAK_NAMES = ["觉醒", "精准", "铁律", "洞察", "锋刃", "熔炼", "无瑕", "恒久", "通读", "传说"];

/** 每级的挑战：目标值按应用不同（弟弟的测验只有 5 题，词库也小得多） */
function peakGoals(app: "ielts" | "raz") {
  const combo = app === "raz" ? 5 : 10;
  const mid = app === "raz" ? 150 : 300;
  const top = app === "raz" ? 400 : 1000;
  return [
    { text: "累计 15 个完美行动日", key: "perfectDays" as const, need: 15 },
    { text: "累计 20 次测验满分", key: "perfectQuizzes" as const, need: 20 },
    { text: "连续打卡 10 天", key: "maxStreak" as const, need: 10 },
    { text: "阅读全对累计 40 篇", key: "readingsPerfect" as const, need: 40 },
    { text: `单次测验打出 ${combo} 连击`, key: "bestCombo" as const, need: combo },
    { text: `掌握 ${mid} 个单词`, key: "masteredCount" as const, need: mid },
    { text: "累计 40 个完美行动日", key: "perfectDays" as const, need: 40 },
    { text: "连续打卡 45 天", key: "maxStreak" as const, need: 45 },
    { text: "阅读全对累计 100 篇", key: "readingsPerfect" as const, need: 100 },
    { text: `掌握 ${top} 个单词`, key: "masteredCount" as const, need: top },
  ];
}

export interface PeakInfo {
  level: number;
  /** 当前巅峰等级的中文名，未入巅峰为 null */
  name: string | null;
  next: { level: number; name: string; challenge: string; cur: number; need: number; xpGap: number } | null;
}

function peakInfo(app: "ielts" | "raz", xp: number, m: Record<string, number>): PeakInfo {
  const goals = peakGoals(app);
  let level = 0;
  for (let i = 0; i < goals.length; i++) {
    if (xp < PEAK_XP[i] || (m[goals[i].key] ?? 0) < goals[i].need) break;
    level = i + 1;
  }
  const g = goals[level];
  return {
    level,
    name: level > 0 ? PEAK_NAMES[level - 1] : null,
    next: g
      ? {
          level: level + 1,
          name: PEAK_NAMES[level],
          challenge: g.text,
          cur: m[g.key] ?? 0,
          need: g.need,
          xpGap: Math.max(0, PEAK_XP[level] - xp),
        }
      : null,
  };
}

/* ================= 汇总计算 ================= */

export interface DayBar {
  d: string; // MM-DD
  xp: number;
  done: boolean;
}

export interface KidSummary {
  app: "ielts" | "raz";
  kid: string;
  appName: string;
  updatedAt: string;
  xp: number;
  rankName: string;
  rankColor: string;
  streak: number;
  wordsLearned: number;
  wordsMastered: number;
  totalWords: number;
  quizCorrect: number;
  quizTotal: number;
  readingsDone: number;
  /** 已覆盖的不同篇目数（readingsDone 会循环累计，故与总篇数取小） */
  readingsDistinct: number;
  totalReadings: number;
  badges: number;
  perfectDays: number;
  maxStreak: number;
  peak: number;
  peakName: string | null;
  nextPeak: PeakInfo["next"];
  days: DayBar[];
}

const META = {
  ielts: { kid: "哥哥", appName: "IELTS PROTOCOL", emoji: "🎖️", totalWords: 3601, totalReadings: 16 },
  raz: { kid: "弟弟", appName: "RAZ MOVERS", emoji: "🚀", totalWords: 556, totalReadings: 41 },
} as const;

function isDayAllDone(rec: DayRecordRaw | undefined): boolean {
  if (!rec) return false;
  return !!(
    rec.newTask?.done &&
    rec.reviewTask?.done &&
    rec.quizTask?.done &&
    rec.readingTask?.done
  );
}

export function summarize(row: ProgressRow): KidSummary {
  const app = (row.app === "raz" ? "raz" : "ielts") as "ielts" | "raz";
  const meta = META[app];
  const save = row.data ?? {};
  const daily = save.daily ?? {};
  const stats = save.stats ?? {};
  const xp = migratedXp(app, save); // 行已补过差时这里是 no-op
  const rank = rankFor(xp);

  // 当前 streak：从今天（或昨天）往回数全清日
  const today = todayStr();
  let streak = 0;
  let cursor = isDayAllDone(daily[today]) ? today : addDaysStr(today, -1);
  while (isDayAllDone(daily[cursor])) {
    streak++;
    cursor = addDaysStr(cursor, -1);
  }

  // 最长连续全清（巅峰挑战要用；当前 streak 断了就归零，判不出历史最好成绩）
  let maxStreak = 0;
  let run = 0;
  for (const d of Object.keys(daily).sort()) {
    if (isDayAllDone(daily[d])) {
      run = run === 0 ? 1 : addDaysStr(d, -1) in daily && isDayAllDone(daily[addDaysStr(d, -1)]) ? run + 1 : 1;
      maxStreak = Math.max(maxStreak, run);
    } else {
      run = 0;
    }
  }

  const peak = peakInfo(app, xp, {
    perfectDays: stats.perfectDays ?? 0,
    perfectQuizzes: stats.perfectQuizzes ?? 0,
    maxStreak,
    readingsPerfect: stats.readingsPerfect ?? 0,
    bestCombo: stats.bestCombo ?? 0,
    masteredCount: stats.masteredCount ?? 0,
  });

  // 最近 14 天
  const days: DayBar[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDaysStr(today, -i);
    const rec = daily[date];
    days.push({ d: date.slice(5), xp: rec?.xp ?? 0, done: isDayAllDone(rec) });
  }

  return {
    app,
    kid: meta.kid,
    appName: meta.appName,
    updatedAt: row.updated_at,
    xp,
    rankName: rank.name,
    rankColor: rank.color,
    streak,
    wordsLearned: save.wordCursor ?? 0,
    wordsMastered: stats.masteredCount ?? 0,
    totalWords: meta.totalWords,
    quizCorrect: stats.quizCorrect ?? 0,
    quizTotal: stats.quizQuestions ?? 0,
    readingsDone: stats.readingsDone ?? 0,
    // readingsDone 是累计完成次数：阅读页按 readingsDone % 篇数 顺序循环取篇目，
    // 读完一轮会从头再来，所以它会远超总篇数（线上已到 457/41）。
    // 覆盖到的不同篇目数就是二者取小。
    readingsDistinct: Math.min(stats.readingsDone ?? 0, meta.totalReadings),
    totalReadings: meta.totalReadings,
    badges: save.badges?.length ?? 0,
    perfectDays: stats.perfectDays ?? 0,
    maxStreak,
    peak: peak.level,
    peakName: peak.name,
    nextPeak: peak.next,
    days,
  };
}

/* ================= 家庭合体目标 ================= */

/**
 * 两人 XP 合并冲一个共同目标。
 * 直接排名会天天把三年级的弟弟摆上台跟哥哥比大小，这条是解药：
 * 兄弟俩的分在这里是相加的，谁多打一点都算全家的。
 */
const FAMILY_MILESTONES = [
  { at: 50000, name: "小队 // SQUAD" },
  { at: 100000, name: "中队 // FLIGHT" },
  { at: 200000, name: "大队 // BATTALION" },
  { at: 350000, name: "军团 // LEGION" },
  { at: 500000, name: "传奇军团 // MYTHIC" },
];

export interface FamilyGoal {
  total: number;
  reached: string | null;
  nextName: string | null;
  nextAt: number | null;
  pct: number;
}

export function familyGoal(kids: KidSummary[]): FamilyGoal {
  const total = kids.reduce((a, k) => a + k.xp, 0);
  const passed = FAMILY_MILESTONES.filter((m) => total >= m.at);
  const next = FAMILY_MILESTONES.find((m) => total < m.at) ?? null;
  const from = passed.length ? passed[passed.length - 1].at : 0;
  return {
    total,
    reached: passed.length ? passed[passed.length - 1].name : null,
    nextName: next?.name ?? null,
    nextAt: next?.at ?? null,
    pct: next ? Math.min(100, Math.round(((total - from) / (next.at - from)) * 100)) : 100,
  };
}

/* ================= 时间显示 ================= */

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

export function isStale(iso: string, now = Date.now()): boolean {
  return now - new Date(iso).getTime() > 3 * 24 * 3600 * 1000;
}
