class CanvasEditor {
    constructor() {
        this.canvas = null;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;
        this.isCropMode = false;
        this.cropRect = null;
        this.cropTarget = null;
        this.mediaObjects = new Map();
        this.videoAnimFrames = new Map();
        this.gifData = new Map();
        this.selectedObject = null;
        this.sidebarVisible = false;
        this.sidebarHideTimer = null;
        this.toolbarHideTimer = null;
        this.toolbarIdleMs = 1800;
        this.toolbarPinnedVisible = false;

        this.MIN_ZOOM = 0.02;
        this.MAX_ZOOM = 20;

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupCanvasEvents();
        this.setupCropOnScale();
        this.setupToolbar();
        this.setupToolbarAutohide();
        this.setupABLoopControls();
        this.setupGifControls();
        this.setupVideoScrubControls();
        this.setupSidebarHover();
        this.loadFromQueryParams();
    }

    // ==================== Canvas Setup ====================

    setupCanvas() {
        const wrapper = document.getElementById('canvas-wrapper');
        const c = document.getElementById('fabric-canvas');
        c.width = wrapper.clientWidth;
        c.height = wrapper.clientHeight;

        this.canvas = new fabric.Canvas('fabric-canvas', {
            selection: true,
            preserveObjectStacking: true,
            backgroundColor: '#1a1a1a'
        });

        window.addEventListener('resize', () => {
            this.canvas.setDimensions({
                width: wrapper.clientWidth,
                height: wrapper.clientHeight
            });
            this.canvas.requestRenderAll();
        });
    }

    setupCanvasEvents() {
        const canvas = this.canvas;

        canvas.on('mouse:wheel', (opt) => {
            const e = opt.e;
            e.preventDefault();
            e.stopPropagation();

            if (this.selectedObject && this.isPointerOverObject(this.selectedObject, opt)) {
                const delta = e.deltaY > 0 ? 0.95 : 1.05;
                this.selectedObject.scaleX *= delta;
                this.selectedObject.scaleY *= delta;
                this.selectedObject.setCoords();
                canvas.requestRenderAll();
                this.updateSidebar();
                return;
            }

            const delta = e.deltaY;
            let zoom = canvas.getZoom();
            zoom *= 0.999 ** delta;
            zoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
            canvas.zoomToPoint({ x: e.offsetX, y: e.offsetY }, zoom);
            this.updateZoomLabel();
        });

        canvas.on('mouse:down', (opt) => {
            if (opt.e.button === 1) {
                this.isPanning = true;
                this.lastPanX = opt.e.clientX;
                this.lastPanY = opt.e.clientY;
                canvas.selection = false;
                canvas.setCursor('grabbing');
                opt.e.preventDefault();
                return;
            }

            if (!opt.target && opt.e.button === 0) {
                this.isPanning = true;
                this.lastPanX = opt.e.clientX;
                this.lastPanY = opt.e.clientY;
                canvas.selection = false;
                canvas.setCursor('grabbing');
            }
        });

        canvas.on('mouse:move', (opt) => {
            if (this.isPanning) {
                const dx = opt.e.clientX - this.lastPanX;
                const dy = opt.e.clientY - this.lastPanY;
                const vpt = canvas.viewportTransform;
                vpt[4] += dx;
                vpt[5] += dy;
                canvas.setViewportTransform(vpt);
                this.lastPanX = opt.e.clientX;
                this.lastPanY = opt.e.clientY;
            }
        });

        canvas.on('mouse:up', () => {
            this.isPanning = false;
            canvas.selection = true;
            canvas.setCursor('default');
        });

        canvas.on('mouse:dblclick', (opt) => {
            if (opt.target) {
                opt.target.scaleX = 1;
                opt.target.scaleY = 1;
                opt.target.setCoords();
                canvas.requestRenderAll();
                return;
            }
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            this.updateZoomLabel();
        });

        canvas.on('selection:created', (opt) => this.onSelectionChanged(opt));
        canvas.on('selection:updated', (opt) => this.onSelectionChanged(opt));
        canvas.on('selection:cleared', () => this.onSelectionCleared());

        canvas.on('object:modified', () => this.updateSidebar());
        canvas.on('object:moving', () => this.updateSidebar());
    }

    // ==================== Crop-on-Scale ====================

