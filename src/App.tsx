import { useCallback, useEffect, useState } from "react";
import { familyGoal, fetchProgress, mergeRowsByApp, summarize, timeAgo, type KidSummary } from "@/lib/board";
import { EmptyCard, KidCard } from "@/components/KidCard";

const POLL_MS = 30_000;

export default function App() {
  const [kids, setKids] = useState<Partial<Record<"ielts" | "raz", KidSummary>>>({});
  const [lastFetch, setLastFetch] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    const rows = await fetchProgress();
    if (rows === null) {
      setOffline(true);
      return;
    }
    setOffline(false);
    const next: Partial<Record<"ielts" | "raz", KidSummary>> = {};
    // 先按应用把各设备的行合并，再统计——否则只会看到其中一台设备的进度
    for (const row of mergeRowsByApp(rows)) {
      if (row.app === "ielts" || row.app === "raz") {
        next[row.app] = summarize(row);
      }
    }
    setKids(next);
    setLastFetch(new Date().toISOString());
  }, []);

  // 启动拉取 + 每 30 秒轮询
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // 每秒刷新"更新于 x 秒前"
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // 战力榜：两人现在用同一套费率与门槛，XP 可以直接比了
  const present = [kids.ielts, kids.raz].filter((k): k is KidSummary => !!k);
  const ranked = [...present]
    .sort((a, b) => b.xp - a.xp)
    .map((s, i) => ({ s, place: present.length > 1 ? i + 1 : undefined }));
  const family = present.length > 0 ? familyGoal(present) : null;

  return (
    <div className="min-h-screen bg-val-bg bg-grid pb-10">
      <header className="border-b border-val-line bg-val-bg/95">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <p className="val-title text-[10px] tracking-[0.4em] text-val-red">PARENT HQ</p>
          <h1 className="val-title mt-1 text-2xl text-val-text">
            家长指挥部 <span className="text-val-dim">// PARENT HQ</span>
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-val-dim">
            {offline ? (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-val-red" />
                网络异常，显示的是上次数据
              </>
            ) : (
              <>
                <span
                  className="inline-block h-2 w-2 rounded-full bg-val-teal"
                  style={{ boxShadow: "0 0 6px #3DDBD9" }}
                />
                实时 · 更新于 {lastFetch ? timeAgo(lastFetch, now) : "…"}
              </>
            )}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-4">
        {/* 家庭合体目标：两人的分在这里是相加的。
            光有排名会天天把弟弟摆上台跟哥哥比大小，这条是配套的解药 */}
        {family && (
          <section className="clip-card border border-val-line bg-val-panel p-4">
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <p className="val-title text-[10px] tracking-[0.3em] text-val-red">
                  家庭合体 // FAMILY OPS
                </p>
                <p className="val-title mt-1 text-sm text-val-text">
                  {family.reached ?? "尚未达成第一个目标"}
                </p>
              </div>
              <div className="text-right">
                <p className="val-title text-2xl" style={{ color: "#FFF3B0" }}>
                  {family.total}
                </p>
                <p className="val-title text-[9px] text-val-dim">兄弟合计 XP</p>
              </div>
            </div>
            <div className="clip-tag h-2 w-full bg-val-panel2">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${family.pct}%`, background: "linear-gradient(90deg,#3DDBD9,#FFF3B0)" }}
              />
            </div>
            <p className="mt-1 text-[10px] text-val-dim">
              {family.nextName
                ? `下一站 ${family.nextName} · 还差 ${family.nextAt! - family.total} XP`
                : "已达成全部目标"}
            </p>
          </section>
        )}

        {ranked.map(({ s, place }) => (
          <KidCard key={s.app} s={s} now={now} place={place} />
        ))}
        {!kids.ielts && <EmptyCard kid="哥哥" appName="IELTS PROTOCOL" emoji="🎖️" />}
        {!kids.raz && <EmptyCard kid="弟弟" appName="RAZ MOVERS" emoji="🚀" />}

        <footer className="clip-card border border-val-line bg-val-panel p-4">
          <p className="val-title mb-2 text-[10px] tracking-[0.3em] text-val-dim">使用说明 // HOW IT WORKS</p>
          <ul className="space-y-1 text-xs leading-relaxed text-val-dim">
            <li>▸ 两个孩子的学习数据会<strong className="text-val-text">自动同步到云端</strong>，无需孩子手动操作。</li>
            <li>▸ 本页面每 30 秒自动刷新一次，随时看到最新进度。</li>
            <li>▸ 柱状图红色 = 当天 4 项任务全部完成；超过 3 天未更新会显示黄色提醒。</li>
            <li>
              ▸ <strong className="text-val-text">已学</strong> = 学过的词；
              <strong className="text-val-text">掌握</strong> = 连过 5 轮复习（间隔 1/2/4/7/15 天）的词，
              同一个词最快也要 <strong className="text-val-text">29 天</strong>才会计入，开头一个月是 0 属正常。
            </li>
            <li>▸ 阅读篇目读完一轮会从头循环，「累计 N 次」是含重复的总完成次数。</li>
            <li>
              ▸ <strong className="text-val-text">2026-08-18 起两个应用的加分费率与段位门槛已统一</strong>，
              弟弟此前按旧费率攒的分已按真实做题量补差重算，两人的 XP 现在可以直接比。
            </li>
            <li>
              ▸ <strong className="text-val-text">巅峰层</strong>在段位满级之上，每一级要
              XP 与一个具体挑战<strong className="text-val-text">同时达成</strong>，且逐级解锁——
              重复刷题攒 XP 升不上去。
            </li>
          </ul>
        </footer>
      </main>
    </div>
  );
}
