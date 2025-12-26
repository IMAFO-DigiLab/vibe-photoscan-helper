// ---------------------------------------------------------
// App Component
// ---------------------------------------------------------
const BATCH_LIMIT = 50;
const DEFAULT_PRESET = {
    points: [],
    mode: 'SINGLE',
    rotation: 0,
    configs: [
        { blockSize: 41, offset: 12, useClahe: true, denoise: 1, colorMode: 'BW', sharpening: 1.0, rotation: 0 }
    ]
};

const clonePreset = (p) => ({
    points: (p?.points || []).map(pt => ({ ...pt })),
    mode: p?.mode || 'SINGLE',
    rotation: typeof p?.rotation === 'number' ? p.rotation : 0,
    configs: (p?.configs || DEFAULT_PRESET.configs).map(c => ({ ...c }))
});

window.App = () => {
    const { useState, useEffect, useRef, useCallback } = window.React;
    
    // Safely access globals
    const opencvService = window.opencvService || {};
    const JSZip = window.JSZip;
    const ScannerEditor = window.ScannerEditor;
    const ResultView = window.ResultView;

    const [step, setStep] = useState('UPLOAD');
    const [isCVLoaded, setIsCVLoaded] = useState(false);
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    
    // Export States
    const [isExporting, setIsExporting] = useState(false);
    const [showExportSettings, setShowExportSettings] = useState(false);
    const [exportProgress, setExportProgress] = useState(null);
    
    const [normalization, setNormalization] = useState('NONE');
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    
    // Zoom States
    const [editorScale, setEditorScale] = useState(1);

    // Export format and quality
    const [exportFormat, setExportFormat] = useState('jpg'); // 'jpg' or 'png'
    const [jpegQuality, setJpegQuality] = useState(0.92); // 0.0 to 1.0

    // Toast notifications
    const [toast, setToast] = useState(null); // { text: string } | null
    const showToast = useCallback((text) => {
        setToast({ text });
        setTimeout(() => setToast(null), 1800);
    }, []);

    // Editor flash key to highlight corners when a preset is applied
    const [presetFlashKey, setPresetFlashKey] = useState(0);

    const fileInputRef = useRef(null);

    const [lastUsedPoints, setLastUsedPoints] = useState([]);
    const [lastUsedMode, setLastUsedMode] = useState('SINGLE');
    const [lastUsedConfigs, setLastUsedConfigs] = useState([
        { blockSize: 41, offset: 12, useClahe: true, denoise: 1, colorMode: 'BW', sharpening: 1.0, rotation: 0 },
        { blockSize: 41, offset: 12, useClahe: true, denoise: 1, colorMode: 'BW', sharpening: 1.0, rotation: 0 }
    ]);

    // Manual Presets (two slots): saved and applied manually, independent of last-used state
    const [manualPresets, setManualPresets] = useState({
        P1: null,
        P2: null
    });

    useEffect(() => {
        // HIDE LOADER WHEN APP MOUNTS
        const loader = document.getElementById('loading');
        if (loader) loader.classList.add('loading-hidden');

        if (opencvService.waitForOpenCV) {
            opencvService.waitForOpenCV().then(() => setIsCVLoaded(true));
        } else {
            const interval = setInterval(() => {
                if (window.opencvService && window.opencvService.waitForOpenCV) {
                    clearInterval(interval);
                    window.opencvService.waitForOpenCV().then(() => setIsCVLoaded(true));
                }
            }, 200);
        }

        // Load manual presets from localStorage
        try {
            const rawManual = localStorage.getItem('photoscan_manualPresets');
            if (rawManual) {
                const parsed = JSON.parse(rawManual);
                if (parsed && (parsed.P1 || parsed.P2)) {
                    setManualPresets({
                        P1: parsed.P1 ? clonePreset(parsed.P1) : null,
                        P2: parsed.P2 ? clonePreset(parsed.P2) : null
                    });
                }
            }
        } catch {}
    }, []);

    const persistManualPresets = (next) => {
        setManualPresets(next);
        try { localStorage.setItem('photoscan_manualPresets', JSON.stringify(next)); } catch {}
    };

    const saveManualPreset = (slot) => {
        const item = queue[currentIndex];
        if (!item) return;
        const rot = (item.configs && item.configs[0] && typeof item.configs[0].rotation === 'number') ? item.configs[0].rotation : 0;
        const preset = {
            points: (item.points || []).map(p => ({...p})),
            mode: item.mode,
            rotation: rot,
            configs: (item.configs || []).map(c => ({...c}))
        };
        const next = { ...manualPresets, [slot]: preset };
        persistManualPresets(next);
        showToast(slot === 'P1' ? 'Preset One saved' : 'Preset Two saved');
    };

    const applyManualPreset = (slot) => {
        const preset = manualPresets[slot];
        const img = queue[currentIndex];
        if (!preset || !img) return;
        const nextQueue = [...queue];
        const updated = {
            ...img,
            points: preset.points && preset.points.length > 0 ? preset.points.map(p => ({...p})) : (lastUsedPoints || []),
            mode: preset.mode || lastUsedMode,
            configs: preset.configs && preset.configs.length > 0 ? preset.configs.map(c => ({...c})) : lastUsedConfigs.map(c => ({...c})),
            results: []
        };
        nextQueue[currentIndex] = updated;
        setQueue(nextQueue);
        setLastUsedPoints(updated.points);
        setLastUsedMode(updated.mode);
        setLastUsedConfigs(updated.configs);
        setStep('EDIT');
        setPresetFlashKey((k) => k + 1);
        showToast(slot === 'P1' ? 'Preset One applied' : 'Preset Two applied');
    };
    
    const clearManualPreset = (slot) => {
        const next = { ...manualPresets, [slot]: null };
        persistManualPresets(next);
        showToast(slot === 'P1' ? 'Preset One cleared' : 'Preset Two cleared');
    };
    // Preset persistence removed

    const handleFiles = (files) => {
        const limitedFiles = files.slice(0, BATCH_LIMIT);
        // Use last-used settings only

        const readerPromises = limitedFiles.map((file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
            resolve({
                id: Math.random().toString(36).substr(2, 9),
                src: event.target?.result,
                name: file.name.split('.')[0],
                points: lastUsedPoints.length > 0 ? lastUsedPoints.map(p => ({...p})) : [],
                mode: lastUsedMode,
                configs: lastUsedConfigs.map(c => ({ ...c })),
                results: []
            });
            };
            reader.readAsDataURL(file);
        });
        });

        Promise.all(readerPromises).then((newImages) => {
        setQueue(prev => [...prev, ...newImages].slice(0, BATCH_LIMIT));
        setStep('EDIT');
        });
    };

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) handleFiles(files);
    };

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) handleFiles(files);
    }, [lastUsedPoints, lastUsedMode, lastUsedConfigs]);

    const handleProcess = async (corners, mode, rotation = 0) => {
        const current = queue[currentIndex];
        if (!current) return;
        setIsProcessing(true);
        setLastUsedPoints(corners);
        setLastUsedMode(mode);
        
        const currentConfigs = lastUsedConfigs.map(c => ({...c, rotation: rotation}));
        setLastUsedConfigs(currentConfigs);

        // Preset auto-save removed

        try {
        const img = new Image();
        img.onload = async () => {
            const results = await window.opencvService.processDocument(img, corners, mode, currentConfigs, [], normalization);
            const updatedQueue = [...queue];
            updatedQueue[currentIndex] = { 
                ...current, 
                results, 
                points: corners, 
                mode, 
                configs: currentConfigs.map(c => ({...c}))
            };
            setQueue(updatedQueue);
            setStep('RESULT');
            setIsProcessing(false);
        };
        img.src = current.src;
        } catch (error) {
        console.error(error);
        alert("Processing failed.");
        setIsProcessing(false);
        }
    };

    const handleUpdateResults = (newResults, newConfigs) => {
        const updatedQueue = [...queue];
        updatedQueue[currentIndex] = { ...updatedQueue[currentIndex], results: newResults, configs: newConfigs };
        setQueue(updatedQueue);
        setLastUsedConfigs(newConfigs);
        // Preset auto-save removed
    };

    const performBatchExport = async (targetSize) => {
        setIsExporting(true);
        setExportProgress('Initializing export...');
        const zip = new JSZip();

        const itemsToExport = queue.filter(item => item.results.length > 0);

        if (itemsToExport.length === 0) {
            setIsExporting(false);
            setShowExportSettings(false);
            return;
        }

        try {
            for (let i = 0; i < itemsToExport.length; i++) {
                const item = itemsToExport[i];
                setExportProgress(`Processing page ${i + 1} of ${itemsToExport.length}...`);

                const img = new Image();
                img.src = item.src;
                await new Promise((resolve) => { 
                    if (img.complete) resolve();
                    else img.onload = () => resolve(); 
                });

                const newResults = await window.opencvService.processDocument(
                    img,
                    item.points,
                    item.mode,
                    item.configs,
                    [],
                    targetSize,
                    exportFormat,
                    jpegQuality
                );

                newResults.forEach((dataUrl, idx) => {
                    const base64Data = dataUrl.split(',')[1];
                    const suffix = item.mode === 'DOUBLE' ? (idx === 0 ? '-left' : '-right') : `-${idx+1}`;
                    const extension = exportFormat === 'png' ? 'png' : 'jpg';
                    zip.file(`${item.name}${suffix}.${extension}`, base64Data, { base64: true });
                });
            }

            setExportProgress('Compressing archive...');
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Photoscan-Batch-${targetSize}-${new Date().getTime()}.zip`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export failed", e);
            alert("Export failed. See console for details.");
        } finally {
            setIsExporting(false);
            setExportProgress(null);
            setShowExportSettings(false);
        }
    };

    const requestAbortSession = useCallback(() => {
        setShowExitConfirm(true);
    }, []);

    const confirmAbortSession = () => {
        setStep('UPLOAD'); 
        setQueue([]); 
        setCurrentIndex(0); 
        setShowExitConfirm(false);
        setEditorScale(1);
    };

    const continueScanning = useCallback(() => {
        if (currentIndex < queue.length - 1) {
        const nextIdx = currentIndex + 1;
        const nextQueue = [...queue];
        if (nextQueue[nextIdx].points.length === 0) {
            nextQueue[nextIdx].points = lastUsedPoints.length > 0 ? lastUsedPoints.map(p => ({...p})) : nextQueue[nextIdx].points;
            nextQueue[nextIdx].mode = lastUsedMode;
            nextQueue[nextIdx].configs = lastUsedConfigs.map(c => ({ ...c }));
            setQueue(nextQueue);
        }

        setCurrentIndex(nextIdx);
        setStep('EDIT');
        } else {
        setShowExportSettings(true);
        }
    }, [currentIndex, queue, lastUsedPoints, lastUsedMode, lastUsedConfigs]);

    const handleSavePreset = (points, mode, rotation) => {
        const baseConfigs = lastUsedConfigs.map(c => ({...c}));
        const configsWithRotation = baseConfigs.map(c => ({...c, rotation}));
        const next = {
            ...presets,
            [activePreset]: {
                points: points.map(p => ({...p})),
                mode,
                rotation,
                configs: configsWithRotation
            }
        };
        persistPresets(next);
    };

    const handleOpenExport = () => {
        setShowExportSettings(true);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
        if (step === 'RESULT' && e.key === 'Enter') {
            e.preventDefault();
            if (!showExportSettings) {
                continueScanning();
            }
        }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [step, continueScanning, showExportSettings]);

    if (!isCVLoaded) {
        return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-10 text-center">
            <div className="w-20 h-20 border-8 border-blue-600 border-t-transparent rounded-full animate-spin mb-10"></div>
            <h2 className="text-3xl font-black uppercase tracking-widest mb-4">Starting up...</h2>
            <p className="text-slate-500 font-bold uppercase tracking-[0.3em] animate-pulse">Waking up the vision engine</p>
        </div>
        );
    }

    const currentImage = queue[currentIndex];
    const hasProcessedImages = queue.some(q => q.results.length > 0);

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-blue-100 relative">
        <div className="bg-[#F59E0B] py-2 px-4 flex items-center justify-center gap-3 text-[#451A03] font-black text-[11px] uppercase tracking-widest text-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>NOTICE: THIS IS A VIBE-CODED PROTOTYPE AND MAY NOT WORK PERFECTLY.</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>

        <header className="bg-white border-b border-slate-200 py-6 px-8 sticky top-0 z-50 shadow-sm">
            <div className="max-w-[1600px] mx-auto flex flex-wrap gap-4 justify-between items-center">
            <div className="flex items-center gap-5">
                <h1 className="text-2xl font-black text-slate-900 tracking-tighter">Photoscan <span className="text-blue-600">Helper</span></h1>
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
                {/* Preview size controls removed; choose size at export time */}

                {/* Manual Presets: Save/Apply/Clear for two slots */}
                <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                    <span className="px-3 text-[9px] font-black uppercase text-slate-400 tracking-widest">Manual Presets:</span>
                    {[{key:'P1', label:'One'}, {key:'P2', label:'Two'}].map(ps => (
                        <div key={ps.key} className="flex items-center gap-1">
                            <button
                                onClick={() => saveManualPreset(ps.key)}
                                className="px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all bg-white shadow-sm text-slate-700 hover:text-blue-600"
                            >Save {ps.label}</button>
                            <button
                                onClick={() => applyManualPreset(ps.key)}
                                disabled={!manualPresets[ps.key]}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${manualPresets[ps.key] ? 'text-slate-500 hover:text-slate-800' : 'opacity-40 cursor-not-allowed text-slate-400'}`}
                            >Apply {ps.label}</button>
                            <button
                                onClick={() => clearManualPreset(ps.key)}
                                disabled={!manualPresets[ps.key]}
                                className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${manualPresets[ps.key] ? 'text-slate-400 hover:text-red-600' : 'opacity-40 cursor-not-allowed text-slate-300'}`}
                            >Clear {ps.label}</button>
                        </div>
                    ))}
                </div>
                
                {hasProcessedImages && (
                <button onClick={handleOpenExport} disabled={isExporting} className="bg-blue-600 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-[0.1em] hover:bg-blue-700 transition-all shadow-xl disabled:opacity-50">
                    {isExporting ? '...' : 'Save All'}
                </button>
                )}
                
                {queue.length > 0 && (
                <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest flex items-center gap-3">
                    <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                    {currentIndex + 1} / {queue.length}
                </div>
                )}
            </div>
            </div>
        </header>

        <main className="flex-1 p-6 lg:p-12">
            <div className="max-w-[1800px] mx-auto">
            {step === 'UPLOAD' && (
                <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} className="flex flex-col items-center justify-center min-h-[65vh] text-center">
                <div className="mb-8 max-w-2xl px-4">
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
                    Created with AI by Jan Odstrčilík as part of the DH Vibe Coding Advent Calendar, DigiLab of the Institute for Medieval Research, Austrian Academy of Sciences, 2025.
                    </p>
                </div>
                <div className={`max-w-3xl w-full p-16 lg:p-24 rounded-[4rem] shadow-2xl border-4 transition-all duration-700 ${isDragging ? 'border-blue-600 bg-blue-50 scale-[1.02]' : 'border-slate-50 bg-white'}`}>
                    <div className="mb-10 w-24 h-24 rounded-3xl bg-slate-900 text-white flex items-center justify-center mx-auto shadow-2xl">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    </div>
                    <h2 className="text-4xl font-black text-slate-900 mb-6 tracking-tight">Quick Document Helper</h2>
                    <p className="text-slate-500 mb-6 text-lg font-medium leading-relaxed">Drop your photos here to help flatten and clean them up for reading or sharing.</p>
                            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-12 italic opacity-60">(Batch limit: {BATCH_LIMIT} images per session)</p>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" multiple className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="w-full bg-blue-600 text-white font-black py-6 rounded-3xl shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all text-xl tracking-tight">Open Photos</button>
                </div>
                </div>
            )}

            {step === 'EDIT' && currentImage && (
                <ScannerEditor 
                imageSrc={currentImage.src} 
                initialPoints={currentImage.points}
                initialMode={currentImage.mode}
                scale={editorScale}
                onScaleChange={setEditorScale}
                initialRotation={(currentImage.configs && currentImage.configs[0] && typeof currentImage.configs[0].rotation === 'number') ? currentImage.configs[0].rotation : (lastUsedConfigs[0]?.rotation || 0)}
                onRotationChange={(rot) => {
                    setLastUsedConfigs(prev => prev.map(c => ({ ...c, rotation: rot })));
                }}
                onModeChange={(newMode) => {
                    setQueue(prev => {
                        const next = [...prev];
                        if (next[currentIndex]) next[currentIndex] = { ...next[currentIndex], mode: newMode };
                        return next;
                    });
                }}
                onPointsChange={(pts) => {
                    setQueue(prev => {
                        const next = [...prev];
                        if (next[currentIndex]) next[currentIndex] = { ...next[currentIndex], points: pts };
                        return next;
                    });
                    setLastUsedPoints(pts);
                }}
                flashKey={presetFlashKey}
                onProcess={handleProcess} 
                onCancel={requestAbortSession} 
                />
            )}

            {step === 'RESULT' && currentImage && currentImage.results.length > 0 && (
                <ResultView 
                imageSrc={currentImage.src}
                points={currentImage.points}
                mode={currentImage.mode}
                initialConfigs={currentImage.configs}
                initialResults={currentImage.results} 
                normalizationSize={normalization}
                onUpdateResults={handleUpdateResults}
                />
            )}

            {step === 'RESULT' && currentImage && currentImage.results.length > 0 && (
                <div className="flex flex-col sm:flex-row justify-center items-center gap-6 pt-12 border-t border-slate-200 pb-20">
                    <button onClick={() => setStep('EDIT')} className="px-10 py-5 bg-white text-slate-800 border-2 border-slate-900 font-black uppercase text-xs rounded-2xl tracking-widest hover:bg-slate-50">Adjust Corners</button>
                    <button onClick={continueScanning} className="px-20 py-5 bg-slate-900 text-white font-black uppercase text-xs rounded-2xl tracking-[0.3em] shadow-2xl hover:bg-blue-600 transition-all flex items-center gap-4">
                        {currentIndex < queue.length - 1 ? 'Next Photo →' : 'Done'}
                    </button>
                </div>
            )}
            </div>
        </main>

        {isProcessing && (
            <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-2xl flex flex-col items-center justify-center z-[100]">
            <div className="w-24 h-24 border-[8px] border-blue-600 border-t-transparent rounded-full animate-spin mb-8"></div>
            <p className="text-white font-black uppercase tracking-[0.5em] text-sm">Thinking...</p>
            </div>
        )}

        {isExporting && (
            <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-2xl flex flex-col items-center justify-center z-[200]">
            <div className="w-24 h-24 border-[8px] border-green-500 border-t-transparent rounded-full animate-spin mb-8"></div>
            <p className="text-white font-black uppercase tracking-[0.2em] text-sm mb-2">Exporting</p>
            <p className="text-slate-400 font-medium text-xs tracking-widest animate-pulse">{exportProgress}</p>
            </div>
        )}

        {toast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[250]">
                <div className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-2xl border border-slate-700">
                    {toast.text}
                </div>
            </div>
        )}

        {showExportSettings && !isExporting && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[150] flex items-center justify-center p-4 animation-in fade-in duration-200">
                <div className="bg-white rounded-3xl p-10 max-w-md w-full shadow-2xl text-center border border-slate-200">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 mb-2">Download Images</h3>
                    <p className="text-slate-500 mb-6 font-medium text-sm">Select a page size format to apply to all images in the export.</p>
                    
                    {/* Export Format Selection */}
                    <div className="mb-6">
                        <label className="block text-xs font-black uppercase text-slate-400 mb-3 tracking-widest">Format</label>
                        <div className="flex gap-2 justify-center">
                            <button
                                onClick={() => setExportFormat('jpg')}
                                className={`px-6 py-3 rounded-xl font-black text-xs uppercase transition-all ${
                                    exportFormat === 'jpg' 
                                        ? 'bg-blue-600 text-white shadow-lg' 
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >JPG</button>
                            <button
                                onClick={() => setExportFormat('png')}
                                className={`px-6 py-3 rounded-xl font-black text-xs uppercase transition-all ${
                                    exportFormat === 'png' 
                                        ? 'bg-blue-600 text-white shadow-lg' 
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                            >PNG</button>
                        </div>
                    </div>
                    
                    {/* JPEG Quality Slider */}
                    {exportFormat === 'jpg' && (
                        <div className="mb-6">
                            <label className="block text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">
                                JPEG Quality: {Math.round(jpegQuality * 100)}%
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="1.0"
                                step="0.05"
                                value={jpegQuality}
                                onChange={(e) => setJpegQuality(parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                            />
                            <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase mt-1">
                                <span>Smaller</span>
                                <span>Better</span>
                            </div>
                        </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-3 mb-8">
                        {['NONE', 'A4', 'A3', 'A5'].map(sz => (
                            <button
                                key={sz}
                                onClick={() => performBatchExport(sz)}
                                className="py-4 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-2xl transition-all group"
                            >
                                <span className="block text-xl font-black text-slate-700 group-hover:text-blue-600 mb-1">{sz === 'NONE' ? 'Original' : sz}</span>
                                <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">{sz === 'NONE' ? 'No Resize' : 'Standard'}</span>
                            </button>
                        ))}
                    </div>
                    
                    <button onClick={() => setShowExportSettings(false)} className="text-slate-400 text-xs font-bold uppercase tracking-widest hover:text-slate-600">Cancel</button>
                </div>
            </div>
        )}

        {showExitConfirm && (
            <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-md z-[150] flex items-center justify-center p-4 animation-in fade-in duration-200">
                <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center border border-slate-200 scale-100 transform transition-all">
                    <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </div>
                    <h3 className="text-xl font-black text-slate-900 mb-2">Discard Session?</h3>
                    <p className="text-slate-500 mb-8 font-medium text-sm leading-relaxed">This will delete all scanned pages and reset the app. Are you sure?</p>
                    <div className="flex flex-col gap-3">
                        <button onClick={confirmAbortSession} className="w-full py-3.5 bg-red-500 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-200">Yes, Discard All</button>
                        <button onClick={() => setShowExitConfirm(false)} className="w-full py-3.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-colors">Cancel</button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
};