    setupCropOnScale() {
        this.canvas.on('object:scaling', (opt) => {
            const obj = opt.target;
            if (!obj._canvasMediaType) return;

            const transform = opt.transform;
            const corner = transform?.corner;
            if (!corner || corner === 'mtr') return;

            if (obj._activeCropTransform !== transform) {
                obj._activeCropTransform = transform;
                obj._cropInit = {
                    width: obj.width,
                    height: obj.height,
                    cropX: obj.cropX || 0,
                    cropY: obj.cropY || 0,
                    scaleX: transform.original.scaleX,
                    scaleY: transform.original.scaleY,
                    left: transform.original.left,
                    top: transform.original.top
                };
            }

            const init = obj._cropInit;
            const el = obj.getElement ? obj.getElement() : null;
            const sourceW = el?.naturalWidth || el?.videoWidth || el?.width || (init.cropX + init.width);
            const sourceH = el?.naturalHeight || el?.videoHeight || el?.height || (init.cropY + init.height);

            const intendedVisualW = obj.width * obj.scaleX;
            const intendedVisualH = obj.height * obj.scaleY;

            const affectsX = corner !== 'mt' && corner !== 'mb';
            const affectsY = corner !== 'ml' && corner !== 'mr';
            const isLeft = corner === 'tl' || corner === 'ml' || corner === 'bl';
            const isTop = corner === 'tl' || corner === 'mt' || corner === 'tr';

            let newWidth = affectsX ? intendedVisualW / init.scaleX : init.width;
            let newHeight = affectsY ? intendedVisualH / init.scaleY : init.height;
            let newCropX = init.cropX;
            let newCropY = init.cropY;

            if (affectsX && isLeft) {
                newCropX = init.cropX + (init.width - newWidth);
            }
            if (affectsY && isTop) {
                newCropY = init.cropY + (init.height - newHeight);
            }

            newCropX = Math.max(0, Math.min(newCropX, sourceW - 10));
            newCropY = Math.max(0, Math.min(newCropY, sourceH - 10));
            newWidth = Math.max(10, Math.min(newWidth, sourceW - newCropX));
            newHeight = Math.max(10, Math.min(newHeight, sourceH - newCropY));

            const rightEdge = init.left + init.width * init.scaleX;
            const bottomEdge = init.top + init.height * init.scaleY;

            obj.set({
                width: newWidth,
                height: newHeight,
                cropX: newCropX,
                cropY: newCropY,
                scaleX: init.scaleX,
                scaleY: init.scaleY,
                left: isLeft ? rightEdge - newWidth * init.scaleX : init.left,
                top: isTop ? bottomEdge - newHeight * init.scaleY : init.top
            });
            obj.setCoords();
        });

        this.canvas.on('object:modified', (opt) => {
            if (opt.target) {
                delete opt.target._activeCropTransform;
                delete opt.target._cropInit;
            }
        });
    }

    isPointerOverObject(obj, opt) {
        if (!obj) return false;
        try {
            const pointer = opt.scenePoint || this.canvas.getScenePoint(opt.e);
            return obj.containsPoint(pointer);
        } catch {
            return false;
        }
    }

    updateZoomLabel() {
        const label = document.getElementById('canvas-zoom-label');
        if (label) {
            label.textContent = `${Math.round(this.canvas.getZoom() * 100)}%`;
        }
    }

    // ==================== Toolbar ====================

    setupToolbar() {
        document.getElementById('canvas-reset-view')?.addEventListener('click', () => {
            this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            this.updateZoomLabel();
        });

        document.getElementById('canvas-auto-fill')?.addEventListener('click', () => {
            this.autoFillViewport();
        });

        document.getElementById('canvas-crop-toggle')?.addEventListener('click', () => {
            this.toggleCropMode();
        });

        document.getElementById('canvas-delete-selected')?.addEventListener('click', () => {
            this.deleteSelected();
        });
    }

    getAutoFillTargets() {
        return this.canvas.getObjects().filter((obj) => {
            return obj && (obj._canvasMediaType === 'image' || obj._canvasMediaType === 'gif' || obj._canvasMediaType === 'video');
        });
    }

    autoFillViewport() {
        const targets = this.getAutoFillTargets();
        if (!targets.length) return;

        if (this.isCropMode) {
            this.exitCropMode();
        }

        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        this.updateZoomLabel();

        const canvasW = this.canvas.getWidth();
        const canvasH = this.canvas.getHeight();
        const margin = 28;
        const gap = 12;
        const availableW = Math.max(1, canvasW - margin * 2);
        const availableH = Math.max(1, canvasH - margin * 2);

        if (targets.length === 1) {
            const obj = targets[0];
            const baseW = Math.max(1, obj.width || 1);
            const baseH = Math.max(1, obj.height || 1);
            const fit = Math.min(availableW / baseW, availableH / baseH);
            const signX = (obj.scaleX || 1) < 0 ? -1 : 1;
            const signY = (obj.scaleY || 1) < 0 ? -1 : 1;
            obj.set({
                scaleX: signX * fit,
                scaleY: signY * fit,
                left: margin + (availableW - baseW * fit) / 2,
                top: margin + (availableH - baseH * fit) / 2
            });
            obj.setCoords();
            this.canvas.requestRenderAll();
            this.updateSidebar();
            return;
        }

        const targetRowHeight = Math.max(90, Math.min(260, availableH / Math.max(1, Math.round(Math.sqrt(targets.length)))));
        const items = targets.map((obj) => {
            const baseW = Math.max(1, obj.width || 1);
            const baseH = Math.max(1, obj.height || 1);
            return {
                obj,
                baseW,
                baseH,
                aspect: Math.max(0.05, baseW / baseH)
            };
        });

        const rows = [];
        let currentRow = [];
        let currentAspectSum = 0;

        items.forEach((item) => {
            currentRow.push(item);
            currentAspectSum += item.aspect;
            const estimatedWidth = currentAspectSum * targetRowHeight + gap * (currentRow.length - 1);
            if (estimatedWidth >= availableW && currentRow.length > 1) {
                rows.push(currentRow);
                currentRow = [];
                currentAspectSum = 0;
            }
        });
        if (currentRow.length) rows.push(currentRow);

        const rowHeights = rows.map((row) => {
            const ratioSum = row.reduce((sum, item) => sum + item.aspect, 0);
            const rowGap = gap * (row.length - 1);
            return Math.max(1, (availableW - rowGap) / Math.max(0.05, ratioSum));
        });

        const totalGapY = gap * Math.max(0, rows.length - 1);
        const totalHeight = rowHeights.reduce((sum, h) => sum + h, 0) + totalGapY;
        const verticalScale = totalHeight > availableH ? (availableH / totalHeight) : 1;
        const scaledHeights = rowHeights.map((h) => Math.max(1, h * verticalScale));
        const scaledTotalHeight = scaledHeights.reduce((sum, h) => sum + h, 0) + totalGapY;
        let y = margin + Math.max(0, (availableH - scaledTotalHeight) / 2);

        rows.forEach((row, rowIndex) => {
            const rowHeight = scaledHeights[rowIndex];
            const rowTotalWidth = row.reduce((sum, item) => sum + item.aspect * rowHeight, 0) + gap * Math.max(0, row.length - 1);
            let x = margin + Math.max(0, (availableW - rowTotalWidth) / 2);

            row.forEach((item) => {
                const targetW = rowHeight * item.aspect;
                const uniformScale = targetW / item.baseW;
                const signX = (item.obj.scaleX || 1) < 0 ? -1 : 1;
                const signY = (item.obj.scaleY || 1) < 0 ? -1 : 1;
                item.obj.set({
                    scaleX: signX * uniformScale,
                    scaleY: signY * uniformScale,
                    left: x,
                    top: y
                });
                item.obj.setCoords();
                x += targetW + gap;
            });
            y += rowHeight + gap;
        });

        this.canvas.requestRenderAll();
        this.updateSidebar();
    }

