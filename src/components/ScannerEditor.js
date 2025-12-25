// ---------------------------------------------------------
// ScannerEditor Component
// ---------------------------------------------------------
const PADDING_RATIO = 0.10; 

window.ScannerEditor = ({ 
    imageSrc, 
    initialPoints, 
    initialMode = 'SINGLE', 
    scale,
    onScaleChange,
    initialRotation = 0,
    onRotationChange,
    onProcess, 
    onCancel 
}) => {
    const { useRef, useState, useEffect, useCallback } = window.React;
    const { ZoomIn, ZoomOut, RotateCcw } = window.lucideReact || {};

    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    
    const [points, setPoints] = useState(initialPoints && initialPoints.length > 0 ? initialPoints : []);
    const [mode, setMode] = useState(initialMode);
    const [imgElement, setImgElement] = useState(null);
    const [rotation, setRotation] = useState(initialRotation || 0);
    
    const [draggingIdx, setDraggingIdx] = useState(null);

    const labelsMap = {
        SINGLE: ["Top-Left", "Top-Right", "Bottom-Right", "Bottom-Left"],
        DOUBLE: ["Left TL", "Spine Top", "Right TR", "Right BR", "Spine Bottom", "Left BL"]
    };

    const currentLabels = labelsMap[mode];
    const maxPoints = currentLabels.length;

    useEffect(() => {
        const img = new Image();
        img.onload = () => {
        setImgElement(img);
        if (points.length !== maxPoints) {
            const defaultPoints = mode === 'SINGLE' 
                ? [{x:0.1,y:0.1}, {x:0.9,y:0.1}, {x:0.9,y:0.9}, {x:0.1,y:0.9}]
                : [{x:0.1,y:0.1}, {x:0.5,y:0.1}, {x:0.9,y:0.1}, {x:0.9,y:0.9}, {x:0.5,y:0.9}, {x:0.1,y:0.9}];
            setPoints(defaultPoints);
        }
        };
        img.src = imageSrc;
    }, [imageSrc, mode, maxPoints]);

    useEffect(() => {
        const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            onProcess(points, mode, rotation);
        }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onProcess, points, mode, rotation]);

    useEffect(() => {
        if (typeof onRotationChange === 'function') {
            onRotationChange(rotation);
        }
    }, [rotation]);

    const getRotatedDimensions = (w, h, rot) => {
        const r = (rot % 360 + 360) % 360;
        if (r === 90 || r === 270) return { w: h, h: w };
        return { w, h };
    };

    const getCanvasCoords = useCallback(() => {
        if (!imgElement || !canvasRef.current) return { offsetX: 0, offsetY: 0, displayW: 0, displayH: 0, drawW: 0, drawH: 0 };
        const canvas = canvasRef.current;
        
        const container = containerRef.current;
        if (!container) return { offsetX: 0, offsetY: 0, displayW: 0, displayH: 0, drawW: 0, drawH: 0 };

        const baseW = container.clientWidth; 
        const baseH = window.innerHeight * 0.85;

        const scaledMaxWidth = baseW * scale;
        const scaledMaxHeight = baseH * scale;

        const naturalW = imgElement.width;
        const naturalH = imgElement.height;
        const { w: rotW, h: rotH } = getRotatedDimensions(naturalW, naturalH, rotation);

        const imgRatio = rotW / rotH;
        
        let displayW = rotW;
        let displayH = rotH;
        
        const availableW = scaledMaxWidth * (1 - PADDING_RATIO * 2);
        const availableH = scaledMaxHeight * (1 - PADDING_RATIO * 2);

        if (displayW > availableW) { displayW = availableW; displayH = displayW / imgRatio; }
        if (displayH > availableH) { displayH = availableH; displayW = displayH * imgRatio; }
        
        const canvasW = displayW / (1 - PADDING_RATIO * 2);
        const canvasH = displayH / (1 - PADDING_RATIO * 2);
        const offsetX = (canvasW - displayW) / 2;
        const offsetY = (canvasH - displayH) / 2;

        const scaleFactor = displayW / rotW;
        const drawW = naturalW * scaleFactor;
        const drawH = naturalH * scaleFactor;

        return { offsetX, offsetY, displayW, displayH, canvasW, canvasH, drawW, drawH };
    }, [imgElement, scale, rotation]);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imgElement) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { offsetX, offsetY, displayW, displayH, canvasW, canvasH, drawW, drawH } = getCanvasCoords();

        if (canvas.width !== Math.floor(canvasW) || canvas.height !== Math.floor(canvasH)) {
            canvas.width = canvasW;
            canvas.height = canvasH;
        }
        
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvasW, canvasH);
        
        // Draw Image Rotated
        ctx.save();
        ctx.translate(canvasW / 2, canvasH / 2);
        ctx.rotate(rotation * Math.PI / 180);
        
        ctx.shadowBlur = 40;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.drawImage(imgElement, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.shadowBlur = 0;
        ctx.restore();

        // Helper to transform points from Image Space (0..1) to Canvas Space
        const rad = rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        
        const imgToCanvas = (p) => {
            // Point in rotated space relative to center
            // p is 0..1 relative to UNROTATED image
            // Center of unrotated image is (0.5, 0.5)
            // Vector from center: (p.x - 0.5) * drawW, (p.y - 0.5) * drawH
            
            const vx = (p.x - 0.5) * drawW;
            const vy = (p.y - 0.5) * drawH;
            
            // Rotate vector
            const rx = vx * cos - vy * sin;
            const ry = vx * sin + vy * cos;
            
            // Add center of canvas
            return { x: canvasW/2 + rx, y: canvasH/2 + ry };
        };

        if (points.length === maxPoints) {
            ctx.beginPath();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 8]);
            const dp = points.map(imgToCanvas);
            if (mode === 'SINGLE') {
                ctx.moveTo(dp[0].x, dp[0].y);
                for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i].x, dp[i].y);
                ctx.closePath();
            } else {
                ctx.moveTo(dp[0].x, dp[0].y);
                for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i].x, dp[i].y);
                ctx.closePath();
                ctx.stroke();
                ctx.beginPath(); ctx.setLineDash([]); ctx.strokeStyle = '#eab308';
                ctx.lineWidth = 4;
                ctx.moveTo(dp[1].x, dp[1].y); ctx.lineTo(dp[4].x, dp[4].y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }

        points.forEach((p, i) => {
            const cp = imgToCanvas(p);
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, i === draggingIdx ? 20 : 16, 0, Math.PI * 2);
            ctx.fillStyle = i === draggingIdx ? '#fbbf24' : '#3b82f6';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.stroke();
            
            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((i+1).toString(), cp.x, cp.y);
        });

    }, [imgElement, points, draggingIdx, mode, maxPoints, scale, rotation, getCanvasCoords]);

    useEffect(() => { draw(); }, [draw]);

    const handleMouseDown = (e) => {
        const canvas = canvasRef.current;
        if (!canvas || !imgElement) return;
        const { canvasW, canvasH, drawW, drawH } = getCanvasCoords();
        const rect = canvas.getBoundingClientRect();
        
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);
        
        const rad = rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        
        const imgToCanvas = (p) => {
            const vx = (p.x - 0.5) * drawW;
            const vy = (p.y - 0.5) * drawH;
            const rx = vx * cos - vy * sin;
            const ry = vx * sin + vy * cos;
            return { x: canvasW/2 + rx, y: canvasH/2 + ry };
        };
        
        const idx = points.findIndex(p => {
            const cp = imgToCanvas(p);
            return Math.hypot(cp.x - mx, cp.y - my) < 30;
        });
        
        if (idx !== -1) setDraggingIdx(idx);
    };

    const handleMouseMove = (e) => {
        if (!canvasRef.current || !imgElement) return;
        const { canvasW, canvasH, drawW, drawH } = getCanvasCoords();
        const rect = canvasRef.current.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
        const my = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);

        if (draggingIdx !== null) {
            const rx = mx - canvasW/2;
            const ry = my - canvasH/2;
            
            const rad = -rotation * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            
            const vx = rx * cos - ry * sin;
            const vy = rx * sin + ry * cos;
            
            const nx = vx / drawW + 0.5;
            const ny = vy / drawH + 0.5;

            const newPoints = [...points];
            newPoints[draggingIdx] = { x: nx, y: ny };
            setPoints(newPoints);
        }
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
        <div className="bg-white p-6 md:p-8 rounded-[2.5rem] shadow-2xl border border-slate-200">
            <div className="flex flex-wrap items-center justify-between mb-6 gap-6">
            <div className="flex items-center gap-4">
                <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Editor Controls</span>
            </div>

            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
                    <button onClick={() => onScaleChange(Math.max(0.25, scale - 0.25))} className="p-2.5 hover:bg-white hover:text-blue-600 rounded-xl transition-all text-slate-500">
                        {ZoomOut ? <ZoomOut size={16} strokeWidth={3} /> : <span>-</span>}
                    </button>
                    <span className="w-12 text-center text-[10px] font-black text-slate-700">{Math.round(scale * 100)}%</span>
                    <button onClick={() => onScaleChange(Math.min(3, scale + 0.25))} className="p-2.5 hover:bg-white hover:text-blue-600 rounded-xl transition-all text-slate-500">
                        {ZoomIn ? <ZoomIn size={16} strokeWidth={3} /> : <span>+</span>}
                    </button>
                    <div className="w-px h-4 bg-slate-300 mx-1"></div>
                    <button onClick={() => setRotation(r => (r + 90) % 360)} className="p-2.5 hover:bg-white hover:text-blue-600 rounded-xl transition-all text-slate-500">
                        {RotateCcw ? <RotateCcw size={16} strokeWidth={3} /> : <span>R</span>}
                    </button>
                </div>
                
                <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
                    {['SINGLE', 'DOUBLE'].map(m => (
                    <button key={m} onClick={() => setMode(m)} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${mode === m ? 'bg-white shadow-md text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>{m} Page</button>
                    ))}
                </div>
            </div>
            </div>

            {/* Scrollable container */}
            <div ref={containerRef} className="custom-scrollbar relative bg-[#0f172a] rounded-[2.5rem] overflow-auto flex items-start justify-center min-h-[600px] border border-slate-800 shadow-inner max-h-[75vh]">
            <canvas 
                ref={canvasRef} 
                onMouseDown={handleMouseDown} 
                onMouseMove={handleMouseMove} 
                onMouseUp={() => { setDraggingIdx(null); }} 
                className="cursor-crosshair block"
            />
            
            {imgElement && (
                <div className="absolute top-6 left-6 z-20 bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10 flex items-center gap-3 sticky">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                <span className="text-white text-[11px] font-black uppercase tracking-widest">
                    {imgElement.naturalWidth} × {imgElement.naturalHeight} px
                </span>
                </div>
            )}

            <div className="fixed bottom-12 left-1/2 -translate-x-1/2 pointer-events-none z-30">
                <span className="bg-blue-600/20 backdrop-blur-md text-blue-100 px-5 py-2 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-blue-400/20 shadow-xl">
                Drag corners to frame the document
                </span>
            </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <button type="button" onClick={onCancel} className="px-8 py-4 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition-colors">Cancel Batch</button>
            <div className="flex gap-4 w-full sm:w-auto">
                <button type="button" onClick={() => setPoints([])} className="flex-1 sm:flex-none px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200">Reset</button>
                <button type="button" onClick={() => onProcess(points, mode, rotation)} className="flex-1 sm:flex-none px-12 py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all">Process Scan</button>
            </div>
            </div>
        </div>
        </div>
    );
};