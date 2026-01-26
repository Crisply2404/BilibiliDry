import React from 'react';
import { LogicBlock, LogicType } from '../types';
import { BookOpen, AlertCircle, CheckCircle, LayoutTemplate } from 'lucide-react';

interface LogicBlocksProps {
  blocks: LogicBlock[];
  onBlockClick: (block: LogicBlock) => void;
}

const getTypeIcon = (type: LogicType) => {
  switch (type) {
    case LogicType.BACKGROUND: return <BookOpen size={16} className="text-blue-500" />;
    case LogicType.PROBLEM: return <AlertCircle size={16} className="text-red-500" />;
    case LogicType.SOLUTION: return <CheckCircle size={16} className="text-green-500" />;
    case LogicType.CASE: return <LayoutTemplate size={16} className="text-purple-500" />;
    default: return <BookOpen size={16} />;
  }
};

const getTypeLabel = (type: LogicType) => {
  switch (type) {
    case LogicType.BACKGROUND: return '背景';
    case LogicType.PROBLEM: return '问题';
    case LogicType.SOLUTION: return '解决方案';
    case LogicType.CASE: return '案例';
    default: return type;
  }
};

const getTypeColor = (type: LogicType) => {
    switch (type) {
      case LogicType.BACKGROUND: return 'bg-blue-50 border-blue-200 hover:border-blue-400';
      case LogicType.PROBLEM: return 'bg-red-50 border-red-200 hover:border-red-400';
      case LogicType.SOLUTION: return 'bg-green-50 border-green-200 hover:border-green-400';
      case LogicType.CASE: return 'bg-purple-50 border-purple-200 hover:border-purple-400';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

const LogicBlocks: React.FC<LogicBlocksProps> = ({ blocks, onBlockClick }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
      {blocks.map((block) => (
        <div 
          key={block.id}
          onClick={() => onBlockClick(block)}
          className={`
            p-4 rounded-lg border-2 cursor-pointer transition-all duration-200 
            ${getTypeColor(block.type)} shadow-sm hover:shadow-md
          `}
        >
          <div className="flex items-center gap-2 mb-2 uppercase tracking-wider text-xs font-bold text-gray-500">
            {getTypeIcon(block.type)}
            <span>{getTypeLabel(block.type)}</span>
          </div>
          <h3 className="font-bold text-gray-800 mb-1">{block.title}</h3>
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
            {block.description}
          </p>
          <div className="mt-3 flex justify-end">
             <button className="text-xs font-semibold text-gray-400 hover:text-bilibili-pink flex items-center gap-1 transition-colors">
                查看片段 →
             </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default LogicBlocks;