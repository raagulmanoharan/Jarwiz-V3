import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CardData } from '../types';
import { Trash2, ExternalLink, GripHorizontal, Play, FileText, AlertCircle } from 'lucide-react';

interface LinkCardProps {
  card: CardData;
  onDelete: (id: string) => void;
  onUpdatePosition: (id: string, x: number, y: number) => void;
}

const LinkCard: React.FC<LinkCardProps> = ({ card, onDelete, onUpdatePosition }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const cardStartPos = useRef({ x: 0, y: 0 });

  const youtubeId = useMemo(() => {
    // Robust regex for standard, mobile, shorts, and embed URLs
    const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
    const match = card.url.match(regExp);
    return (match && match[1].length === 11) ? match[1] : null;
  }, [card.url]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.action-button')) return;
    
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    cardStartPos.current = { x: card.x, y: card.y };
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      onUpdatePosition(card.id, cardStartPos.current.x + dx, cardStartPos.current.y + dy);
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, card.id, onUpdatePosition]);

  // High-Quality YouTube Embedded Player Card
  if (youtubeId) {
    return (
      <div
        className={`absolute select-none transition-shadow duration-300 ${isDragging ? 'z-[100]' : 'z-10'}`}
        style={{
          left: card.x,
          top: card.y,
          width: '520px',
        }}
      >
        <div className={`
          bg-white rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-white/40 transition-all duration-300
          ${isDragging ? 'scale-[1.01] shadow-2xl ring-4 ring-zinc-900/10' : 'hover:shadow-2xl'}
        `}>
          {/* Header handle for YouTube players */}
          <div 
            className="h-12 bg-[#fafafa] border-b border-zinc-100 flex items-center justify-between px-4 cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-6 h-6 rounded bg-red-50 flex items-center justify-center shrink-0">
                <Play size={12} className="text-red-600 fill-red-600" />
              </div>
              <span className="text-[12px] font-bold text-zinc-600 tracking-tight truncate">
                {card.title || 'YouTube Player'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href={card.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="action-button p-2 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200/50 rounded-lg transition-all"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
              </a>
              <button 
                onClick={() => onDelete(card.id)} 
                onMouseDown={(e) => e.stopPropagation()}
                className="action-button p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="relative aspect-video bg-black">
            {/* Overlay to prevent iframe interference during drag */}
            {isDragging && (
              <div className="absolute inset-0 z-50 bg-transparent" />
            )}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1&autoplay=0`}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    );
  }

  // PDF Viewer Card
  if (card.type === 'pdf') {
    return (
      <div
        className={`absolute select-none transition-shadow duration-300 ${isDragging ? 'z-[100]' : 'z-10'}`}
        style={{
          left: card.x,
          top: card.y,
          width: '500px',
        }}
      >
        <div className={`
          bg-white rounded-2xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-white/40 transition-all duration-300 flex flex-col
          ${isDragging ? 'scale-[1.01] shadow-2xl ring-4 ring-zinc-900/10' : 'hover:shadow-2xl'}
        `}>
          {/* Header handle for PDF Viewer */}
          <div 
            className="h-12 bg-[#fafafa] border-b border-zinc-100 flex items-center justify-between px-4 cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-6 h-6 rounded bg-zinc-100 flex items-center justify-center shrink-0">
                <FileText size={12} className="text-zinc-600" />
              </div>
              <span className="text-[12px] font-bold text-zinc-600 tracking-tight truncate">
                {card.title}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href={card.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="action-button p-2 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200/50 rounded-lg transition-all"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
              </a>
              <button 
                onClick={() => onDelete(card.id)} 
                onMouseDown={(e) => e.stopPropagation()}
                className="action-button p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="relative h-[600px] bg-zinc-50">
            {/* Overlay to prevent interaction during drag */}
            {isDragging && (
              <div className="absolute inset-0 z-50 bg-transparent" />
            )}
            <object
              data={`${card.url}#toolbar=0&navpanes=0&scrollbar=0`}
              type="application/pdf"
              className="w-full h-full border-0"
            >
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-zinc-500">
                <AlertCircle size={48} className="mb-4 text-zinc-200" />
                <p className="text-sm font-medium">Unable to preview PDF directly.</p>
                <a 
                  href={card.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-4 px-6 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-zinc-800 transition-all"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  Open PDF in New Tab
                </a>
              </div>
            </object>
          </div>
        </div>
      </div>
    );
  }

  // Standard Link Card
  return (
    <div
      className={`absolute select-none group transition-shadow duration-300 ${isDragging ? 'z-[100]' : 'z-10'}`}
      style={{
        left: card.x,
        top: card.y,
        width: '400px',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={`
        bg-white rounded-2xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.08)] border border-white transition-all duration-300
        ${isDragging ? 'scale-[1.02] shadow-2xl ring-4 ring-zinc-900/5' : 'hover:shadow-2xl'}
      `}>
        {/* Media Container */}
        <div className="relative aspect-video bg-zinc-100 overflow-hidden rounded-xl">
          {isDragging && (
            <div className="absolute inset-0 z-[60] bg-transparent cursor-grabbing" />
          )}

          <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[70]">
            <a 
              href={card.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="action-button p-2 bg-white/90 hover:bg-white backdrop-blur rounded-xl text-zinc-800 shadow-lg transition-all"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ExternalLink size={16} />
            </a>
            <button 
              onClick={() => onDelete(card.id)} 
              onMouseDown={(e) => e.stopPropagation()}
              className="action-button p-2 bg-white/90 hover:bg-red-50 backdrop-blur rounded-xl text-zinc-800 hover:text-red-600 shadow-lg transition-all"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <div className="w-full h-full overflow-hidden">
            <img 
              src={card.thumbnail} 
              alt={card.title}
              className="w-full h-full object-cover block transition-transform duration-700 group-hover:scale-105"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${card.id}/800/450`;
              }}
            />
          </div>
        </div>

        {/* Text Content */}
        <div className="mt-4 px-3 pb-3">
          <h3 className="text-zinc-900 font-bold text-lg leading-tight line-clamp-2 tracking-tight">
            {card.title}
          </h3>
          <p className="mt-2 text-zinc-500 text-[13px] leading-relaxed line-clamp-3 font-normal">
            {card.description}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LinkCard;