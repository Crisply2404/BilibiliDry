import React from 'react';

export const HeatmapLegend: React.FC = () => {
  return (
    <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono">
        <span className="flex items-center gap-1"><div className="w-2 h-2 bg-[#23ADE5]"></div> 干货</span>
        <span className="flex items-center gap-1"><div className="w-2 h-2 bg-gray-300"></div> 注水</span>
    </div>
  );
};

export default HeatmapLegend;