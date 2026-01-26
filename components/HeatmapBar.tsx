import React from 'react';
import { Segment, ContentType } from '../types';

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
  
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const newTime = percentage * totalDuration;
    onSeek(newTime);
  };

  return (
    <div className="w-full flex flex-col gap-1">
      {/* The main Heatmap Bar */}
      <div 
        className={`relative h-4 w-full bg-gray-200 rounded-sm overflow-hidden ${interactive ? 'cursor-pointer' : ''}`}
        onClick={handleBarClick}
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
              title={`${segment.type === ContentType.DRY ? '干货' : '注水'}: ${segment.summary}`}
            />
          );
        })}

        {/* Current Time Indicator */}
        <div 
          className="absolute top-0 bottom-0 w-1 bg-bilibili-pink z-10 shadow-md"
          style={{ left: `${(currentTime / totalDuration) * 100}%` }}
        />
      </div>
    </div>
  );
};

export default HeatmapBar;