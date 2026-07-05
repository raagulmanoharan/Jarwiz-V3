import React, { useState, useMemo } from 'react';
import { CardData, SuggestedResource, ResourceKind } from '../types';
import { findRelatedResources } from '../services/geminiService';
import { Sparkles, X, Plus, Check, Play, FileText, BookOpen, Newspaper } from 'lucide-react';

interface UltraThinkProps {
  cards: CardData[];
  onAddResource: (resource: SuggestedResource) => void;
}

type Status = 'idle' | 'thinking' | 'ready' | 'empty' | 'error';

const MIN_CARDS = 3;

const normalizeUrl = (url: string): string =>
  url.trim().toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');

const KIND_META: Record<ResourceKind, { label: string; Icon: React.ElementType; color: string; bg: string }> = {
  video:   { label: 'Video',   Icon: Play,     color: '#dc2626', bg: '#fef2f2' },
  paper:   { label: 'Paper',   Icon: BookOpen, color: '#4f46e5', bg: '#eef2ff' },
  doc:     { label: 'Doc',     Icon: FileText, color: '#0891b2', bg: '#ecfeff' },
  article: { label: 'Article', Icon: Newspaper,color: '#059669', bg: '#ecfdf5' },
};

const UltraThink: React.FC<UltraThinkProps> = ({ cards, onAddResource }) => {
  const [status, setStatus] = useState<Status>('idle');
  const [suggestions, setSuggestions] = useState<SuggestedResource[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const boardUrls = useMemo(
    () => new Set(cards.map((c) => normalizeUrl(c.url))),
    [cards]
  );

  const run = async () => {
    if (status === 'thinking') return;
    setStatus('thinking');
    setDrawerOpen(false);
    try {
      const results = await findRelatedResources(
        cards.map((c) => ({ title: c.title, description: c.description, url: c.url }))
      );
      if (results.length === 0) {
        setStatus('empty');
        return;
      }
      setSuggestions(results);
      setStatus('ready');
    } catch (err) {
      console.error('Ultra think failed', err);
      setStatus('error');
    }
  };

  const handleButtonClick = () => {
    if (status === 'ready') {
      setDrawerOpen((open) => !open);
    } else {
      run();
    }
  };

  // Not enough context yet, and nothing discovered — stay out of the way.
  if (cards.length < MIN_CARDS && suggestions.length === 0 && status === 'idle') {
    return null;
  }

  const renderButtonLabel = () => {
    switch (status) {
      case 'thinking':
        return (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            <span>Thinking…</span>
          </>
        );
      case 'ready':
        return (
          <>
            <Sparkles size={14} className="fill-white/30" />
            <span>{suggestions.length} resources found</span>
          </>
        );
      case 'empty':
        return (
          <>
            <Sparkles size={14} />
            <span>Nothing new — retry</span>
          </>
        );
      case 'error':
        return (
          <>
            <Sparkles size={14} />
            <span>Try again</span>
          </>
        );
      default:
        return (
          <>
            <Sparkles size={14} className="fill-white/30" />
            <span>Ultra think</span>
          </>
        );
    }
  };

  const isLive = status === 'idle' || status === 'thinking' || status === 'ready';

  return (
    <>
      <button
        onClick={handleButtonClick}
        disabled={status === 'thinking'}
        title="Find more relevant content from across the web"
        className={`
          ${isLive ? 'ultra-gradient text-white shadow-[0_4px_16px_rgba(219,39,119,0.35)]' : 'bg-white text-zinc-500 border border-[#e5dfd3] shadow-sm'}
          flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] font-bold tracking-tight
          transition-all active:scale-95 hover:brightness-105 disabled:cursor-wait
          ${status === 'ready' ? 'ring-2 ring-fuchsia-300/60' : ''}
        `}
      >
        {renderButtonLabel()}
      </button>

      {drawerOpen && status === 'ready' && (
        <>
          <div
            className="fixed inset-0 z-[1400] bg-zinc-900/5 backdrop-blur-[1px] animate-in fade-in duration-200"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="fixed top-0 right-0 z-[1500] h-full w-[400px] max-w-[92vw] bg-[#fcf9f4] border-l border-[#e5dfd3] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-5 border-b border-[#e5dfd3]/70 flex items-start justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl ultra-gradient flex items-center justify-center shadow-sm">
                  <Sparkles size={16} className="text-white fill-white/30" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 tracking-tight leading-tight">Ultra think</h3>
                  <p className="text-[11px] text-zinc-400 font-medium">
                    {suggestions.length} resources from across the web
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/40 rounded-lg transition-all"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-3">
              {suggestions.map((res, i) => {
                const added = boardUrls.has(normalizeUrl(res.url));
                const meta = KIND_META[res.type];
                const { Icon } = meta;
                return (
                  <div
                    key={`${res.url}-${i}`}
                    className="bg-white rounded-xl border border-[#ece6d8] p-4 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2.5">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-tight"
                        style={{ color: meta.color, backgroundColor: meta.bg }}
                      >
                        <Icon size={11} />
                        {meta.label}
                      </span>
                      <button
                        onClick={() => !added && onAddResource(res)}
                        disabled={added}
                        className={`
                          flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-tight transition-all active:scale-95
                          ${added
                            ? 'bg-emerald-50 text-emerald-600 cursor-default'
                            : 'bg-zinc-900 text-white hover:bg-zinc-700'}
                        `}
                      >
                        {added ? <Check size={12} /> : <Plus size={12} strokeWidth={3} />}
                        {added ? 'Added' : 'Add'}
                      </button>
                    </div>

                    <a
                      href={res.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[13px] font-bold text-zinc-900 leading-snug tracking-tight hover:underline line-clamp-2"
                    >
                      {res.title}
                    </a>

                    {res.description && (
                      <p className="mt-1.5 text-[12px] text-zinc-500 leading-relaxed line-clamp-3 font-normal">
                        {res.description}
                      </p>
                    )}

                    {res.reason && (
                      <p className="mt-2.5 text-[11px] text-fuchsia-700/80 leading-snug font-medium italic line-clamp-2">
                        {res.reason}
                      </p>
                    )}

                    {res.source && (
                      <p className="mt-2 text-[10px] text-zinc-400 font-semibold tracking-tight truncate">
                        {res.source}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-[#e5dfd3]/70 shrink-0">
              <button
                onClick={run}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#e0d9c8] text-zinc-500 text-[11px] font-bold tracking-tight hover:bg-[#f0eadc]/40 hover:text-zinc-700 transition-all"
              >
                <Sparkles size={13} />
                Think again
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
};

export default UltraThink;
