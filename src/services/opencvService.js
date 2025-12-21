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
        const gray = new cv.Mat();
        const output = new cv.Mat();
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

        if (config.isGrayscale) {
            sharpenedGray.copyTo(output);
        } else {
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
            const normalizedMat = new cv.Mat(target.h, target.w, cv.CV_8UC1, new cv.Scalar(255));
            
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

    // Expose to window
    window.opencvService = {
        isOpenCVLoaded,
        waitForOpenCV,
        processDocument
    };
})();