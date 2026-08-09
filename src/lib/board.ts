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
  newTask?: { done?: boolean };
  reviewTask?: { done?: boolean };
  quizTask?: { done?: boolean };
  readingTask?: { done?: boolean };
}

interface RawSave {
  version?: number;
  xp?: number;
  wordCursor?: number;
  badges?: string[];
  daily?: Record<string, DayRecordRaw>;
  stats?: {
    masteredCount?: number;
    quizQuestions?: number;
    quizCorrect?: number;
    readingsDone?: number;
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
  const done = (x?: { done?: boolean }, y?: { done?: boolean }) => ({ done: !!x?.done || !!y?.done });
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
    xp: biggest(a.xp, b.xp),
    wordCursor: biggest(a.wordCursor, b.wordCursor),
    badges: Array.from(new Set([...(a.badges ?? []), ...(b.badges ?? [])])),
    daily,
    stats: {
      masteredCount: biggest(a.stats?.masteredCount, b.stats?.masteredCount),
      quizQuestions: biggest(a.stats?.quizQuestions, b.stats?.quizQuestions),
      quizCorrect: biggest(a.stats?.quizCorrect, b.stats?.quizCorrect),
      readingsDone: biggest(a.stats?.readingsDone, b.stats?.readingsDone),
      perfectDays: biggest(a.stats?.perfectDays, b.stats?.perfectDays),
    },
  };
}

/** 按应用归并多设备行；updated_at 取该应用各行的最大值（历史行时间戳很旧，取错会误报未同步） */
export function mergeRowsByApp(rows: ProgressRow[]): ProgressRow[] {
  const byApp = new Map<string, ProgressRow>();
  for (const row of rows) {
    const app = baseApp(row.app);
    if (app !== "raz" && app !== "ielts") continue; // 忽略历史测试行
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

function rankFor(app: string, xp: number): { name: string; color: string } {
  // ielts: 200 + i*80；raz: 60 + i*25（与各应用 game.ts 一致）
  const base = app === "raz" ? 60 : 200;
  const step = app === "raz" ? 25 : 80;
  let idx = 0;
  let c = 0;
  for (let i = 0; i < 27; i++) {
    if (xp >= c) idx = i;
    c += base + i * step;
  }
  const t = TIERS[Math.floor(idx / 3)];
  return { name: `${t.cn} ${ROMAN[idx % 3]}`, color: t.color };
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
  const xp = save.xp ?? 0;
  const rank = rankFor(app, xp);

  // 当前 streak：从今天（或昨天）往回数全清日
  const today = todayStr();
  let streak = 0;
  let cursor = isDayAllDone(daily[today]) ? today : addDaysStr(today, -1);
  while (isDayAllDone(daily[cursor])) {
    streak++;
    cursor = addDaysStr(cursor, -1);
  }

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
    days,
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
