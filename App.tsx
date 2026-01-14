
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CardData } from './types';
import LinkCard from './components/LinkCard';
import { analyzeLink } from './services/geminiService';
import { Plus, PanelLeft, ListFilter, User, HelpCircle, FilePlus, LayoutGrid, Folder, ClipboardPaste, Upload, X } from 'lucide-react';

const App: React.FC = () => {
  const [cards, setCards] = useState<CardData[]>([]);
  const [activeProject, setActiveProject] = useState('Research board');
  const [isOver, setIsOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ visible: boolean, x: number, y: number } | null>(null);
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteInputValue, setPasteInputValue] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteInputRef = useRef<HTMLInputElement>(null);

  const projects = ['Research board', 'Visual references'];

  useEffect(() => {
    const saved = localStorage.getItem(`link-canvas-cards-${activeProject}`);
    if (saved) {
      try {
        setCards(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load cards", e);
      }
    } else {
      setCards([]);
    }
  }, [activeProject]);

  useEffect(() => {
    localStorage.setItem(`link-canvas-cards-${activeProject}`, JSON.stringify(cards));
  }, [cards, activeProject]);

  const getAutoLayoutPosition = (count: number) => {
    const cardWidth = 400;
    const spacingX = 32;
    const startX = 40;
    const startY = 80;
    
    const itemsPerRow = Math.max(1, Math.floor((window.innerWidth - (isSidebarCollapsed ? 64 : 260) - 80) / (cardWidth + spacingX))); 
    
    const col = count % itemsPerRow;
    const row = Math.floor(count / itemsPerRow);
    
    return {
      x: startX + col * (cardWidth + spacingX),
      y: startY + row * (450) 
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
        color: info.themeColor,
        type: 'link'
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

  const processFiles = (files: FileList) => {
    const filePromises = Array.from(files).map(file => {
      return new Promise<CardData>((resolve) => {
        if (file.type === 'application/pdf') {
          const fileUrl = URL.createObjectURL(file);
          resolve({
            id: Math.random().toString(36).substr(2, 9),
            url: fileUrl,
            title: file.name,
            description: `PDF Document (${(file.size / 1024).toFixed(1)} KB)`,
            thumbnail: '',
            x: 0,
            y: 0,
            color: '#ef4444',
            type: 'pdf'
          });
        } else if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            resolve({
              id: Math.random().toString(36).substr(2, 9),
              url: '#',
              title: file.name,
              description: `Uploaded image (${(file.size / 1024).toFixed(1)} KB)`,
              thumbnail: event.target?.result as string,
              x: 0,
              y: 0,
              color: '#3b82f6',
              type: 'image'
            });
          };
          reader.readAsDataURL(file);
        }
      });
    });

    Promise.all(filePromises).then(newCards => {
      setCards(prev => {
        const next = [...prev, ...newCards.filter(Boolean) as CardData[]];
        return next.map((c, i) => {
          const p = getAutoLayoutPosition(i);
          return { ...c, x: p.x, y: p.y };
        });
      });
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    } else {
      const url = e.dataTransfer.getData('text/plain');
      if (url) {
        await processUrl(url);
      }
    }
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
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
  }, [cards.length, isSidebarCollapsed, showPasteInput]);

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
  }, []);

  const deleteCard = (id: string) => {
    setCards(prev => prev.filter(c => c.id !== id));
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
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = '';
    }
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
    <div className="w-screen h-screen bg-white p-2 overflow-hidden select-none font-poppins">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={onFileChange} 
        className="hidden" 
        accept="image/*,application/pdf" 
        multiple 
      />
      
      <div 
        id="canvas-root"
        className="w-full h-full bg-[#f5eee2] rounded-lg flex overflow-hidden relative"
        onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
        onDragLeave={() => setIsOver(false)}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        <aside className={`${isSidebarCollapsed ? 'w-[64px]' : 'w-[260px]'} h-full border-r border-[#e5dfd3]/50 flex flex-col py-6 px-4 transition-all duration-300 ease-in-out`}>
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} mb-8 h-8`}>
            {!isSidebarCollapsed ? (
              <>
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-lg bg-zinc-900" />
                  <span className="font-bold text-zinc-900 tracking-tight text-base">Jarwiz</span>
                </div>
                <div className="flex items-center gap-3 text-zinc-400">
                   <HelpCircle size={16} className="hover:text-zinc-600 cursor-pointer transition-colors" />
                   <PanelLeft size={16} className="hover:text-zinc-600 cursor-pointer transition-colors" onClick={() => setIsSidebarCollapsed(true)} />
                </div>
              </>
            ) : (
              <PanelLeft size={20} className="text-zinc-400 hover:text-zinc-600 cursor-pointer" onClick={() => setIsSidebarCollapsed(false)} />
            )}
          </div>

          {!isSidebarCollapsed && (
            <div className="flex-1 flex flex-col">
              <button className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-transparent border border-[#e0d9c8] rounded-lg text-zinc-600 text-sm font-semibold hover:bg-[#e6dfcf]/30 transition-all mb-8">
                <Plus size={14} strokeWidth={3} />
                <span>New project</span>
              </button>

              <div className="flex-1">
                 <div className="flex items-center justify-between px-2 mb-4">
                    <span className="text-[11px] font-normal tracking-tight text-zinc-400">My files</span>
                    <ListFilter size={12} className="text-zinc-300" />
                 </div>
                 <div className="space-y-1">
                   {projects.map(project => (
                     <div 
                      key={project}
                      onClick={() => setActiveProject(project)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all ${
                        activeProject === project 
                          ? 'bg-[#e8e1d4] text-zinc-800 font-medium shadow-sm' 
                          : 'hover:bg-[#ede7d9] text-zinc-500 font-medium'
                      }`}
                     >
                        <Folder size={14} className={activeProject === project ? 'text-zinc-600' : 'text-zinc-400'} />
                        <span className="truncate">{project}</span>
                     </div>
                   ))}
                 </div>
              </div>
            </div>
          )}

          <div className={`mt-auto pt-6 flex ${isSidebarCollapsed ? 'justify-center' : 'items-center gap-2.5'}`}>
             <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-white overflow-hidden shadow-sm shrink-0">
                <User size={16} />
             </div>
             {!isSidebarCollapsed && (
               <div className="flex flex-col overflow-hidden">
                 <span className="text-xs font-semibold text-zinc-800 truncate">Raagul</span>
                 <span className="text-[10px] text-zinc-400 truncate">Free plan</span>
               </div>
             )}
          </div>
        </aside>

        <main className="flex-1 relative overflow-hidden">
          <header className="p-6 pointer-events-none z-30 flex justify-between items-center">
            <h2 className="text-zinc-500 font-medium text-sm tracking-tight pointer-events-auto">
              {activeProject}
            </h2>
            <div className="flex items-center gap-4 pointer-events-auto">
               {cards.length > 1 && (
                 <button 
                  onClick={reLayout}
                  className="group flex items-center gap-2 px-3 py-1.5 bg-[#fcf9f4] hover:bg-white border border-[#e5dfd3] rounded-lg text-zinc-400 hover:text-zinc-800 transition-all shadow-sm active:scale-95"
                  title="Rearrange all cards"
                 >
                   <LayoutGrid size={14} className="group-hover:rotate-90 transition-transform duration-500" />
                   <span className="text-[10px] font-bold tracking-tight">Tidy up</span>
                 </button>
               )}
            </div>
          </header>

          <div className="absolute inset-0 z-10 overflow-auto scrollbar-hide">
            <div className="relative min-w-full min-h-full">
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

          {showPasteInput && (
            <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-zinc-900/5 backdrop-blur-[2px] animate-in fade-in duration-200">
              <div className="bg-white p-6 rounded-2xl shadow-2xl border border-zinc-100 w-[400px] transform animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-bold text-zinc-800 tracking-tight">Paste link</h3>
                  <button onClick={() => setShowPasteInput(false)} className="text-zinc-400 hover:text-zinc-600 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <input 
                  ref={pasteInputRef}
                  type="text"
                  placeholder="https://..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-800/10 focus:border-zinc-800 transition-all"
                  value={pasteInputValue}
                  onChange={(e) => setPasteInputValue(e.target.value)}
                  onKeyDown={handlePasteInputKeyDown}
                />
                <p className="mt-3 text-[10px] text-zinc-400 font-medium">Press Enter to add, Esc to cancel</p>
              </div>
            </div>
          )}

          {contextMenu && (
            <div 
              className="fixed z-[1000] py-1.5 px-1.5 min-w-[180px] bg-white rounded-xl animate-in fade-in zoom-in-95 duration-100 pointer-events-auto shadow-2xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <button 
                onClick={handlePasteFromMenu}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 text-sm text-zinc-700 font-medium transition-colors rounded-lg"
              >
                <ClipboardPaste size={14} className="text-zinc-400" />
                <span>Paste</span>
              </button>
              <button 
                onClick={handleUploadClick}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 text-sm text-zinc-700 font-medium transition-colors rounded-lg"
              >
                <Upload size={14} className="text-zinc-400" />
                <span>Upload files</span>
              </button>
            </div>
          )}

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur rounded-lg shadow-2xl border border-zinc-100">
            <button 
              className="p-2 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-50 rounded-lg transition-all"
              onClick={handleUploadClick}
            >
              <FilePlus size={20} />
            </button>
            <div className="w-px h-6 bg-zinc-100 mx-1" />
            <button 
              className="p-2 text-zinc-400 hover:text-zinc-800 hover:bg-zinc-50 rounded-lg transition-all"
              onClick={() => {
                const url = prompt("Enter a url:");
                if (url) processUrl(url);
              }}
            >
              <Plus size={20} />
            </button>
          </div>

          {isLoading && (
            <div className="absolute top-8 right-8 z-50 flex items-center gap-3 bg-white px-4 py-2 rounded-lg shadow-lg border border-zinc-100 animate-in slide-in-from-top-4">
              <div className="w-3 h-3 border-2 border-zinc-800 border-t-transparent rounded-lg animate-spin" />
              <span className="text-[10px] font-bold text-zinc-600 tracking-tight">Generating card</span>
            </div>
          )}
          {isOver && (
            <div className="absolute inset-4 border-2 border-dashed border-zinc-300 rounded-lg bg-zinc-800/5 z-40 flex items-center justify-center">
              <span className="text-zinc-400 font-bold tracking-tight">Drop to add link or PDF</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
