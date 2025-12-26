(function() {
    const isOpenCVLoaded = () => {
        return typeof cv !== 'undefined' && cv.Mat !== undefined;
    };

    const waitForOpenCV = () => {
        return new Promise((resolve) => {
            if (isOpenCVLoaded()) {
                resolve();
                return;
            }
            const check = setInterval(() => {
                if (isOpenCVLoaded()) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    };

    const PAGE_DIMENSIONS = {
        'A3': { w: 3508, h: 4961 },
        'A4': { w: 2480, h: 3508 },
        'A5': { w: 1748, h: 2480 },
        'A6': { w: 1240, h: 1748 },
    };

    const applySharpening = (src, intensity) => {
        if (intensity <= 0) return src.clone();
        const blurred = new cv.Mat();
        const sharpened = new cv.Mat();
        const ksize = new cv.Size(5, 5);
        cv.GaussianBlur(src, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);
        cv.addWeighted(src, 1 + intensity, blurred, -intensity, 0, sharpened);
        blurred.delete();
        return sharpened;
    };

    const enhanceMat = (processed, config) => {
        const mode = config.colorMode
            ? config.colorMode
            : (config.isGrayscale ? 'GRAY' : 'BW');

        // Color mode removed: operate only in GRAY/BW

        // GRAY/BW pipeline: start from grayscale
        const gray = new cv.Mat();
        cv.cvtColor(processed, gray, cv.COLOR_RGBA2GRAY);

        if (config.useClahe) {
            const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(gray, gray);
            clahe.delete();
        }

        if (config.denoise > 0) {
            const ksize = (config.denoise * 2) + 1;
            cv.medianBlur(gray, gray, ksize);
        }

        let sharpenedGray = gray;
        if (config.sharpening > 0) {
            sharpenedGray = applySharpening(gray, config.sharpening);
        } else {
            sharpenedGray = gray.clone();
        }

        const output = new cv.Mat();
        if (mode === 'GRAY') {
            sharpenedGray.copyTo(output);
        } else { // BW
            const blockSize = Math.max(3, config.blockSize % 2 === 0 ? config.blockSize + 1 : config.blockSize);
            cv.adaptiveThreshold(
                sharpenedGray,
                output,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                blockSize,
                config.offset
            );
        }

        gray.delete(); sharpenedGray.delete();
        return output;
    };

    const rotateMat = (src, angle) => {
        if (angle === 0) return src.clone();
        
        const dst = new cv.Mat();
        let code;
        
        // Normalize angle to 0, 90, 180, 270
        const normAngle = (angle % 360 + 360) % 360;

        if (normAngle === 90) {
            code = cv.ROTATE_90_CLOCKWISE !== undefined ? cv.ROTATE_90_CLOCKWISE : 0;
        } else if (normAngle === 180) {
            code = cv.ROTATE_180 !== undefined ? cv.ROTATE_180 : 1;
        } else if (normAngle === 270) {
            code = cv.ROTATE_90_COUNTERCLOCKWISE !== undefined ? cv.ROTATE_90_COUNTERCLOCKWISE : 2;
        } else {
            return src.clone();
        }
        
        try {
            cv.rotate(src, dst, code);
        } catch(e) {
            console.error("Rotation failed", e);
            dst.delete();
            return src.clone();
        }
        return dst;
    }

    const calculateTargetDimensions = (quad, imgW, imgH) => {
        const p0 = { x: quad[0].x * imgW, y: quad[0].y * imgH };
        const p1 = { x: quad[1].x * imgW, y: quad[1].y * imgH };
        const p2 = { x: quad[2].x * imgW, y: quad[2].y * imgH };
        const p3 = { x: quad[3].x * imgW, y: quad[3].y * imgH };

        const widthBottom = Math.sqrt(Math.pow(p2.x - p3.x, 2) + Math.pow(p2.y - p3.y, 2));
        const widthTop = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
        const targetWidth = Math.max(widthBottom, widthTop);

        const heightRight = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        const heightLeft = Math.sqrt(Math.pow(p0.x - p3.x, 2) + Math.pow(p0.y - p3.y, 2));
        const targetHeight = Math.max(heightRight, heightLeft);

        return { w: Math.round(targetWidth), h: Math.round(targetHeight) };
    };

    const runPerspectiveWarp = (src, quad, config, normSize) => {
        if (!quad || quad.length < 4) return '';
        
        const { w: geomWidth, h: geomHeight } = calculateTargetDimensions(quad, src.cols, src.rows);
        
        const warpDst = new cv.Mat();
        const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
            quad[0].x * src.cols, quad[0].y * src.rows,
            quad[1].x * src.cols, quad[1].y * src.rows,
            quad[2].x * src.cols, quad[2].y * src.rows,
            quad[3].x * src.cols, quad[3].y * src.rows
        ]);
        const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            geomWidth, 0,
            geomWidth, geomHeight,
            0, geomHeight
        ]);
        
        const M = cv.getPerspectiveTransform(srcCoords, dstCoords);
        const dsize = new cv.Size(geomWidth, geomHeight);
        cv.warpPerspective(src, warpDst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
        
        // 1. Enhance
        const enhanced = enhanceMat(warpDst, config);
        
        // 2. Rotate
        const rotated = rotateMat(enhanced, config.rotation);
        
        let finalMat = rotated;

        // 3. Normalize Size (if requested)
        if (normSize !== 'NONE' && PAGE_DIMENSIONS[normSize]) {
            const target = PAGE_DIMENSIONS[normSize];
            const bgScalar = (rotated.channels && rotated.channels() > 1) ? new cv.Scalar(255, 255, 255, 255) : new cv.Scalar(255);
            const normalizedMat = new cv.Mat(target.h, target.w, rotated.type(), bgScalar);
            
            // Fit rotated mat into target
            const ratio = Math.min(target.w / rotated.cols, target.h / rotated.rows);
            const newW = Math.round(rotated.cols * ratio);
            const newH = Math.round(rotated.rows * ratio);
            
            const resized = new cv.Mat();
            cv.resize(rotated, resized, new cv.Size(newW, newH), 0, 0, cv.INTER_AREA);
            
            const x = Math.floor((target.w - newW) / 2);
            const y = Math.floor((target.h - newH) / 2);
            const roi = normalizedMat.roi(new cv.Rect(x, y, newW, newH));
            resized.copyTo(roi);
            
            rotated.delete();
            resized.delete();
            roi.delete();
            finalMat = normalizedMat;
        }

        const resultCanvas = document.createElement('canvas');
        cv.imshow(resultCanvas, finalMat);
        const dataUrl = resultCanvas.toDataURL('image/png');
        
        warpDst.delete(); srcCoords.delete(); dstCoords.delete(); M.delete(); enhanced.delete();
        if (finalMat !== rotated) finalMat.delete(); 
        if (finalMat === rotated) rotated.delete(); 
        
        return dataUrl;
    };

    const processDocument = async (
        imageElement,
        corners,
        mode,
        configs,
        _unusedRedactions = [], 
        normSize = 'NONE'
    ) => {
        if (!isOpenCVLoaded()) throw new Error("OpenCV not loaded");

        const src = cv.imread(imageElement);
        
        const results = [];

        if (mode === 'SINGLE' && corners.length >= 4) {
            const config = configs[0];
            const res = runPerspectiveWarp(src, corners, config, normSize);
            if (res) results.push(res);
        } else if (mode === 'DOUBLE' && corners.length >= 6) {
            const leftQuad = [corners[0], corners[1], corners[4], corners[5]];
            const rightQuad = [corners[1], corners[2], corners[3], corners[4]];
            const resL = runPerspectiveWarp(src, leftQuad, configs[0], normSize);
            const resR = runPerspectiveWarp(src, rightQuad, configs[1], normSize);
            if (resL) results.push(resL);
            if (resR) results.push(resR);
        }

        src.delete();
        return results;
    };

    const detectDocument = (imageElement, mode = 'SINGLE') => {
        if (!isOpenCVLoaded()) {
            console.log('OpenCV not loaded');
            return null;
        }
        
        try {
            const src = cv.imread(imageElement);
            const gray = new cv.Mat();
            const blurred = new cv.Mat();
            const edges = new cv.Mat();
            
            // Convert to grayscale and blur
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
            
            // Edge detection
            cv.Canny(blurred, edges, 50, 150);
            
            // Find contours
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            console.log('Found contours:', contours.size());
            
            let result = null;
            
            if (mode === 'SINGLE') {
                let bestQuad = null;
                let maxArea = 0;
                const imgArea = src.cols * src.rows;
                const minArea = imgArea * 0.05; // Lowered to 5% instead of 10%
                
                console.log('Image area:', imgArea, 'Min area threshold:', minArea);
                
                // Look for the largest quadrilateral
                for (let i = 0; i < contours.size(); i++) {
                    const contour = contours.get(i);
                    const area = cv.contourArea(contour);
                    
                    // Skip tiny contours early
                    if (area < minArea) {
                        contour.delete();
                        continue;
                    }
                    
                    const peri = cv.arcLength(contour, true);
                    const approx = new cv.Mat();
                    
                    // Try multiple epsilon values for approximation
                    let foundQuad = false;
                    for (const epsilon of [0.02, 0.03, 0.04, 0.05]) {
                        cv.approxPolyDP(contour, approx, epsilon * peri, true);
                        
                        if (approx.rows === 4) {
                            if (area > maxArea) {
                                maxArea = area;
                                
                                // Extract the 4 corners and convert to normalized coordinates
                                const pts = [];
                                for (let j = 0; j < 4; j++) {
                                    pts.push({
                                        x: approx.data32S[j * 2] / src.cols,
                                        y: approx.data32S[j * 2 + 1] / src.rows
                                    });
                                }
                                
                                console.log('Found quadrilateral with epsilon:', epsilon, 'area:', area, 'points:', pts);
                                
                                // Order points: TL, TR, BR, BL
                                // Sort by y-coordinate to get top and bottom pairs
                                pts.sort((a, b) => a.y - b.y);
                                const top = [pts[0], pts[1]].sort((a, b) => a.x - b.x);
                                const bottom = [pts[2], pts[3]].sort((a, b) => a.x - b.x);
                                
                                bestQuad = [
                                    top[0],      // TL
                                    top[1],      // TR
                                    bottom[1],   // BR
                                    bottom[0]    // BL
                                ];
                                foundQuad = true;
                            }
                            break; // Found a quad with this epsilon, no need to try others
                        }
                    }
                    
                    approx.delete();
                    contour.delete();
                }
            
                result = bestQuad;
                console.log('SINGLE mode result:', result, 'Max area found:', maxArea);
            } else if (mode === 'DOUBLE') {
                // For DOUBLE mode, find the largest rectangle and split it down the middle
                let bestQuad = null;
                let maxArea = 0;
                const imgArea = src.cols * src.rows;
                const minArea = imgArea * 0.05;
                
                for (let i = 0; i < contours.size(); i++) {
                    const contour = contours.get(i);
                    const area = cv.contourArea(contour);
                    
                    if (area < minArea) {
                        contour.delete();
                        continue;
                    }
                    
                    const peri = cv.arcLength(contour, true);
                    const approx = new cv.Mat();
                    
                    // Try multiple epsilon values
                    for (const epsilon of [0.02, 0.03, 0.04, 0.05]) {
                        cv.approxPolyDP(contour, approx, epsilon * peri, true);
                        
                        if (approx.rows === 4) {
                            if (area > maxArea) {
                                maxArea = area;
                                
                                const pts = [];
                                for (let j = 0; j < 4; j++) {
                                    pts.push({
                                        x: approx.data32S[j * 2] / src.cols,
                                        y: approx.data32S[j * 2 + 1] / src.rows
                                    });
                                }
                                
                                console.log('DOUBLE mode found quadrilateral with area:', area, 'points:', pts);
                                
                                // Order points: TL, TR, BR, BL
                                pts.sort((a, b) => a.y - b.y);
                                const top = [pts[0], pts[1]].sort((a, b) => a.x - b.x);
                                const bottom = [pts[2], pts[3]].sort((a, b) => a.x - b.x);
                                
                                bestQuad = [
                                    top[0],      // TL
                                    top[1],      // TR
                                    bottom[1],   // BR
                                    bottom[0]    // BL
                                ];
                            }
                            break;
                        }
                    }
                    
                    approx.delete();
                    contour.delete();
                }
                
                if (bestQuad) {
                    // Split the rectangle down the middle to create 6 points for DOUBLE mode
                    const spineTopX = (bestQuad[0].x + bestQuad[1].x) / 2;
                    const spineTopY = (bestQuad[0].y + bestQuad[1].y) / 2;
                    const spineBottomX = (bestQuad[3].x + bestQuad[2].x) / 2;
                    const spineBottomY = (bestQuad[3].y + bestQuad[2].y) / 2;
                    
                    // Return 6 points: Left TL, Spine Top, Right TR, Right BR, Spine Bottom, Left BL
                    result = [
                        bestQuad[0],                                    // Left TL
                        { x: spineTopX, y: spineTopY },                // Spine Top
                        bestQuad[1],                                    // Right TR
                        bestQuad[2],                                    // Right BR
                        { x: spineBottomX, y: spineBottomY },          // Spine Bottom
                        bestQuad[3]                                     // Left BL
                    ];
                    console.log('DOUBLE mode result:', result);
                }
            }
            hierarchy.delete();
            
            console.log('Final result:', result);
            return result;
        } catch (error) {
            console.error('Error in detectDocument:', error);
            return null;
        }
    };

    // Expose to window
    window.opencvService = {
        isOpenCVLoaded,
        waitForOpenCV,
        processDocument,
        detectDocument
    };
})();