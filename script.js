document.addEventListener('DOMContentLoaded', async () => {
  // ==================== DOM Elements ====================
  // --- Camera & Canvas ---
  const cameraFeed = document.getElementById('cameraFeed');
  const photoCanvas = document.getElementById('photoCanvas');
  const canvasContext = photoCanvas.getContext('2d');
  const container = document.querySelector('.container');

  // --- Controls ---
  const shutterButton = document.getElementById('shutterButton');
  const cameraToggleButton = document.getElementById('cameraToggleButton');
  const stampButton = document.getElementById('stampButton');

  // --- Modals ---
  const permissionModal = document.getElementById('permissionModal');
  const permissionMessage = document.getElementById('permissionMessage');
  const permissionImage = document.getElementById('permissionImage');
  const closeModalButton = document.getElementById('closeModalButton');
  const previewModal = document.getElementById('previewModal');
  const previewImage = document.getElementById('previewImage');
  const previewSaveBtn = document.getElementById('previewSaveBtn');
  const previewShareBtn = document.getElementById('previewShareBtn');
  const previewCloseBtn = document.getElementById('previewCloseBtn');
  const previewCloseX = document.getElementById('previewCloseX');

  // --- Frames ---
  const frameTopEl = document.getElementById('frameTop');
  const frameBottomEl = document.getElementById('frameBottom');

  // --- Stamp Sheet & Dial ---
  const stampCanvasEl = document.getElementById('stampCanvas');
  const stampSheet = document.getElementById('stampSheet');
  const stampTabs = document.getElementById('stampTabs');
  const sheetCloseX = document.getElementById('sheetCloseX');
  const actionDial = document.getElementById('stampActionDial');

  // ==================== State Variables ====================
  let stream = null;
  let currentFacingMode = 'environment'; // 'environment' (rear) or 'user' (front)
  let fcanvas = null;
  let isSheetOpen = false;
  let currentStampTab = 'stamp2'; // Default active tab
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;

  // --- Long Press & Flick ---
  let lpTimer = null;
  let lpStartPoint = null;
  let lpTarget = null;
  let dialOpen = false;

  // ==================== Constants ====================
  const LONGPRESS_MS = 450;
  const FLICK_THRESHOLD = 50;

  // ==================== Core Functions ====================

  /**
   * Switches between camera view and photo preview.
   * @param {boolean} isCameraActive - True to show camera feed, false for photo preview.
   */
  const setCameraView = (isCameraActive) => {
    cameraFeed.classList.toggle('hidden', !isCameraActive);
    photoCanvas.classList.toggle('hidden', isCameraActive);
    shutterButton.classList.toggle('hidden', !isCameraActive);
    cameraToggleButton.classList.toggle('hidden', !isCameraActive);
  };

  /**
   * Initializes and starts the camera stream. Handles permissions.
   */
  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: 4096 },
          height: { ideal: 4096 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.width && caps.height) {
        try {
          await track.applyConstraints({
            width: { ideal: caps.width.max },
            height: { ideal: caps.height.max }
          });
        } catch (e) {
          console.warn('applyConstraints skipped:', e);
        }
      }

      cameraFeed.srcObject = stream;
      await cameraFeed.play();

      // Mirror the video for the front camera
      cameraFeed.style.transform = (currentFacingMode === 'user') ? 'scaleX(-1)' : 'none';

      const settings = track.getSettings ? track.getSettings() : {};
      console.log(`Active camera: ${settings.width}x${settings.height}, Facing: ${currentFacingMode}`);

      setCameraView(true);

      // On success, show the initial image and hide any error messages
      if (permissionImage) permissionImage.classList.remove('hidden');
      if (permissionMessage) permissionMessage.classList.add('hidden');

      if (!fcanvas) {
        initFabricCanvas();
      } else {
        resizeStampCanvas();
      }
    } catch (err) {
      console.error('Camera access failed:', err);
      // On failure, hide the image and show a specific error message
      if (permissionImage) permissionImage.classList.add('hidden');
      if (permissionMessage) {
        permissionMessage.classList.remove('hidden');
        permissionMessage.style.textAlign = 'center';
        if (err.name === 'NotAllowedError') {
          permissionMessage.textContent = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
        } else if (err.name === 'NotFoundError') {
          permissionMessage.textContent = 'カメラが見つかりませんでした。';
        } else {
          permissionMessage.textContent = 'カメラへのアクセス中にエラーが発生しました。';
        }
      }
      permissionModal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
  };

  /**
   * Waits for an image element to fully load.
   * @param {HTMLImageElement} el - The image element.
   * @returns {Promise<HTMLImageElement|null>}
   */
  const waitImage = (el) => {
    return new Promise((resolve) => {
      if (!el) return resolve(null);
      if (el.complete && el.naturalWidth) return resolve(el);
      el.addEventListener('load', () => resolve(el), { once: true });
      el.addEventListener('error', () => resolve(null), { once: true });
    });
  };

  /**
   * Ensures both top and bottom frame images are loaded before proceeding.
   */
  const ensureFramesReady = async () => {
    await Promise.all([waitImage(frameTopEl), waitImage(frameBottomEl)]);
  };

  /**
   * Draws the top and bottom frames onto the photo canvas, fitting to width.
   */
  const drawFramesToCanvas = () => {
    const cw = photoCanvas.width;
    const ch = photoCanvas.height;

    const drawOne = (imgEl, place) => {
      if (!imgEl || !imgEl.naturalWidth) return;
      const scale = cw / imgEl.naturalWidth;
      const drawH = Math.round(imgEl.naturalHeight * scale);
      const dy = (place === 'top') ? 0 : (ch - drawH);
      canvasContext.drawImage(imgEl, 0, 0, cw, drawH);
    };

    drawOne(frameTopEl, 'top');
    drawOne(frameBottomEl, 'bottom');
  };

  // ==================== Preview Modal Functions ====================

  /**
   * Displays the final composite image in a preview modal.
   * @param {HTMLCanvasElement} canvas - The canvas with the final image.
   */
  const openPreviewModalWithCanvas = (canvas) => {
    if (lastCaptureObjectURL) URL.revokeObjectURL(lastCaptureObjectURL);

    canvas.toBlob((blob) => {
      lastCaptureBlob = blob;
      lastCaptureObjectURL = URL.createObjectURL(blob);
      previewImage.src = lastCaptureObjectURL;
      previewModal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }, 'image/png');
  };

  /**
   * Closes the preview modal and restarts the camera for a retake.
   */
  const closePreviewModalAndRetake = () => {
    previewModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
      lastCaptureBlob = null;
    }
    startCamera();
  };


  // ==================== Fabric.js Stamp Functions ====================

  /**
   * Initializes the Fabric.js canvas and its event handlers.
   */
  const initFabricCanvas = () => {
    if (fcanvas) return;

    fcanvas = new fabric.Canvas(stampCanvasEl, {
      selection: true,
      preserveObjectStacking: true,
    });
    resizeStampCanvas();

    const canvasContainer = fcanvas.getElement().parentNode;
    if (canvasContainer) {
      canvasContainer.style.zIndex = '7';
    }
    fcanvas.upperCanvasEl.style.touchAction = 'none';
    fcanvas.defaultCursor = 'grab';
    fcanvas.allowTouchScrolling = false;
    fcanvas.targetFindTolerance = 12;

    fabric.Object.prototype.set({
      cornerSize: 26,
      cornerStyle: 'circle',
      cornerColor: '#ff5b82',
      borderColor: '#ff5b82',
      transparentCorners: false,
    });

    _setupGestureControls(fcanvas);
    if (actionDial) {
      _setupLongPressDial(fcanvas);
    }
  };

  /**
   * Sets up two-finger pinch-to-zoom and rotation gestures.
   * @param {fabric.Canvas} canvas
   */
  const _setupGestureControls = (canvas) => {
    let gObj = null, gStart = null;
    const getDist = (a,b) => Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
    const getAngle = (a,b) => Math.atan2(b.clientY-a.clientY, b.clientX-a.clientX);

    canvas.upperCanvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const obj = canvas.getActiveObject();
        if (!obj) return;
        gObj = obj;
        gStart = {
          dist: getDist(e.touches[0], e.touches[1]),
          angle: getAngle(e.touches[0], e.touches[1]),
          scale: obj.scaleX || 1,
          angleDeg: obj.angle || 0
        };
        e.preventDefault();
      }
    }, { passive: false });

    canvas.upperCanvasEl.addEventListener('touchmove', (e) => {
      if (gObj && e.touches.length === 2) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const ang = getAngle(e.touches[0], e.touches[1]);

        const newScale = Math.max(0.1, Math.min(5, gStart.scale * (dist / gStart.dist)));
        gObj.scale(newScale);

        const deltaDeg = (ang - gStart.angle) * (180 / Math.PI);
        gObj.rotate(gStart.angleDeg + deltaDeg);

        gObj.setCoords();
        canvas.requestRenderAll();
      }
    }, { passive: false });

    canvas.upperCanvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length < 2 && gObj) {
        gObj = null;
        gStart = null;
        e.preventDefault();
      }
    }, { passive: false });
  };

  /**
   * Sets up long-press and flick gestures for the action dial.
   * @param {fabric.Canvas} canvas
   */
  const _setupLongPressDial = (canvas) => {
    const showActionDial = (x, y, target) => {
        const containerRect = container.getBoundingClientRect();
        actionDial.style.left = `${x - containerRect.left}px`;
        actionDial.style.top = `${y - containerRect.top}px`;
        actionDial.classList.remove('hidden');
        dialOpen = true;

        const lockBtn = actionDial.querySelector('[data-action="lock-toggle"]');
        if (lockBtn) lockBtn.textContent = target._locked ? 'ロック解除' : 'ロック';
    };

    const hideActionDial = () => {
        if (!dialOpen) return;
        actionDial.classList.add('hidden');
        dialOpen = false;
    };

    const doStampAction = (action, target) => {
      if (!target) return;
      switch (action) {
        case 'delete':      canvas.remove(target); break;
        case 'front':       canvas.bringToFront(target); break;
        case 'back':        canvas.sendToBack(target); break;
        case 'lock-toggle':
          target._locked = !target._locked;
          target.lockMovementX = target.lockMovementY = target._locked;
          target.lockScalingX = target.lockScalingY = target._locked;
          target.lockRotation = target._locked;
          target.hasControls = !target._locked;
          target.opacity = target._locked ? 0.95 : 1;
          break;
      }
      canvas.requestRenderAll();
    };

    canvas.on('mouse:down', (opt) => {
        if (opt.e.touches?.length !== 1 || isSheetOpen) return;
        const target = opt.target;
        if (!target) return;

        lpTarget = target;
        lpStartPoint = { x: opt.e.touches[0].clientX, y: opt.e.touches[0].clientY };
        clearTimeout(lpTimer);
        lpTimer = setTimeout(() => {
            canvas.setActiveObject(lpTarget);
            showActionDial(lpStartPoint.x, lpStartPoint.y, lpTarget);
            lpTimer = null;
        }, LONGPRESS_MS);
    });

    canvas.on('mouse:move', (opt) => {
        if (lpTimer && lpStartPoint) {
            const dx = opt.e.touches[0].clientX - lpStartPoint.x;
            const dy = opt.e.touches[0].clientY - lpStartPoint.y;
            if (Math.hypot(dx, dy) > 10) {
                clearTimeout(lpTimer);
                lpTimer = null;
            }
        }
    });

    canvas.on('mouse:up', (opt) => {
      clearTimeout(lpTimer);
      lpTimer = null;

      if (dialOpen && lpStartPoint && lpTarget) {
          const t = opt.e.changedTouches?.[0];
          if (t) {
              const dx = t.clientX - lpStartPoint.x;
              const dy = t.clientY - lpStartPoint.y;
              if (Math.hypot(dx, dy) >= FLICK_THRESHOLD) {
                  let action = Math.abs(dx) > Math.abs(dy)
                      ? (dx > 0 ? 'delete' : 'lock-toggle')
                      : (dy < 0 ? 'front' : 'back');
                  doStampAction(action, lpTarget);
              }
          }
          hideActionDial();
      }
      lpStartPoint = null;
      lpTarget = null;
    });

    actionDial.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.dial-btn');
        if (btn && lpTarget) {
            doStampAction(btn.dataset.action, lpTarget);
            hideActionDial();
            lpStartPoint = null;
            lpTarget = null;
        }
    });
  };

  /**
   * Resizes the stamp canvas to match the container size and device pixel ratio.
   */
  const resizeStampCanvas = () => {
    if (!stampCanvasEl || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const cssW = Math.round(rect.width);
    const cssH = Math.round(rect.height);

    stampCanvasEl.width = cssW * dpr;
    stampCanvasEl.height = cssH * dpr;
    stampCanvasEl.style.width = `${cssW}px`;
    stampCanvasEl.style.height = `${cssH}px`;

    if (fcanvas) {
      fcanvas.setWidth(cssW);
      fcanvas.setHeight(cssH);
      fcanvas.setZoom(dpr);
      fcanvas.renderAll();
    }
  };

  /**
   * Adds a new stamp to the center of the canvas from a URL.
   * @param {string} url - The URL of the stamp image.
   */
  const addStampFromURL = (url) => {
    if (!fcanvas) return;
    fabric.Image.fromURL(url, (img) => {
      const base = Math.min(fcanvas.getWidth(), fcanvas.getHeight()) * 0.3;
      const scale = base / img.width;

      img.set({
        originX: 'center',
        originY: 'center',
        uniformScaling: true, // Lock aspect ratio on corner scaling
        lockScalingFlip: true,
      });
      img.setControlsVisibility({
        mt: false, mb: false, ml: false, mr: false // Hide side controls
      });
      img.scale(scale);

      fcanvas.add(img);
      fcanvas.viewportCenterObject(img);
      fcanvas.setActiveObject(img);
      fcanvas.renderAll();
      closeStampSheet();
    }, { crossOrigin: 'anonymous' });
  };


  // ==================== Stamp Sheet Functions ====================

  const openStampSheet = () => {
    if (dialOpen) {
      actionDial.classList.add('hidden');
      dialOpen = false;
    }
    stampSheet.classList.add('open');
    container.classList.add('sheet-open');
    isSheetOpen = true;
    activateStampTab(currentStampTab);
  };

  const closeStampSheet = () => {
    stampSheet.classList.remove('open');
    container.classList.remove('sheet-open');
    isSheetOpen = false;
  };

  /**
   * Activates a specific tab in the stamp sheet.
   * @param {string} tabName - The data-tab attribute value of the target tab.
   */
  const activateStampTab = (tabName) => {
    currentStampTab = tabName;
    document.querySelectorAll('#stampTabs .tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    document.querySelectorAll('.stamp-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.tab === tabName);
    });
  };

  // ==================== Event Listeners ====================

  /**
   * Initializes all event listeners for the application.
   */
  const initEventListeners = () => {
    // --- Camera & Controls ---
    cameraToggleButton.addEventListener('click', async () => {
      currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
      await startCamera();
    });

    shutterButton.addEventListener('click', async () => {
      if (!stream || !cameraFeed.srcObject) return;

      // 1. Set canvas dimensions to match the visible video feed
      const cw = cameraFeed.clientWidth;
      const ch = cameraFeed.clientHeight;
      photoCanvas.width = cw;
      photoCanvas.height = ch;

      // 2. Calculate the source rectangle to crop the video (object-fit: cover)
      const vw = cameraFeed.videoWidth;
      const vh = cameraFeed.videoHeight;
      const videoRatio = vw / vh;
      const canvasRatio = cw / ch;
      let sx, sy, sWidth, sHeight;

      if (videoRatio > canvasRatio) { // Video is wider than canvas
        sHeight = vh;
        sWidth = vh * canvasRatio;
        sx = (vw - sWidth) / 2;
        sy = 0;
      } else { // Video is taller or same ratio
        sWidth = vw;
        sHeight = vw / canvasRatio;
        sx = 0;
        sy = (vh - sHeight) / 2;
      }

      // 3. Composite the final image: Camera -> Frames -> Stamps
      canvasContext.setTransform(1, 0, 0, 1, 0, 0);
      canvasContext.clearRect(0, 0, cw, ch);
      
      if (currentFacingMode === 'user') { // Mirror canvas for front camera
          canvasContext.translate(cw, 0);
          canvasContext.scale(-1, 1);
      }
      
      canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, cw, ch);
      canvasContext.setTransform(1, 0, 0, 1, 0, 0); // Reset transform

      await ensureFramesReady();
      drawFramesToCanvas();

      if (fcanvas) {
        fcanvas.discardActiveObject().renderAll(); // Deselect stamp to hide controls
        canvasContext.drawImage(stampCanvasEl, 0, 0, cw, ch);
      }

      // 4. Stop stream and show preview
      stream.getTracks().forEach(t => t.stop());
      setCameraView(false);
      openPreviewModalWithCanvas(photoCanvas);
    });

    // --- Modals ---
    closeModalButton.addEventListener('click', () => {
      permissionModal.style.display = 'none';
      document.body.classList.remove('modal-open');
    });

    previewSaveBtn.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = photoCanvas.toDataURL('image/png');
      a.download = `photo_${Date.now()}.png`;
      a.click();
    });

    previewShareBtn.addEventListener('click', async () => {
      try {
        if (navigator.share && lastCaptureBlob) {
          const file = new File([lastCaptureBlob], 'photo.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
          }
        }
        // Fallback to save if sharing is not supported
        previewSaveBtn.click();
        alert('共有がサポートされていないため、画像を保存しました。');
      } catch (e) {
        console.warn('Share failed:', e);
        alert('共有に失敗しました。画像を保存してください。');
      }
    });

    previewCloseBtn.addEventListener('click', closePreviewModalAndRetake);
    previewCloseX.addEventListener('click', closePreviewModalAndRetake);

    // --- Stamp Sheet ---
    stampButton.addEventListener('click', () => {
      if (!isSheetOpen) openStampSheet(); else closeStampSheet();
    });
    sheetCloseX.addEventListener('click', closeStampSheet);

    stampTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (btn && btn.dataset.tab) {
        activateStampTab(btn.dataset.tab);
      }
    });

    // Add a stamp when its thumbnail is clicked
    document.addEventListener('click', (ev) => {
      const thumb = ev.target.closest('.stamp-thumb');
      if (thumb && thumb.dataset.src) {
        addStampFromURL(thumb.dataset.src);
      }
    });

    // --- Window Events ---
    window.addEventListener('resize', () => {
        resizeStampCanvas();
        if (fcanvas) fcanvas.calcOffset();
    });
    
    window.addEventListener('beforeunload', () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
    });
  };

  // ==================== Initialization ====================
  initEventListeners();
  await startCamera();

  // Show permission modal if camera failed or if the intro image is visible
  if (!stream || (permissionImage && !permissionImage.classList.contains('hidden'))) {
    permissionModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  }
});