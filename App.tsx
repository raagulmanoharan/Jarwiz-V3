
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CardData } from './types';
import LinkCard from './components/LinkCard';
import { analyzeLink } from './services/geminiService';
import { Plus, FilePlus, LayoutGrid, ClipboardPaste, Upload, X, Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [cards, setCards] = useState<CardData[]>([]);
  const [isOver, setIsOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number } | null>(null);
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteInputValue, setPasteInputValue] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('link-canvas-cards-v2');
    if (saved) {
      try {
        setCards(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load cards", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('link-canvas-cards-v2', JSON.stringify(cards));
  }, [cards]);

  const getAutoLayoutPosition = (count: number) => {
    // Increased width to accommodate YouTube players (520px) + spacing
    const colWidth = 560;
    const rowHeight = 420;
    const spacingX = 40;
    const spacingY = 60;
    const startX = 60;
    const startY = 60;
    
    const canvasWidth = window.innerWidth - 120;
    const itemsPerRow = Math.max(1, Math.floor(canvasWidth / colWidth)); 
    
    const col = count % itemsPerRow;
    const row = Math.floor(count / itemsPerRow);
    
    return {
      x: startX + col * colWidth,
      y: startY + row * rowHeight
    };
  };

  const reLayout = () => {
    setCards(prev => 
      prev.map((card, index) => {
        const pos = getAutoLayoutPosition(index);
        return { ...card, x: pos.x, y: pos.y };
      })
    );
  };

  const processUrl = async (url: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl.startsWith('http')) return;
    
    setIsLoading(true);
    try {
      const infoPromise = analyzeLink(trimmedUrl);
      const mlResponsePromise = fetch(`https://api.microlink.io?url=${encodeURIComponent(trimmedUrl)}`);
      
      const [info, mlResponse] = await Promise.all([infoPromise, mlResponsePromise]);
      const mlData = await mlResponse.json();
      
      const thumbnail = 
        mlData.data?.image?.url || 
        mlData.data?.logo?.url || 
        `https://api.microlink.io?url=${encodeURIComponent(trimmedUrl)}&screenshot=true&embed=screenshot.url`;

      const newCard: CardData = {
        id: Math.random().toString(36).substr(2, 9),
        url: trimmedUrl,
        title: info.title,
        description: info.description,
        thumbnail: thumbnail,
        x: 0, 
        y: 0,
        color: info.themeColor
      };

      setCards(prev => {
        const next = [...prev, newCard];
        return next.map((c, i) => {
          const p = getAutoLayoutPosition(i);
          return { ...c, x: p.x, y: p.y };
        });
      });
    } catch (err) {
      console.error("Error creating card:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const url = e.dataTransfer.getData('text/plain');
    if (url) {
      await processUrl(url);
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste if we're typing in the manual input
      if (showPasteInput) return;
      
      const pastedText = e.clipboardData?.getData('text');
      if (pastedText && (pastedText.startsWith('http://') || pastedText.startsWith('https://'))) {
        processUrl(pastedText);
      }
    };

    const handleClickOutside = () => setContextMenu(null);

    window.addEventListener('paste', handlePaste);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [cards.length, showPasteInput]);

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
  }, []);

  const deleteCard = (id: string) => {
    setCards(prev => {
      const filtered = prev.filter(c => c.id !== id);
      // Tidy up after deletion to fill gaps
      return filtered.map((c, i) => {
        const p = getAutoLayoutPosition(i);
        return { ...c, x: p.x, y: p.y };
      });
    });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY
    });
  };

  const handlePasteFromMenu = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.startsWith('http')) {
        processUrl(text);
        return;
      }

      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const reader = new FileReader();
            reader.onload = (event) => {
              const thumbnail = event.target?.result as string;
              setCards(prev => {
                const next = [...prev, {
                  id: Math.random().toString(36).substr(2, 9),
                  url: '#',
                  title: 'Pasted Image',
                  description: `Clipboard image (${new Date().toLocaleTimeString()})`,
                  thumbnail,
                  x: 0,
                  y: 0,
                  color: '#10b981'
                }];
                return next.map((c, i) => {
                  const p = getAutoLayoutPosition(i);
                  return { ...c, x: p.x, y: p.y };
                });
              });
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
    } catch (err) {
      setShowPasteInput(true);
      setTimeout(() => pasteInputRef.current?.focus(), 100);
    }
  };

  const handleUploadClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setContextMenu(null);
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const filePromises = Array.from(files).map(file => {
      return new Promise<CardData>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          resolve({
            id: Math.random().toString(36).substr(2, 9),
            url: '#',
            title: file.name,
            description: `Uploaded file (${(file.size / 1024).toFixed(1)} KB)`,
            thumbnail: event.target?.result as string,
            x: 0,
            y: 0,
            color: '#3b82f6'
          });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(filePromises).then(newCards => {
      setCards(prev => {
        const next = [...prev, ...newCards];
        return next.map((c, i) => {
          const p = getAutoLayoutPosition(i);
          return { ...c, x: p.x, y: p.y };
        });
      });
    });
    e.target.value = '';
  };

  const handlePasteInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && pasteInputValue) {
      processUrl(pasteInputValue);
      setShowPasteInput(false);
      setPasteInputValue('');
    } else if (e.key === 'Escape') {
      setShowPasteInput(false);
      setPasteInputValue('');
    }
  };

  return (
    <div className="w-screen h-screen bg-[#fcf9f4] overflow-hidden select-none font-poppins">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={onFileChange} 
        className="hidden" 
        accept="image/*" 
        multiple 
      />
      
      <div 
        id="canvas-root"
        className="w-full h-full relative"
        onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        {/* Minimalist Floating Project Title */}
        <div className="absolute top-8 left-10 z-30 flex items-center gap-4">
          <h1 className="text-zinc-400 font-bold text-lg tracking-tight">LinkCanvas</h1>
          {cards.length > 0 && (
            <button 
              onClick={reLayout}
              className="p-1.5 text-zinc-300 hover:text-zinc-600 transition-colors"
              title="Tidy layout"
            >
              <LayoutGrid size={18} />
            </button>
          )}
        </div>

        {/* The Card Layer */}
        <div className="absolute inset-0 z-10 overflow-auto scrollbar-hide">
          <div className="relative w-[5000px] h-[5000px]">
            {cards.map(card => (
              <LinkCard 
                key={card.id} 
                card={card} 
                onDelete={deleteCard}
                onUpdatePosition={updatePosition}
              />
            ))}
          </div>
        </div>

        {/* Loading Indicator */}
        {isLoading && (
          <div className="absolute top-8 right-10 z-50 flex items-center gap-2.5 bg-white px-4 py-2 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-zinc-100 animate-in fade-in slide-in-from-top-2">
            <Loader2 size={14} className="animate-spin text-zinc-400" />
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">Generating Card</span>
          </div>
        )}

        {/* Drag and Drop Overlay */}
        {isOver && (
          <div className="absolute inset-4 border-2 border-dashed border-zinc-200 rounded-3xl bg-zinc-800/5 z-40 flex items-center justify-center pointer-events-none">
            <span className="text-zinc-400 font-bold tracking-tight text-xl">Drop to add link</span>
          </div>
        )}

        {/* Floating Manual Actions */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-2 bg-white rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-zinc-100">
          <button 
            className="p-2.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-50 rounded-full transition-all"
            onClick={handleUploadClick}
            title="Upload image"
          >
            <FilePlus size={20} />
          </button>
          <div className="w-px h-6 bg-zinc-100 mx-1" />
          <button 
            className="p-2.5 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-50 rounded-full transition-all"
            onClick={() => {
              const url = prompt("Enter a url:");
              if (url) processUrl(url);
            }}
            title="Add link manually"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Context Menu - No border, no shadow as requested */}
        {contextMenu && (
          <div 
            className="fixed z-[1000] py-2 px-2 min-w-[180px] bg-white rounded-2xl animate-in fade-in zoom-in-95 duration-100 pointer-events-auto shadow-none border-none"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button 
              onClick={handlePasteFromMenu}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 text-sm text-zinc-700 font-medium transition-colors rounded-xl"
            >
              <ClipboardPaste size={14} className="text-zinc-400" />
              <span>Paste from clipboard</span>
            </button>
            <button 
              onClick={handleUploadClick}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 text-sm text-zinc-700 font-medium transition-colors rounded-xl"
            >
              <Upload size={14} className="text-zinc-400" />
              <span>Upload images</span>
            </button>
          </div>
        )}

        {/* Paste Input Modal */}
        {showPasteInput && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-zinc-900/5 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white p-8 rounded-[32px] shadow-[0_40px_100px_rgba(0,0,0,0.15)] border border-zinc-50 w-[440px] transform animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-zinc-800 tracking-tight">Add a link</h3>
                <button onClick={() => setShowPasteInput(false)} className="text-zinc-300 hover:text-zinc-600 transition-colors">
                  <X size={20} />
                </button>
              </div>
              <input 
                ref={pasteInputRef}
                type="text"
                placeholder="https://..."
                className="w-full bg-zinc-50 border border-zinc-100 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-4 focus:ring-zinc-900/5 focus:border-zinc-300 transition-all placeholder:text-zinc-300"
                value={pasteInputValue}
                onChange={(e) => setPasteInputValue(e.target.value)}
                onKeyDown={handlePasteInputKeyDown}
              />
              <p className="mt-4 text-[11px] text-zinc-400 font-medium uppercase tracking-widest text-center">Press Enter to create card</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
