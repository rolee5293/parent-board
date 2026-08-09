/**
 * 家长端测试夹具：接管 Supabase，用可控数据驱动看板。
 * 家长端只读，但仍必须拦截——直连线上会让断言随孩子的真实进度漂移，用例无法复现。
 */
import { test as base, type Page } from "@playwright/test";

const SUPA = /\/rest\/v1\/progress/;

export interface Row {
  app: string;
  data: unknown;
  updated_at: string;
}

export class BoardStub {
  rows: Row[] = [];
  offline = false;

  async install(page: Page) {
    await page.route(SUPA, (route) => {
      if (this.offline) return route.abort("failed");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(this.rows),
      });
    });
  }
}

/** 一份学习端存档；参数只暴露看板真正用到的字段 */
export function save(opts: {
  xp?: number;
  wordCursor?: number;
  badges?: string[];
  readingsDone?: number;
  masteredCount?: number;
  quizQuestions?: number;
  quizCorrect?: number;
  perfectDays?: number;
  daily?: Record<string, unknown>;
} = {}) {
  return {
    version: 1,
    xp: opts.xp ?? 0,
    wordCursor: opts.wordCursor ?? 0,
    badges: opts.badges ?? [],
    daily: opts.daily ?? {},
    stats: {
      masteredCount: opts.masteredCount ?? 0,
      quizQuestions: opts.quizQuestions ?? 0,
      quizCorrect: opts.quizCorrect ?? 0,
      readingsDone: opts.readingsDone ?? 0,
      perfectDays: opts.perfectDays ?? 0,
    },
  };
}

/** 全清的一天，用于验证连续打卡与柱状图 */
export function allDoneDay() {
  return {
    xp: 80,
    newTask: { done: true },
    reviewTask: { done: true },
    quizTask: { done: true },
    readingTask: { done: true },
  };
}

/** 相对今天的日期字符串 */
export function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isoAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export const test = base.extend<{ board: BoardStub }>({
  board: async ({ page }, use) => {
    const stub = new BoardStub();
    await stub.install(page);
    await use(stub);
  },
});

export { expect } from "@playwright/test";
