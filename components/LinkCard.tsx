
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CardData } from '../types';
import { Trash2, ExternalLink, GripHorizontal, Play } from 'lucide-react';

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
    const regExp = /^.*(?:(?:youtu\.be\/|v\/|vi\/|u\/\w\/|embed\/|shorts\/)|(?:(?:watch)?\?v(?:i)?=|\&v(?:i)?=))([^#\&\?]*).*/;
    const match = card.url.match(regExp);
    return (match && match[1].length === 11) ? match[1] : null;
  }, [card.url]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Allow dragging only from the header or specific handle
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
        className={`absolute select-none transition-transform duration-200 ${isDragging ? 'z-[100] scale-[1.02]' : 'z-10'}`}
        style={{
          left: card.x,
          top: card.y,
          width: '520px',
        }}
      >
        <div className={`
          bg-white rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/40 transition-shadow
          ${isDragging ? 'shadow-[0_40px_80px_rgba(0,0,0,0.2)]' : 'hover:shadow-[0_30px_60px_rgba(0,0,0,0.12)]'}
        `}>
          {/* Draggable Player Header */}
          <div 
            className="h-12 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between px-4 cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-6 h-6 rounded bg-red-100 flex items-center justify-center shrink-0">
                <Play size={10} className="text-red-600 fill-red-600" />
              </div>
              <span className="text-[11px] font-bold text-zinc-500 tracking-widest uppercase truncate">
                {card.title || 'YouTube Player'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href={card.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="action-button p-2 text-zinc-300 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-all"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <ExternalLink size={16} />
              </a>
              <button 
                onClick={() => onDelete(card.id)} 
                onMouseDown={(e) => e.stopPropagation()}
                className="action-button p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="relative aspect-video bg-black">
            {/* Overlay to prevent iframe absorbing drag events */}
            {isDragging && (
              <div className="absolute inset-0 z-50 bg-transparent" />
            )}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1&autoplay=0&iv_load_policy=3&showinfo=0`}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    );
  }

  // Standard Link Card
  return (
    <div
      className={`absolute select-none group transition-transform duration-200 ${isDragging ? 'z-[100] scale-[1.02]' : 'z-10'}`}
      style={{
        left: card.x,
        top: card.y,
        width: '400px',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={`
        bg-white rounded-[24px] p-2 shadow-[0_15px_40px_rgba(0,0,0,0.06)] border border-white transition-shadow
        ${isDragging ? 'shadow-[0_30px_70px_rgba(0,0,0,0.12)]' : 'hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)]'}
      `}>
        {/* Media Container */}
        <div className="relative aspect-video bg-zinc-50 overflow-hidden rounded-[18px]">
          {isDragging && (
            <div className="absolute inset-0 z-[60] bg-transparent cursor-grabbing" />
          )}

          <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-[70]">
            <a 
              href={card.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="action-button p-2 bg-white/95 hover:bg-white backdrop-blur rounded-xl text-zinc-800 shadow-xl border border-zinc-100/50 transition-all"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ExternalLink size={16} />
            </a>
            <button 
              onClick={() => onDelete(card.id)} 
              onMouseDown={(e) => e.stopPropagation()}
              className="action-button p-2 bg-white/95 hover:bg-red-50 backdrop-blur rounded-xl text-zinc-800 hover:text-red-600 shadow-xl border border-zinc-100/50 transition-all"
            >
              <Trash2 size={16} />
            </button>
          </div>

          <img 
            src={card.thumbnail} 
            alt={card.title}
            className="w-full h-full object-cover block transition-transform duration-700 group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${card.id}/800/450`;
            }}
          />
        </div>

        {/* Card Content */}
        <div className="mt-5 px-4 pb-4">
          <h3 className="text-zinc-900 font-bold text-lg leading-[1.2] line-clamp-2 tracking-tight">
            {card.title}
          </h3>
          <p className="mt-2.5 text-zinc-400 text-[13px] leading-relaxed line-clamp-3 font-normal">
            {card.description}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LinkCard;
