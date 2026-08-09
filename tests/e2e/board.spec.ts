/**
 * 家长看板：多设备合并、显示口径、同步新鲜度、异常降级。
 *
 * 历史故障：卡片长期误报"已超过 3 天未同步"（时间戳字段从不更新），
 * 阅读进度显示 457/41 篇（累计次数当成篇目数），
 * 词汇进度条恒为空（拿一个前 29 天必然为 0 的指标当主进度）。
 */
import { allDoneDay, dayOffset, expect, isoAgo, save, test } from "./fixtures/board";

test.describe("家长看板", () => {
  test("按应用合并多台设备的行，累计量取最大值而不是相加", async ({ page, board }) => {
    board.rows = [
      { app: "raz#phoneA", data: save({ xp: 800, wordCursor: 110, quizQuestions: 650, quizCorrect: 520 }), updated_at: isoAgo(0) },
      { app: "raz#padB", data: save({ xp: 500, wordCursor: 60, quizQuestions: 400, quizCorrect: 300 }), updated_at: isoAgo(1) },
    ];
    await page.goto("/");

    await expect(page.getByText("800")).toBeVisible();
    await expect(page.getByText("1300")).toHaveCount(0); // 相加会得到 1300
    await expect(page.getByText("已学 110/556")).toBeVisible();
  });

  test("迁移前的历史行与新设备行一并计入", async ({ page, board }) => {
    board.rows = [
      { app: "raz", data: save({ xp: 300, wordCursor: 40 }), updated_at: isoAgo(16) }, // 历史行
      { app: "raz#phoneA", data: save({ xp: 900, wordCursor: 120 }), updated_at: isoAgo(0) },
    ];
    await page.goto("/");

    await expect(page.getByText("900")).toBeVisible();
    await expect(page.getByText("已学 120/556")).toBeVisible();
  });

  test("新鲜度按各设备行的最新时间判断，历史行的旧时间戳不应触发误报", async ({ page, board }) => {
    board.rows = [
      { app: "raz", data: save({ xp: 300 }), updated_at: isoAgo(30) }, // 很旧的历史行
      { app: "raz#phoneA", data: save({ xp: 900 }), updated_at: isoAgo(0) }, // 刚同步过
    ];
    await page.goto("/");

    await expect(page.getByText("数据可能不是最新")).toHaveCount(0);
  });

  test("确实超过三天没同步时才显示提醒", async ({ page, board }) => {
    board.rows = [{ app: "raz#phoneA", data: save({ xp: 900 }), updated_at: isoAgo(5) }];
    await page.goto("/");

    await expect(page.getByText("数据可能不是最新")).toBeVisible();
  });

  test("阅读进度显示覆盖篇目数，循环重读另计累计次数", async ({ page, board }) => {
    board.rows = [{ app: "raz#phoneA", data: save({ xp: 100, readingsDone: 457 }), updated_at: isoAgo(0) }];
    await page.goto("/");

    // 41 篇是 raz 的总篇数；457 是含重复的累计次数
    await expect(page.getByText("41/41 篇")).toBeVisible();
    await expect(page.getByText("累计 457 次")).toBeVisible();
    await expect(page.getByText("457/41 篇")).toHaveCount(0);
  });

  test("阅读未满一轮时不显示累计次数，避免冗余", async ({ page, board }) => {
    board.rows = [{ app: "raz#phoneA", data: save({ xp: 100, readingsDone: 12 }), updated_at: isoAgo(0) }];
    await page.goto("/");

    await expect(page.getByText("12/41 篇")).toBeVisible();
    // 只断言"累计 N 次"这一处；页面另有"累计答题"统计格，用宽泛的"累计"会误伤
    await expect(page.getByText(/累计 \d+ 次/)).toHaveCount(0);
  });

  test("词汇进度以已学为准，掌握作为次要数值展示", async ({ page, board }) => {
    board.rows = [
      { app: "raz#phoneA", data: save({ xp: 100, wordCursor: 110, masteredCount: 0 }), updated_at: isoAgo(0) },
    ];
    await page.goto("/");

    await expect(page.getByText("已学 110/556 · 掌握 0")).toBeVisible();
    // 说明文字要讲清"掌握"为何长期为 0，否则家长会以为孩子没进展
    await expect(page.getByText(/29 天/)).toBeVisible();
  });

  test("连续全清天数按合并后的每日记录计算", async ({ page, board }) => {
    // 两台设备各完成一部分任务，合并后昨天与前天都算全清
    board.rows = [
      {
        app: "raz#phoneA",
        data: save({
          xp: 100,
          daily: { [dayOffset(-1)]: allDoneDay(), [dayOffset(-2)]: allDoneDay() },
        }),
        updated_at: isoAgo(0),
      },
    ];
    await page.goto("/");

    await expect(page.getByText("🔥")).toBeVisible();
    await expect(page.getByText("2 天")).toBeVisible();
  });

  test("两个孩子的卡片互不串数据", async ({ page, board }) => {
    board.rows = [
      { app: "raz#a", data: save({ xp: 111, wordCursor: 110 }), updated_at: isoAgo(0) },
      { app: "ielts#b", data: save({ xp: 222, wordCursor: 140 }), updated_at: isoAgo(0) },
    ];
    await page.goto("/");

    await expect(page.getByText("已学 110/556")).toBeVisible(); // 弟弟 raz
    await expect(page.getByText("已学 140/3601")).toBeVisible(); // 哥哥 ielts
  });

  test("忽略与两个应用无关的历史测试行", async ({ page, board }) => {
    board.rows = [
      { app: "_test", data: save({ xp: 99999 }), updated_at: isoAgo(0) },
      { app: "selftest", data: save({ xp: 88888 }), updated_at: isoAgo(0) },
      { app: "_probe#dev-test", data: save({ xp: 77777 }), updated_at: isoAgo(0) },
      { app: "raz#a", data: save({ xp: 100, wordCursor: 110 }), updated_at: isoAgo(0) },
    ];
    await page.goto("/");

    for (const junk of ["99999", "88888", "77777"]) {
      await expect(page.getByText(junk)).toHaveCount(0);
    }
    await expect(page.getByText("已学 110/556")).toBeVisible();
  });

  test("网络异常时提示离线而不是显示空白", async ({ page, board }) => {
    board.offline = true;
    await page.goto("/");

    await expect(page.getByText("网络异常")).toBeVisible({ timeout: 15_000 });
  });

  test("某个孩子还没有数据时显示占位卡而不是报错", async ({ page, board }) => {
    board.rows = [{ app: "raz#a", data: save({ xp: 100, wordCursor: 110 }), updated_at: isoAgo(0) }];
    await page.goto("/");

    await expect(page.getByText("已学 110/556")).toBeVisible();
    await expect(page.getByText("IELTS PROTOCOL")).toBeVisible(); // 哥哥的占位卡仍在
  });
});
