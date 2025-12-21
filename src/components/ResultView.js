// ---------------------------------------------------------
// ResultView Component
// ---------------------------------------------------------
const ControlPanel = ({ config, onChange, label }) => {
    return (
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 mb-4 transition-all">
        <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></span>
            Enhance {label}
            </h4>
            <button 
            onClick={() => onChange({...config, isGrayscale: !config.isGrayscale})}
            className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all border ${config.isGrayscale ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
            >
            {config.isGrayscale ? 'Mode: Grayscale' : 'Mode: B&W Scan'}
            </button>
        </div>

        <div className="grid grid-cols-1 gap-4">
            <div>
            <div className="flex items-center text-[10px] font-black uppercase text-slate-500 mb-2">
                <span>Sharpening Intensity</span>
                <span className="ml-auto text-blue-600">{config.sharpening.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="2.0" step="0.1" value={config.sharpening} 
                onChange={e => onChange({...config, sharpening: parseFloat(e.target.value)})}
                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
            </div>

            <div className="grid grid-cols-2 gap-4">
            <div className={config.isGrayscale ? 'opacity-30 pointer-events-none' : ''}>
                <div className="flex items-center text-[10px] font-black uppercase text-slate-500 mb-2">
                <span>Threshold</span>
                <span className="ml-auto text-blue-600">{config.blockSize}</span>
                </div>
                <input type="range" min="3" max="151" step="2" value={config.blockSize} 
                onChange={e => onChange({...config, blockSize: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
            </div>
            <div className={config.isGrayscale ? 'opacity-30 pointer-events-none' : ''}>
                <div className="flex items-center text-[10px] font-black uppercase text-slate-500 mb-2">
                <span>Sensitivity</span>
                <span className="ml-auto text-blue-600">{config.offset}</span>
                </div>
                <input type="range" min="-20" max="40" step="1" value={config.offset} 
                onChange={e => onChange({...config, offset: parseInt(e.target.value)})}
                className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
            </div>
            </div>
        </div>
        </div>
    );
};

const ImageDisplay = ({ url, label, isRefining, onRotate }) => {
    const { useState } = window.React;
    const { ZoomIn, ZoomOut, RotateCcw } = window.lucideReact || {};

    const [naturalDims, setNaturalDims] = useState(null);
    const [scale, setScale] = useState(1);

    const handleImageLoad = (e) => {
        setNaturalDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
    };

    return (
        <div className="group relative bg-white rounded-[2.5rem] overflow-hidden border border-slate-200 shadow-xl flex flex-col w-full h-[550px]">
            {/* Toolbar */}
            <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-start pointer-events-none">
                <div className="bg-white/90 backdrop-blur px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-800 shadow-sm border border-slate-100 pointer-events-auto">
                    {label}
                </div>

                <div className="flex items-center gap-1 bg-white/90 backdrop-blur p-1 rounded-xl pointer-events-auto border border-slate-100 shadow-sm">
                    <button onClick={() => setScale(Math.max(0.25, scale - 0.25))} className="p-2 hover:bg-slate-100 hover:text-blue-600 rounded-lg transition-all text-slate-500">
                        {ZoomOut ? <ZoomOut size={14} strokeWidth={3} /> : <span>-</span>}
                    </button>
                    <span className="w-8 text-center text-[9px] font-black text-slate-700">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(Math.min(3, scale + 0.25))} className="p-2 hover:bg-slate-100 hover:text-blue-600 rounded-lg transition-all text-slate-500">
                        {ZoomIn ? <ZoomIn size={14} strokeWidth={3} /> : <span>+</span>}
                    </button>
                    <div className="w-px h-3 bg-slate-300 mx-1"></div>
                    <button onClick={onRotate} className="p-2 hover:bg-slate-100 hover:text-blue-600 rounded-lg transition-all text-slate-500">
                        {RotateCcw ? <RotateCcw size={14} strokeWidth={3} /> : <span>R</span>}
                    </button>
                </div>
            </div>

            {/* Scrollable Area */}
            <div className="flex-1 overflow-auto grid place-items-center bg-slate-50/50 p-4 relative custom-scrollbar">
                <div style={{ 
                    width: `${scale * 100}%`, 
                    height: `${scale * 100}%`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <img 
                        src={url} 
                        alt={label} 
                        onLoad={handleImageLoad}
                        className={`max-w-full max-h-full object-contain shadow-lg transition-opacity duration-300 ${isRefining ? 'opacity-30 grayscale' : 'opacity-100'}`} 
                    />
                </div>
            </div>
        
        {naturalDims && (
            <div className="absolute bottom-4 left-4 z-10 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg text-[9px] font-black text-white uppercase tracking-widest border border-white/10 pointer-events-none">
            {naturalDims.w} × {naturalDims.h} px
            </div>
        )}
        </div>
    );
};

window.ResultView = ({ 
    imageSrc, 
    points, 
    mode, 
    initialConfigs, 
    initialResults,
    normalizationSize,
    onUpdateResults
}) => {
    const { useState, useEffect } = window.React;
    const { processDocument } = window.opencvService;

    const [configs, setConfigs] = useState(initialConfigs);
    const [currentResults, setCurrentResults] = useState(initialResults);
    const [isRefining, setIsRefining] = useState(false);

    useEffect(() => {
        const timer = setTimeout(async () => {
        setIsRefining(true);
        try {
            const img = new Image();
            img.onload = async () => {
            const newResults = await processDocument(img, points, mode, configs, [], normalizationSize);
            setCurrentResults(newResults);
            onUpdateResults(newResults, configs);
            setIsRefining(false);
            };
            img.src = imageSrc;
        } catch (e) {
            console.error(e);
            setIsRefining(false);
        }
        }, 400);

        return () => clearTimeout(timer);
    }, [configs, normalizationSize, imageSrc, mode, points]);

    const handleRotate = (index) => {
        const nextConfigs = [...configs];
        // Increment rotation by 90 degrees
        nextConfigs[index] = { 
        ...nextConfigs[index], 
        rotation: (nextConfigs[index].rotation + 90) % 360 
        };
        setConfigs(nextConfigs);
    };

    return (
        <div className="w-full max-w-7xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500 pb-12">
        <div className={`grid gap-8 ${currentResults.length > 1 ? 'lg:grid-cols-2' : 'max-w-2xl mx-auto'}`}>
            {currentResults.map((url, i) => (
            <div key={i} className="flex flex-col w-full">
                <ControlPanel 
                config={configs[i] || initialConfigs[0]}
                label={mode === 'DOUBLE' ? (i === 0 ? 'Left' : 'Right') : 'Page'}
                onChange={(c) => {
                    const next = [...configs];
                    next[i] = c;
                    setConfigs(next);
                }}
                />
                <ImageDisplay 
                url={url} 
                label={mode === 'DOUBLE' ? (i === 0 ? 'Left Page' : 'Right Page') : 'Processed Document'}
                isRefining={isRefining}
                onRotate={() => handleRotate(i)}
                />
            </div>
            ))}
        </div>
        </div>
    );
};