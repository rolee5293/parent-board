import type { KidSummary } from "@/lib/board";
import { isStale, timeAgo } from "@/lib/board";
import { cn } from "@/lib/utils";

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="clip-tag h-2 w-full bg-val-panel2">
      <div
        className="h-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.round(pct * 100))}%`, background: color }}
      />
    </div>
  );
}

function StatCell({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="clip-card-sm border border-val-line bg-val-bg p-2 text-center">
      <p className="text-base">{icon}</p>
      <p className="val-title mt-0.5 truncate text-xs text-val-text">{value}</p>
      <p className="text-[9px] text-val-dim">{label}</p>
    </div>
  );
}

export function KidCard({ s, now, place }: { s: KidSummary; now: number; place?: number }) {
  const stale = isStale(s.updatedAt, now);
  const quizPct = s.quizTotal > 0 ? Math.round((s.quizCorrect / s.quizTotal) * 100) : null;
  const maxXp = Math.max(1, ...s.days.map((d) => d.xp));

  return (
    <section className="clip-card border border-val-line bg-val-panel">
      {/* 头部 */}
      <div className="bg-stripes border-b border-val-line p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="val-title flex items-center gap-2 text-[10px] tracking-[0.3em] text-val-red">
              {place ? (
                <span
                  className="clip-tag inline-flex h-5 w-5 items-center justify-center text-[10px]"
                  style={{
                    background: place === 1 ? "#FFF3B022" : "#5A606822",
                    color: place === 1 ? "#FFF3B0" : "#C4CDD4",
                    border: `1px solid ${place === 1 ? "#FFF3B066" : "#5A606866"}`,
                  }}
                  title={`战力榜第 ${place} 名`}
                >
                  {place}
                </span>
              ) : null}
              <span>
                {s.kid} // {s.appName}
              </span>
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span
                className="clip-tag val-title inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs"
                style={{ color: s.rankColor, borderColor: `${s.rankColor}66`, background: `${s.rankColor}18` }}
              >
                <span className="inline-block h-2 w-2 rotate-45" style={{ background: s.rankColor }} />
                {s.rankName}
              </span>
              {s.peak > 0 && (
                <span
                  className="clip-tag val-title inline-flex items-center gap-1 px-2 py-0.5 text-[10px]"
                  style={{ background: "#FFF3B022", color: "#FFF3B0", border: "1px solid #FFF3B066" }}
                >
                  👑 巅峰 {s.peak}{s.peakName ? ` ${s.peakName}` : ""}
                </span>
              )}
              <span className="val-title text-sm text-val-gold">
                <span className={s.streak > 0 ? "anim-flame" : "grayscale opacity-50"}>🔥</span> {s.streak} 天
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="val-title text-2xl text-val-text">{s.xp}</p>
            <p className="val-title text-[9px] text-val-dim">TOTAL XP</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {stale && (
          <p className="clip-card-sm border border-val-gold/50 bg-val-gold/10 px-3 py-2 text-xs text-val-gold">
            ⚠ 数据可能不是最新（已超过 3 天未同步）
          </p>
        )}

        {/* 巅峰层下一级：段位满级后这是唯一还在动的目标 */}
        {s.nextPeak && (
          <div className="clip-card-sm border border-val-line bg-val-bg p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
              <span className="val-title tracking-[0.2em] text-val-dim">
                下一级 · 巅峰 {s.nextPeak.level} {s.nextPeak.name}
              </span>
              <span className={cn("val-title", s.nextPeak.cur >= s.nextPeak.need ? "text-val-teal" : "text-val-dim")}>
                {s.nextPeak.cur}/{s.nextPeak.need}
              </span>
            </div>
            <Bar
              pct={s.nextPeak.cur / s.nextPeak.need}
              color="linear-gradient(90deg,#FFF3B0,#FF4655)"
            />
            <p className="mt-1 text-[10px] text-val-dim">
              {s.nextPeak.challenge}
              {s.nextPeak.xpGap > 0 ? ` · XP 还差 ${s.nextPeak.xpGap}` : " · XP 已达标 ✓"}
            </p>
          </div>
        )}

        {/* 词汇进度 */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-val-dim">
            <span className="val-title tracking-[0.2em]">词汇进度</span>
            <span>
              已学 {s.wordsLearned}/{s.totalWords} · 掌握 {s.wordsMastered}
            </span>
          </div>
          {/* 进度条以"已学"为准：掌握需连过 5 轮复习（间隔 1/2/4/7/15 天，最快 29 天），
              开头一个月必然是 0，拿它当主进度条既无信息量也易被误读为没进展 */}
          <Bar pct={s.wordsLearned / s.totalWords} color="linear-gradient(90deg,#3DDBD9,#FF4655)" />
        </div>

        {/* 阅读进度 */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-val-dim">
            <span className="val-title tracking-[0.2em]">阅读进度</span>
            <span>
              {s.readingsDistinct}/{s.totalReadings} 篇
              {s.readingsDone > s.totalReadings && ` · 累计 ${s.readingsDone} 次`}
            </span>
          </div>
          <Bar pct={s.readingsDistinct / s.totalReadings} color="linear-gradient(90deg,#FFC24B,#FF4655)" />
        </div>

        {/* 统计格子 */}
        <div className="grid grid-cols-4 gap-1.5">
          <StatCell icon="🎯" value={quizPct !== null ? `${quizPct}%` : "—"} label="测验正确率" />
          <StatCell icon="🏅" value={String(s.badges)} label="勋章" />
          <StatCell icon="🌟" value={String(s.perfectDays)} label="全清天数" />
          <StatCell icon="📝" value={String(s.quizTotal)} label="累计答题" />
        </div>

        {/* 14 天 mini 柱状图 */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-val-dim">
            <span className="val-title tracking-[0.2em]">最近 14 天 XP</span>
            <span>红色 = 全清日</span>
          </div>
          <div className="flex h-20 items-end gap-1">
            {s.days.map((d) => (
              <div key={d.d} className="flex flex-1 flex-col items-center gap-0.5">
                <div
                  title={`${d.d}: +${d.xp} XP${d.done ? " · 全清" : ""}`}
                  className={cn("w-full rounded-t-sm", d.xp === 0 && "bg-val-panel2")}
                  style={
                    d.xp > 0
                      ? {
                          height: `${Math.max(8, (d.xp / maxXp) * 64)}px`,
                          background: d.done ? "#FF4655" : "#3DDBD9",
                          boxShadow: d.done ? "0 0 6px #FF465566" : "none",
                        }
                      : { height: "4px" }
                  }
                />
                <span className="text-[7px] text-val-dim/70">{d.d.slice(3)}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-right text-[10px] text-val-dim">
          战报更新于 {timeAgo(s.updatedAt, now)}
        </p>
      </div>
    </section>
  );
}

export function EmptyCard({ kid, appName, emoji }: { kid: string; appName: string; emoji: string }) {
  return (
    <section className="clip-card flex min-h-[220px] flex-col items-center justify-center border border-dashed border-val-line bg-val-panel/50 p-6 text-center">
      <p className="text-3xl grayscale">{emoji}</p>
      <p className="val-title mt-3 text-sm text-val-dim">
        {kid} // {appName}
      </p>
      <p className="mt-2 max-w-xs text-xs leading-relaxed text-val-dim">
        该孩子还没有云端存档。
        <br />
        先打开应用学习一次，数据会自动同步上来。
      </p>
    </section>
  );
}
