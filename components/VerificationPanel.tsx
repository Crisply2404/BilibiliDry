import React, { useMemo, useState } from 'react';
import type { Segment } from '../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function badgeForVerdict(verdict: 'pass' | 'weak' | 'fail'): { text: string; className: string } {
  if (verdict === 'pass') return { text: '✅ 已校验', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (verdict === 'weak') return { text: '⚠️ 需确认', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  return { text: '⚠️ 不对齐', className: 'bg-rose-50 text-rose-700 border-rose-200' };
}

export const VerificationPanel: React.FC<{
  segments: Segment[];
  maxItems?: number;
  title?: string;
  status?: { completed: number; total: number; progress: number };
  onSeek?: (time: number) => void;
}> = ({ segments, maxItems = 6, title = 'Reflection 校验', status, onSeek }) => {
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => {
    return segments
      .filter((s) => s.type === 'DRY' && s.verification)
      .slice()
      .sort((a, b) => (b.verification?.alignmentScore ?? 0) - (a.verification?.alignmentScore ?? 0))
      .slice(0, Math.max(1, Math.min(10, maxItems)));
  }, [maxItems, segments]);

  const stats = useMemo(() => {
    let pass = 0;
    let weak = 0;
    let fail = 0;
    for (const s of segments) {
      if (s.type !== 'DRY' || !s.verification) continue;
      if (s.verification.verdict === 'pass') pass += 1;
      else if (s.verification.verdict === 'weak') weak += 1;
      else fail += 1;
    }
    return { pass, weak, fail, total: pass + weak + fail };
  }, [segments]);

  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-gray-700">{title}</div>
          <div className="text-[11px] text-gray-500">
            {status && status.total > 0 ? `校验中 ${status.completed}/${status.total}` : '未校验'}
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-500">分析完成后会抽样校验关键干货段，并展示字幕证据。</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-gray-700">{title}</div>
        <div className="text-[11px] text-gray-600 font-mono">
          pass:{stats.pass} weak:{stats.weak} fail:{stats.fail}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {items.map((s) => {
          const v = s.verification!;
          const badge = badgeForVerdict(v.verdict);
          const opened = openId === s.id;
          return (
            <div key={s.id} className="rounded-md border border-gray-100 bg-white">
              <button
                type="button"
                className="w-full p-2 text-left"
                onClick={() => {
                  onSeek?.(Math.max(0, Math.floor(s.startTime)));
                  setOpenId((prev) => (prev === s.id ? null : s.id));
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-gray-500 font-mono">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                    </div>
                    <div className="mt-1 text-xs text-gray-800 line-clamp-2">{s.summary}</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${badge.className}`}>
                    {badge.text}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-gray-600">{v.reason}</div>
              </button>

              {opened && (
                <div className="border-t border-gray-100 p-2">
                  {v.repairedFrom && (
                    <div className="mb-2 text-[11px] text-gray-600">
                      已自动修正时间戳：{formatTime(v.repairedFrom.startTime)}–{formatTime(v.repairedFrom.endTime)} →{' '}
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500">字幕证据（节选）</div>
                  <div className="mt-1 space-y-1">
                    {(v.evidence ?? []).slice(0, 6).map((line, idx) => (
                      <div key={`${s.id}:${idx}`} className="text-[11px] text-gray-700 font-mono">
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-gray-400 font-mono">
                    score:{Math.round((v.alignmentScore ?? 0) * 100)} · {v.modelTag}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VerificationPanel;
