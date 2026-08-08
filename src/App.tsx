import { useCallback, useEffect, useState } from "react";
import { fetchProgress, summarize, timeAgo, type KidSummary } from "@/lib/board";
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
    for (const row of rows) {
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
        {kids.ielts ? (
          <KidCard s={kids.ielts} now={now} />
        ) : (
          <EmptyCard kid="哥哥" appName="IELTS PROTOCOL" emoji="🎖️" />
        )}
        {kids.raz ? (
          <KidCard s={kids.raz} now={now} />
        ) : (
          <EmptyCard kid="弟弟" appName="RAZ MOVERS" emoji="🚀" />
        )}

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
          </ul>
        </footer>
      </main>
    </div>
  );
}
