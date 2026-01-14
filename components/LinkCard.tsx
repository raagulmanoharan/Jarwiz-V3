
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CardData } from '../types';
import { Trash2, Play, X, ExternalLink } from 'lucide-react';

interface LinkCardProps {
  card: CardData;
  onDelete: (id: string) => void;
  onUpdatePosition: (id: string, x: number, y: number) => void;
}

const LinkCard: React.FC<LinkCardProps> = ({ card, onDelete, onUpdatePosition }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isEmbedActive, setIsEmbedActive] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const cardStartPos = useRef({ x: 0, y: 0 });

  const youtubeId = useMemo(() => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = card.url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
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
        bg-white rounded-lg p-[8px] shadow-[0_4px_20px_rgba(0,0,0,0.08)] transition-all duration-300
        ${isDragging ? 'scale-[1.02] shadow-2xl ring-2 ring-zinc-200' : 'hover:shadow-xl'}
      `}>
        {/* Media Container */}
        <div className="relative aspect-video bg-zinc-100 overflow-hidden rounded-lg">
          {/* Drag overlay to prevent iframe stealing focus/events */}
          {isDragging && (
            <div className="absolute inset-0 z-[60] bg-transparent cursor-grabbing" />
          )}

          {/* Action Buttons */}
          <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-[70]">
            <a 
              href={card.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="action-button p-1.5 bg-white/90 hover:bg-white backdrop-blur rounded-lg text-zinc-800 shadow-sm transition-all"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ExternalLink size={14} />
            </a>
            <button 
              onClick={() => onDelete(card.id)} 
              onMouseDown={(e) => e.stopPropagation()}
              className="action-button p-1.5 bg-white/90 hover:bg-red-50 backdrop-blur rounded-lg text-zinc-800 hover:text-red-600 shadow-sm transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {youtubeId && isEmbedActive ? (
            <div className="w-full h-full relative">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1`}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <button 
                onClick={(e) => { e.stopPropagation(); setIsEmbedActive(false); }}
                className="action-button absolute top-2 left-2 p-1.5 bg-black/50 hover:bg-black/70 text-white rounded-lg backdrop-blur-md transition-colors z-[75]"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div 
              className="w-full h-full cursor-pointer overflow-hidden" 
              onClick={() => youtubeId && setIsEmbedActive(true)}
            >
              <img 
                src={youtubeId ? `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg` : card.thumbnail} 
                alt={card.title}
                className="w-full h-full object-cover block transition-transform duration-700 hover:scale-105"
                style={{ backgroundRepeat: 'no-repeat' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${card.id}/800/450`;
                }}
              />
              {youtubeId && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-12 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                    <Play size={18} fill="white" className="text-white ml-0.5" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Text Content */}
        <div className="mt-4 px-2 pb-2">
          <h3 className="text-[#000000] font-bold text-lg leading-snug line-clamp-2">
            {card.title}
          </h3>
          <p className="mt-2 text-[#4A4A4A] text-[14px] leading-relaxed line-clamp-3 font-normal">
            {card.description}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LinkCard;