    setupToolbarAutohide() {
        const toolbar = document.getElementById('canvas-toolbar');
        const page = document.getElementById('canvas-page');
        if (!toolbar || !page) return;

        const showToolbar = (sourceEvent = 'unknown') => {
            toolbar.classList.remove('hidden-by-inactivity');
            this.toolbarPinnedVisible = true;
            clearTimeout(this.toolbarHideTimer);
            this.toolbarHideTimer = setTimeout(() => {
                this.toolbarPinnedVisible = false;
                if (!toolbar.matches(':hover')) {
                    toolbar.classList.add('hidden-by-inactivity');
                }
            }, this.toolbarIdleMs);
        };

        const activityEvents = ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart', 'touchmove'];
        activityEvents.forEach((eventName) => {
            window.addEventListener(eventName, () => showToolbar(eventName), { passive: true });
        });

        toolbar.addEventListener('mouseenter', () => {
            toolbar.classList.remove('hidden-by-inactivity');
            clearTimeout(this.toolbarHideTimer);
        });

        toolbar.addEventListener('mouseleave', () => {
            if (!this.toolbarPinnedVisible) {
                toolbar.classList.add('hidden-by-inactivity');
            } else {
                showToolbar('toolbar:mouseleave');
            }
        });

        showToolbar('init');
    }

    // ==================== Load from Query Params ====================

    async loadFromQueryParams() {
        const params = new URLSearchParams(window.location.search);
        const idsParam = params.get('ids');
        if (!idsParam) return;

        const ids = idsParam.split(',').map(Number).filter(n => n > 0);
        if (!ids.length) return;

        try {
            const resp = await fetch(`/api/media/batch?ids=${ids.join(',')}`);
            if (!resp.ok) return;
            const data = await resp.json();
            const items = data.items || [];

            items.forEach((media, i) => {
                const fileUrl = `/api/media/${media.id}/file`;
                const x = 80 + i * 40;
                const y = 80 + i * 40;

                if (media.file_type === 'video') {
                    this.addVideo(fileUrl, media.filename || `Video ${media.id}`, x, y, { mediaId: media.id, mimeType: media.mime_type });
                } else if (media.file_type === 'gif') {
                    this.addGif(fileUrl, media.filename || `GIF ${media.id}`, x, y, { mediaId: media.id });
                } else {
                    this.addImage(fileUrl, media.filename || `Image ${media.id}`, x, y, { mediaId: media.id });
                }
            });

            if (items.length) {
                this.recordCanvasHistory(items.map(media => media.id));
            }
        } catch (err) {
            console.error('Failed to load media from query params:', err);
        }
    }

