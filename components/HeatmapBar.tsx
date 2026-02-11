import React, { useCallback, useRef } from 'react';
import { Segment, ContentType, type WaterReasonType } from '../types';

interface HeatmapBarProps {
  segments: Segment[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  interactive?: boolean;
}

const HeatmapBar: React.FC<HeatmapBarProps> = ({ 
  segments, 
  totalDuration, 
  currentTime, 
  onSeek,
  interactive = true 
}) => {
  const draggingRef = useRef(false);

  const waterReasonLabelZh = useCallback((t?: WaterReasonType): string => {
    switch (t) {
      case 'REPEAT':
        return '重复';
      case 'AD':
        return '广告';
      case 'NO_NEW_INFO':
        return '无信息增量';
      case 'SMALLTALK':
        return '寒暄';
      case 'OFFTOPIC':
        return '跑题';
      default:
        return '';
    }
  }, []);

  const seekFromClientX = useCallback(
    (el: HTMLDivElement, clientX: number) => {
      if (!interactive) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const percentage = rect.width > 0 ? x / rect.width : 0;
      const newTime = percentage * totalDuration;
      onSeek(newTime);
    },
    [interactive, onSeek, totalDuration]
  );

  return (
    <div className="w-full flex flex-col gap-1">
      {/* The main Heatmap Bar */}
      <div 
        className={`relative h-4 w-full bg-gray-200 rounded-sm overflow-hidden ${interactive ? 'cursor-pointer' : ''}`}
        onPointerDown={(e) => {
          if (!interactive) return;
          draggingRef.current = true;
          try {
            (e.currentTarget as any).setPointerCapture?.(e.pointerId);
          } catch {
            // ignore
          }
          seekFromClientX(e.currentTarget, e.clientX);
        }}
        onPointerMove={(e) => {
          if (!interactive) return;
          if (!draggingRef.current) return;
          seekFromClientX(e.currentTarget, e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {segments.map((segment) => {
          const widthPercent = ((segment.endTime - segment.startTime) / totalDuration) * 100;
          const leftPercent = (segment.startTime / totalDuration) * 100;
          
          // Color logic: Dry = Green/Blue intensity based on confidence, Water = Gray
          let bgColor = 'bg-gray-300';
          if (segment.type === ContentType.DRY) {
            // Opacity based on confidence
            const opacity = Math.max(0.4, segment.confidence);
            bgColor = `rgba(35, 173, 229, ${opacity})`; // Bilibili Blue
          }

          return (
            <div
              key={segment.id}
              className="absolute h-full transition-colors duration-300 hover:brightness-110"
              style={{
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                backgroundColor: segment.type === ContentType.DRY ? undefined : '#e5e7eb', // Tailwind gray-200
                background: segment.type === ContentType.DRY ? bgColor : undefined
              }}
              title={
                segment.type === ContentType.DRY
                  ? `干货: ${segment.summary}`
                  : (() => {
                      const label = waterReasonLabelZh(segment.waterReasonType);
                      const tag = label ? `（${label}）` : '';
                      const detail = segment.waterReasonText || segment.summary;
                      return `注水${tag}: ${detail}`;
                    })()
              }
            />
          );
        })}

        {/* Current Time Indicator */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-bilibili-pink z-10 shadow-sm"
          style={{
            left: `${Math.max(0, Math.min(100, (currentTime / totalDuration) * 100))}%`,
            transform: 'translateX(-50%)'
          }}
        />
      </div>
    </div>
  );
};

export default HeatmapBar;