    /**
     * Log this canvas so it can be reopened later from the Canvas page.
     * Fire-and-forget: a history failure must never break the canvas.
     */
    recordCanvasHistory(mediaIds) {
        fetch('/api/canvas-history', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_ids: mediaIds })
        }).catch(err => console.error('Failed to record canvas history:', err));
    }

    // ==================== Add Image ====================

    addImage(url, name, x, y, opts = {}) {
        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
            const fabricImg = new fabric.FabricImage(imgEl, {
                left: x,
                top: y,
                cornerSize: 10,
                transparentCorners: false,
                borderColor: 'var(--primary-color)',
                cornerColor: 'var(--primary-color)'
            });

            const maxDim = 500;
            if (imgEl.width > maxDim || imgEl.height > maxDim) {
                const scale = maxDim / Math.max(imgEl.width, imgEl.height);
                fabricImg.scaleX = scale;
                fabricImg.scaleY = scale;
            }

            fabricImg._canvasMediaType = 'image';
            fabricImg._canvasMediaName = name;
            fabricImg._canvasMediaId = opts.mediaId || null;

            this.canvas.add(fabricImg);
            this.canvas.requestRenderAll();
            this.mediaObjects.set(fabricImg, { type: 'image', name, url });
            this.updateSidebar();
            this.showSidebar();
        };
        imgEl.src = url;
    }

    // ==================== Add Video ====================

    addVideo(url, name, x, y, opts = {}) {
        const videoEl = document.createElement('video');
        videoEl.crossOrigin = 'anonymous';
        videoEl.muted = true;
        videoEl.defaultMuted = true;
        videoEl.loop = true;
        videoEl.playsInline = true;
        videoEl.autoplay = true;
        videoEl.preload = 'auto';
        videoEl.setAttribute('muted', '');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('autoplay', '');

        if (opts.mimeType) {
            const source = document.createElement('source');
            source.src = url;
            source.type = opts.mimeType;
            videoEl.appendChild(source);
        } else {
            videoEl.src = url;
        }

        videoEl.addEventListener('loadeddata', () => {
            const videoSurface = document.createElement('canvas');
            videoSurface.width = videoEl.videoWidth || 1;
            videoSurface.height = videoEl.videoHeight || 1;
            const videoSurfaceCtx = videoSurface.getContext('2d');
            try {
                videoSurfaceCtx.drawImage(videoEl, 0, 0, videoSurface.width, videoSurface.height);
            } catch (_) { }

            const fabricImg = new fabric.FabricImage(videoSurface, {
                left: x,
                top: y,
                cornerSize: 10,
                transparentCorners: false
            });
            fabricImg.objectCaching = false;

            if ((!fabricImg.width || !fabricImg.height) && videoEl.videoWidth && videoEl.videoHeight) {
                fabricImg.set({ width: videoEl.videoWidth, height: videoEl.videoHeight });
            }

            const maxDim = 500;
            if (videoEl.videoWidth > maxDim || videoEl.videoHeight > maxDim) {
                const scale = maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight);
                fabricImg.scaleX = scale;
                fabricImg.scaleY = scale;
            }

            fabricImg._canvasMediaType = 'video';
            fabricImg._canvasMediaName = name;
            fabricImg._canvasMediaId = opts.mediaId || null;
            fabricImg._videoElement = videoEl;
            fabricImg._videoSurface = videoSurface;
            fabricImg._videoSurfaceCtx = videoSurfaceCtx;
            fabricImg._abLoop = { pointA: null, pointB: null, enabled: false };
            fabricImg._userPaused = false;

            this.canvas.add(fabricImg);
            this.mediaObjects.set(fabricImg, { type: 'video', name, url, videoEl });

            videoEl.play().catch(() => {});

            videoEl.addEventListener('canplay', () => {
                if (videoEl.paused && !fabricImg._userPaused) {
                    videoEl.play().catch(() => {});
                }
            });

            const renderLoop = () => {
                if (!this.canvas.getObjects().includes(fabricImg)) return;

                if ((!fabricImg.width || !fabricImg.height) && videoEl.videoWidth && videoEl.videoHeight) {
                    fabricImg.set({ width: videoEl.videoWidth, height: videoEl.videoHeight });
                }

                if (fabricImg._videoSurface && fabricImg._videoSurfaceCtx && videoEl.readyState >= 2) {
                    try {
                        fabricImg._videoSurfaceCtx.drawImage(
                            videoEl, 0, 0,
                            fabricImg._videoSurface.width, fabricImg._videoSurface.height
                        );
                    } catch (_) { }
                }

                if (!fabricImg._userPaused && videoEl.paused && !videoEl.ended && videoEl.readyState >= 2) {
                    videoEl.play().catch(() => {});
                }

                fabricImg.dirty = true;
                this.canvas.requestRenderAll();

                if (fabricImg._abLoop?.enabled &&
                    fabricImg._abLoop.pointA !== null &&
                    fabricImg._abLoop.pointB !== null) {
                    if (videoEl.currentTime >= fabricImg._abLoop.pointB) {
                        videoEl.currentTime = fabricImg._abLoop.pointA;
                    }
                }

                if (this.selectedObject === fabricImg) {
                    this.updateVideoScrubUI(videoEl);
                }

                this.videoAnimFrames.set(fabricImg, requestAnimationFrame(renderLoop));
            };
            this.videoAnimFrames.set(fabricImg, requestAnimationFrame(renderLoop));

            this.updateSidebar();
            this.showSidebar();
        }, { once: true });
    }

    // ==================== Add GIF ====================

    async waitForGifuct() {
        if (window.gifuctReady) return;
        return new Promise(resolve => {
            window.addEventListener('gifuct-ready', resolve, { once: true });
        });
    }

    async addGif(url, name, x, y, opts = {}) {
        try {
            await this.waitForGifuct();
            const resp = await fetch(url);
            const buff = await resp.arrayBuffer();

            let frames, gifWidth, gifHeight;
            if (typeof parseGIF !== 'undefined' && typeof decompressFrames !== 'undefined') {
                const parsed = parseGIF(buff);
                const raw = decompressFrames(parsed, true);
                gifWidth = raw[0]?.dims?.width || 300;
                gifHeight = raw[0]?.dims?.height || 300;
                frames = this.buildGifFrames(raw, gifWidth, gifHeight);
            } else {
                this.addImage(url, name, x, y, opts);
                return;
            }

            if (!frames.length) {
                this.addImage(url, name, x, y, opts);
                return;
            }

            const offscreen = document.createElement('canvas');
            offscreen.width = gifWidth;
            offscreen.height = gifHeight;
            const ctx = offscreen.getContext('2d');
            ctx.putImageData(frames[0].imageData, 0, 0);

            const fabricImg = new fabric.FabricImage(offscreen, {
                left: x,
                top: y,
                cornerSize: 10,
                transparentCorners: false
            });

            const maxDim = 500;
            if (gifWidth > maxDim || gifHeight > maxDim) {
                const scale = maxDim / Math.max(gifWidth, gifHeight);
                fabricImg.scaleX = scale;
                fabricImg.scaleY = scale;
            }

            fabricImg._canvasMediaType = 'gif';
            fabricImg._canvasMediaName = name;
            fabricImg._canvasMediaId = opts.mediaId || null;
            fabricImg._gifCanvas = offscreen;
            fabricImg._gifCtx = ctx;

            this.canvas.add(fabricImg);
            this.mediaObjects.set(fabricImg, { type: 'gif', name, url });

            const gifState = {
                frames,
                currentFrame: 0,
                playing: true,
                lastFrameTime: performance.now(),
                animId: null
            };
            this.gifData.set(fabricImg, gifState);

            const animate = (now) => {
                if (!this.canvas.getObjects().includes(fabricImg)) return;
                if (!gifState.playing) {
                    gifState.animId = requestAnimationFrame(animate);
                    return;
                }
                const frame = gifState.frames[gifState.currentFrame];
                const delay = frame.delay || 100;
                if (now - gifState.lastFrameTime >= delay) {
                    gifState.currentFrame = (gifState.currentFrame + 1) % gifState.frames.length;
                    const nextFrame = gifState.frames[gifState.currentFrame];
                    ctx.putImageData(nextFrame.imageData, 0, 0);
                    fabricImg.setElement(offscreen);
                    fabricImg.dirty = true;
                    this.canvas.requestRenderAll();
                    gifState.lastFrameTime = now;

                    if (this.selectedObject === fabricImg) {
                        this.updateGifScrubUI(gifState);
                    }
                }
                gifState.animId = requestAnimationFrame(animate);
            };
            gifState.animId = requestAnimationFrame(animate);

            this.updateSidebar();
            this.showSidebar();
        } catch (err) {
            console.warn('GIF parsing failed, falling back to static image', err);
            this.addImage(url, name, x, y, opts);
        }
    }

    buildGifFrames(rawFrames, width, height) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        return rawFrames.map(frame => {
            const dims = frame.dims;
            if (!frame.disposalType || frame.disposalType === 0 || frame.disposalType === 1) {
                // draw on top
            } else if (frame.disposalType === 2) {
                tempCtx.clearRect(0, 0, width, height);
            }

            const frameImageData = tempCtx.createImageData(dims.width, dims.height);
            frameImageData.data.set(frame.patch);
            tempCtx.putImageData(frameImageData, dims.left, dims.top);

            const fullImageData = tempCtx.getImageData(0, 0, width, height);
            return {
                imageData: fullImageData,
                delay: frame.delay >= 20 ? frame.delay : 100
            };
        });
    }

    // ==================== Selection Events ====================

    onSelectionChanged(opt) {
        const obj = opt.selected?.[0];
        this.selectedObject = obj || null;

        const deleteBtn = document.getElementById('canvas-delete-selected');
        if (deleteBtn) deleteBtn.style.display = this.selectedObject ? '' : 'none';

        this.hideAllMediaControls();

        if (!obj) return;

        if (obj._canvasMediaType === 'video') {
            this.showABControls(obj);
        } else if (obj._canvasMediaType === 'gif') {
            this.showGifControls(obj);
        }

        this.highlightSidebarLayer(obj);
    }

    onSelectionCleared() {
        this.selectedObject = null;
        document.getElementById('canvas-delete-selected').style.display = 'none';
        this.hideAllMediaControls();
        this.highlightSidebarLayer(null);

        if (this.isCropMode) {
            this.exitCropMode();
        }
    }

    hideAllMediaControls() {
        document.getElementById('canvas-ab-controls').style.display = 'none';
        document.getElementById('canvas-gif-controls').style.display = 'none';
    }

    deleteSelected() {
        const active = this.canvas.getActiveObject();
        if (!active) return;

        const objs = active.type === 'activeselection'
            ? active.getObjects().slice()
            : [active];

        objs.forEach(obj => this.removeObject(obj));
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
        this.updateSidebar();
    }

    removeObject(obj) {
        const animFrame = this.videoAnimFrames.get(obj);
        if (animFrame) {
            cancelAnimationFrame(animFrame);
            this.videoAnimFrames.delete(obj);
        }

        const gifState = this.gifData.get(obj);
        if (gifState?.animId) {
            cancelAnimationFrame(gifState.animId);
        }
        this.gifData.delete(obj);

        if (obj._videoElement) {
            obj._videoElement.pause();
            obj._videoElement.src = '';
        }

        this.mediaObjects.delete(obj);
        this.canvas.remove(obj);
    }

    // ==================== Video A/B Loop ====================

    setupABLoopControls() {
        document.getElementById('canvas-set-a')?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            obj._abLoop.pointA = obj._videoElement.currentTime;
            this.updateABLabel(obj);
            if (obj._abLoop.enabled) this.applyVideoABLoop(obj);
        });

        document.getElementById('canvas-set-b')?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            obj._abLoop.pointB = obj._videoElement.currentTime;
            if (obj._abLoop.pointA !== null && obj._abLoop.pointB <= obj._abLoop.pointA) {
                obj._abLoop.pointB = obj._abLoop.pointA + 0.1;
            }
            this.updateABLabel(obj);
            if (obj._abLoop.enabled) this.applyVideoABLoop(obj);
        });

        document.getElementById('canvas-toggle-loop')?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            obj._abLoop.enabled = !obj._abLoop.enabled;
            const btn = document.getElementById('canvas-toggle-loop');
            btn.textContent = obj._abLoop.enabled ? 'Loop: On' : 'Loop: Off';

            if (obj._abLoop.enabled) {
                obj._videoElement.loop = false;
                this.applyVideoABLoop(obj);
            } else {
                obj._videoElement.loop = true;
            }
        });
    }

    showABControls(obj) {
        const controls = document.getElementById('canvas-ab-controls');
        controls.style.display = 'flex';
        const btn = document.getElementById('canvas-toggle-loop');
        btn.textContent = obj._abLoop?.enabled ? 'Loop: On' : 'Loop: Off';
        this.updateABLabel(obj);

        const videoEl = obj._videoElement;
        const scrub = document.getElementById('canvas-video-scrub');
        const playPause = document.getElementById('canvas-video-play-pause');
        const muteToggle = document.getElementById('canvas-video-mute-toggle');
        const timeLabel = document.getElementById('canvas-video-time-label');

        if (scrub && videoEl) {
            const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
            scrub.max = duration;
            scrub.value = videoEl.currentTime;
        }
        if (playPause && videoEl) {
            playPause.textContent = videoEl.paused ? 'Play' : 'Pause';
        }
        if (muteToggle && videoEl) {
            muteToggle.textContent = videoEl.muted ? 'Unmute' : 'Mute';
        }
        if (timeLabel && videoEl) {
            const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
            timeLabel.textContent = `${this.formatTime(videoEl.currentTime)} / ${this.formatTime(duration)}`;
        }
    }

    updateABLabel(obj) {
        const label = document.getElementById('canvas-ab-label');
        if (!label) return;
        const a = obj._abLoop.pointA !== null ? obj._abLoop.pointA.toFixed(1) + 's' : '--';
        const b = obj._abLoop.pointB !== null ? obj._abLoop.pointB.toFixed(1) + 's' : '--';
        label.textContent = `A: ${a}  B: ${b}`;
    }

    applyVideoABLoop(obj) {
        // The rAF render loop already checks and applies the loop
    }

    // ==================== Video Scrub ====================

    setupVideoScrubControls() {
        const scrub = document.getElementById('canvas-video-scrub');
        const playPause = document.getElementById('canvas-video-play-pause');
        const muteToggle = document.getElementById('canvas-video-mute-toggle');

        scrub?.addEventListener('mousedown', () => { this._videoScrubbing = true; });
        scrub?.addEventListener('touchstart', () => { this._videoScrubbing = true; }, { passive: true });
        scrub?.addEventListener('mouseup', () => { this._videoScrubbing = false; });
        scrub?.addEventListener('touchend', () => { this._videoScrubbing = false; });

        scrub?.addEventListener('input', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            const videoEl = obj._videoElement;
            if (!videoEl) return;
            videoEl.currentTime = parseFloat(scrub.value);
        });

        playPause?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            const videoEl = obj._videoElement;
            if (!videoEl) return;
            if (videoEl.paused) {
                obj._userPaused = false;
                videoEl.play().catch(() => {});
                playPause.textContent = 'Pause';
            } else {
                obj._userPaused = true;
                videoEl.pause();
                playPause.textContent = 'Play';
            }
        });

        muteToggle?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'video') return;
            const videoEl = obj._videoElement;
            if (!videoEl) return;
            videoEl.muted = !videoEl.muted;
            muteToggle.textContent = videoEl.muted ? 'Unmute' : 'Mute';
        });
    }

    updateVideoScrubUI(videoEl) {
        const scrub = document.getElementById('canvas-video-scrub');
        const label = document.getElementById('canvas-video-time-label');
        if (!scrub || !label) return;
        const controls = document.getElementById('canvas-ab-controls');
        if (controls.style.display === 'none') return;

        const duration = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
        if (parseFloat(scrub.max) !== duration) {
            scrub.max = duration;
        }
        if (!this._videoScrubbing) {
            scrub.value = videoEl.currentTime;
        }
        label.textContent = `${this.formatTime(videoEl.currentTime)} / ${this.formatTime(duration)}`;
    }

    formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    // ==================== GIF Scrub ====================

    setupGifControls() {
        const scrub = document.getElementById('canvas-gif-scrub');
        const playPause = document.getElementById('canvas-gif-play-pause');

        scrub?.addEventListener('input', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'gif') return;
            const gifState = this.gifData.get(obj);
            if (!gifState) return;

            const frameIdx = parseInt(scrub.value, 10);
            gifState.currentFrame = Math.min(frameIdx, gifState.frames.length - 1);
            const frame = gifState.frames[gifState.currentFrame];
            obj._gifCtx.putImageData(frame.imageData, 0, 0);
            obj.setElement(obj._gifCanvas);
            obj.dirty = true;
            this.canvas.requestRenderAll();
            this.updateGifScrubUI(gifState);
        });

        playPause?.addEventListener('click', () => {
            const obj = this.selectedObject;
            if (!obj || obj._canvasMediaType !== 'gif') return;
            const gifState = this.gifData.get(obj);
            if (!gifState) return;
            gifState.playing = !gifState.playing;
            playPause.textContent = gifState.playing ? 'Pause' : 'Play';
        });
    }

    showGifControls(obj) {
        const controls = document.getElementById('canvas-gif-controls');
        controls.style.display = 'flex';
        const gifState = this.gifData.get(obj);
        if (!gifState) return;
        const scrub = document.getElementById('canvas-gif-scrub');
        scrub.max = gifState.frames.length - 1;
        scrub.value = gifState.currentFrame;
        const playPause = document.getElementById('canvas-gif-play-pause');
        playPause.textContent = gifState.playing ? 'Pause' : 'Play';
        this.updateGifScrubUI(gifState);
    }

    updateGifScrubUI(gifState) {
        const scrub = document.getElementById('canvas-gif-scrub');
        const label = document.getElementById('canvas-gif-frame-label');
        if (scrub && document.getElementById('canvas-gif-controls').style.display !== 'none') {
            scrub.value = gifState.currentFrame;
        }
        if (label) {
            label.textContent = `${gifState.currentFrame + 1} / ${gifState.frames.length}`;
        }
    }

    // ==================== Crop Mode ====================

    toggleCropMode() {
        if (this.isCropMode) {
            this.applyCrop();
        } else {
            this.enterCropMode();
        }
    }

    enterCropMode() {
        const obj = this.selectedObject;
        if (!obj) return;

        this.isCropMode = true;
        this.cropTarget = obj;

        const btn = document.getElementById('canvas-crop-toggle');
        btn.textContent = 'Apply Crop';
        btn.classList.add('btn-primary');
        btn.classList.remove('btn');

        const bound = obj.getBoundingRect();

        this.cropRect = new fabric.Rect({
            left: bound.left + 10,
            top: bound.top + 10,
            width: bound.width - 20,
            height: bound.height - 20,
            fill: 'rgba(255,255,255,0.1)',
            stroke: '#fff',
            strokeWidth: 2,
            strokeDashArray: [5, 5],
            cornerSize: 10,
            transparentCorners: false,
            cornerColor: '#fff',
            hasRotatingPoint: false,
            lockRotation: true
        });

        this.canvas.add(this.cropRect);
        this.canvas.setActiveObject(this.cropRect);
        this.canvas.requestRenderAll();
    }

    applyCrop() {
        if (!this.cropRect || !this.cropTarget) {
            this.exitCropMode();
            return;
        }

        const obj = this.cropTarget;
        const rect = this.cropRect;

        const objBound = obj.getBoundingRect();
        const scaleX = obj.scaleX || 1;
        const scaleY = obj.scaleY || 1;

        const relLeft = (rect.left - objBound.left) / scaleX;
        const relTop = (rect.top - objBound.top) / scaleY;
        const relWidth = (rect.width * (rect.scaleX || 1)) / scaleX;
        const relHeight = (rect.height * (rect.scaleY || 1)) / scaleY;

        const currentCropX = obj.cropX || 0;
        const currentCropY = obj.cropY || 0;

        const el = obj.getElement ? obj.getElement() : null;
        const sourceW = el?.naturalWidth || el?.videoWidth || el?.width || obj.width;
        const sourceH = el?.naturalHeight || el?.videoHeight || el?.height || obj.height;

        const newCropX = Math.max(0, Math.min(currentCropX + relLeft, sourceW - 10));
        const newCropY = Math.max(0, Math.min(currentCropY + relTop, sourceH - 10));
        const newWidth = Math.max(10, Math.min(relWidth, sourceW - newCropX));
        const newHeight = Math.max(10, Math.min(relHeight, sourceH - newCropY));

        obj.set({
            cropX: newCropX,
            cropY: newCropY,
            width: newWidth,
            height: newHeight
        });
        obj.setCoords();

        this.exitCropMode();
        this.canvas.setActiveObject(obj);
        this.canvas.requestRenderAll();
    }

    exitCropMode() {
        this.isCropMode = false;
        this.cropTarget = null;

        if (this.cropRect) {
            this.canvas.remove(this.cropRect);
            this.cropRect = null;
        }

        const btn = document.getElementById('canvas-crop-toggle');
        btn.textContent = 'Crop';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn');

        this.canvas.requestRenderAll();
    }

    // ==================== Layer Sidebar ====================

    setupSidebarHover() {
        const sidebar = document.getElementById('layer-sidebar');
        const trigger = document.getElementById('canvas-page');

        trigger.addEventListener('mousemove', (e) => {
            if (e.clientX <= 12) {
                this.showSidebar();
            }
        });

        sidebar.addEventListener('mouseenter', () => {
            clearTimeout(this.sidebarHideTimer);
            this.sidebarVisible = true;
        });

        sidebar.addEventListener('mouseleave', () => {
            this.sidebarHideTimer = setTimeout(() => {
                this.hideSidebar();
            }, 600);
        });
    }

    showSidebar() {
        const sidebar = document.getElementById('layer-sidebar');
        sidebar.classList.add('visible');
        this.sidebarVisible = true;
        clearTimeout(this.sidebarHideTimer);

        this.sidebarHideTimer = setTimeout(() => {
            if (!sidebar.matches(':hover')) {
                this.hideSidebar();
            }
        }, 3000);
    }

    hideSidebar() {
        const sidebar = document.getElementById('layer-sidebar');
        sidebar.classList.remove('visible');
        this.sidebarVisible = false;
    }

    reorderCanvasObject(obj, newIndex) {
        const canvas = this.canvas;
        if (typeof canvas.moveObjectTo === 'function') {
            canvas.moveObjectTo(obj, newIndex);
            return true;
        }
        if (typeof canvas.moveTo === 'function') {
            canvas.moveTo(obj, newIndex);
            return true;
        }
        return false;
    }

    stepLayerOrder(obj, direction) {
        const canvas = this.canvas;
        if (direction === 'up') {
            if (typeof canvas.bringObjectForward === 'function') {
                canvas.bringObjectForward(obj);
                return true;
            }
            if (typeof canvas.bringForward === 'function') {
                canvas.bringForward(obj);
                return true;
            }
        } else {
            if (typeof canvas.sendObjectBackwards === 'function') {
                canvas.sendObjectBackwards(obj);
                return true;
            }
            if (typeof canvas.sendBackwards === 'function') {
                canvas.sendBackwards(obj);
                return true;
            }
        }
        return false;
    }

    moveLayerOrder(obj, direction) {
        const objects = this.canvas.getObjects().filter(o => o !== this.cropRect);
        const idxBefore = objects.indexOf(obj);
        if (idxBefore < 0) return;

        let moved = this.stepLayerOrder(obj, direction);
        if (!moved) {
            const delta = direction === 'up' ? 1 : -1;
            const newIdx = idxBefore + delta;
            if (newIdx < 0 || newIdx >= objects.length) return;
            moved = this.reorderCanvasObject(obj, newIdx);
        }
        if (!moved) return;

        this.canvas.requestRenderAll();
        this.updateSidebar();
        this.canvas.setActiveObject(obj);
        this.highlightSidebarLayer(obj);
    }

    updateSidebar() {
        const list = document.getElementById('layer-list');
        if (!list) return;

        const objects = this.canvas.getObjects().filter(o => o !== this.cropRect);
        list.innerHTML = '';

        [...objects].reverse().forEach((obj, visualIdx) => {
            const realIdx = objects.length - 1 - visualIdx;
            const entry = document.createElement('div');
            entry.className = 'layer-entry';
            entry.draggable = true;
            entry.dataset.index = realIdx;

            if (obj === this.selectedObject) {
                entry.classList.add('active');
            }

            const typeIcon = this.getTypeIcon(obj._canvasMediaType);
            const name = obj._canvasMediaName || `Layer ${realIdx + 1}`;
            const canMoveUp = realIdx < objects.length - 1;
            const canMoveDown = realIdx > 0;

            entry.innerHTML = `
                <span class="layer-icon">${typeIcon}</span>
                <span class="layer-name" title="${name}">${name}</span>
                <div class="layer-move-btns">
                    <button type="button" class="layer-move-btn" data-dir="up" title="Move layer up" ${canMoveUp ? '' : 'disabled'} aria-label="Move layer up">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                    </button>
                    <button type="button" class="layer-move-btn" data-dir="down" title="Move layer down" ${canMoveDown ? '' : 'disabled'} aria-label="Move layer down">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                </div>
            `;

            entry.addEventListener('click', (e) => {
                if (e.target.closest('.layer-move-btn')) return;
                this.canvas.setActiveObject(obj);
                this.canvas.requestRenderAll();
            });

            entry.querySelectorAll('.layer-move-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (btn.disabled) return;
                    this.moveLayerOrder(obj, btn.dataset.dir);
                });
            });

            entry.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', realIdx.toString());
                entry.classList.add('dragging');
            });

            entry.addEventListener('dragend', () => {
                entry.classList.remove('dragging');
            });

            entry.addEventListener('dragover', (e) => {
                e.preventDefault();
                entry.classList.add('drag-over');
            });

            entry.addEventListener('dragleave', () => {
                entry.classList.remove('drag-over');
            });

            entry.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                entry.classList.remove('drag-over');
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                const toIdx = realIdx;
                if (Number.isNaN(fromIdx) || fromIdx === toIdx) return;

                const currentObjects = this.canvas.getObjects().filter(o => o !== this.cropRect);
                const fromObj = currentObjects[fromIdx];
                if (!fromObj) return;

                const moved = this.reorderCanvasObject(fromObj, toIdx);
                if (!moved) return;

                this.canvas.requestRenderAll();
                this.updateSidebar();
                if (this.selectedObject === fromObj) {
                    this.canvas.setActiveObject(fromObj);
                }
            });

            list.appendChild(entry);
        });
    }

    highlightSidebarLayer(obj) {
        const entries = document.querySelectorAll('.layer-entry');
        entries.forEach(e => e.classList.remove('active'));

        if (!obj) return;
        const objects = this.canvas.getObjects().filter(o => o !== this.cropRect);
        const idx = objects.indexOf(obj);
        if (idx < 0) return;

        const visualIdx = objects.length - 1 - idx;
        if (entries[visualIdx]) {
            entries[visualIdx].classList.add('active');
        }
    }

    getTypeIcon(type) {
        if (type === 'video') {
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
        if (type === 'gif') {
            return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line></svg>';
        }
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.canvasEditor = new CanvasEditor();
});
