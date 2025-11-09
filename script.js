document.addEventListener('DOMContentLoaded', async () => {
  // ==================== DOM要素の取得 ====================
  const DOMElements = {
    cameraFeed: document.getElementById('cameraFeed'),
    photoCanvas: document.getElementById('photoCanvas'),
    shutterButton: document.getElementById('shutterButton'),
    permissionModal: document.getElementById('permissionModal'),
    permissionMessage: document.getElementById('permissionMessage'),
    closeModalButton: document.getElementById('closeModalButton'),
    previewModal: document.getElementById('previewModal'),
    previewImage: document.getElementById('previewImage'),
    previewSaveBtn: document.getElementById('previewSaveBtn'),
    previewShareBtn: document.getElementById('previewShareBtn'),
    previewCloseBtn: document.getElementById('previewCloseBtn'),
    previewCloseX: document.getElementById('previewCloseX'),
    frameTopEl: document.getElementById('frameTop'),
    frameBottomEl: document.getElementById('frameBottom'),
    stampCanvasEl: document.getElementById('stampCanvas'),
    stampButton: document.getElementById('stampButton'),
    stampSheet: document.getElementById('stampSheet'),
    sheetCloseX: document.getElementById('sheetCloseX'),
    cameraToggleButton: document.getElementById('cameraToggleButton'),
    actionDial: document.getElementById('stampActionDial'),
    stampTabsContainer: document.getElementById('stampTabs'),
    container: document.querySelector('.container'),
    body: document.body
  };

  // ==================== 定数と変数 ====================
  const LONGPRESS_MS = 450;
  const FLICK_THRESHOLD = 50;
  const CAMERA_SETTINGS = {
    idealWidth: 4096,
    idealHeight: 4096,
    minScale: 0.1,
    maxScale: 5,
    initialStampScaleRatio: 0.3, // 短辺に対するスタンプ初期サイズの割合
  };
  const FABRIC_OBJECT_SETTINGS = {
    cornerSize: 26,
    cornerStyle: 'circle',
    cornerColor: '#ff5b82',
    borderColor: '#ff5b82',
    transparentCorners: false,
    uniformScaling: true, // 拡大縮小時に縦横比を固定
    lockScalingFlip: true,
    hasControls: true,
    hasBorders: true,
    selectable: true,
    evented: true,
    originX: 'center',
    originY: 'center',
  };

  let fcanvas = null;
  let stream = null;
  let currentFacingMode = 'environment'; // 'environment' (背面) or 'user' (前面)
  let isSheetOpen = false;

  // プレビュー画像の一時データ
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;

  // 長押し・フリック用ワーク変数
  let lpTimer = null;
  let lpStartPoint = null; // {x, y} (client座標)
  let lpTarget = null; // fabric.Object
  let dialOpen = false;
  let currentStampTab = 'stamp1'; // デフォルトのスタンプタブ

  const canvasContext = DOMElements.photoCanvas.getContext('2d');

  // ==================== ヘルパー関数 ====================

  /**
   * 画像要素のロード完了を待機する
   * @param {HTMLImageElement} el
   * @returns {Promise<HTMLImageElement|null>}
   */
  function waitImage(el) {
    return new Promise((resolve) => {
      if (!el) return resolve(null);
      if (el.complete && el.naturalWidth && el.naturalHeight) return resolve(el);
      el.addEventListener('load', () => resolve(el), { once: true });
      el.addEventListener('error', () => {
        console.error(`Failed to load image: ${el.src}`);
        resolve(null);
      }, { once: true });
    });
  }

  /**
   * 2点間の距離を計算する
   * @param {Touch} a
   * @param {Touch} b
   * @returns {number}
   */
  const getDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  /**
   * 2点間の角度を計算する (ラジアン)
   * @param {Touch} a
   * @param {Touch} b
   * @returns {number}
   */
  const getAngle = (a, b) => Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);


  // ==================== UI表示制御 ====================

  /**
   * カメラビューと撮影結果ビューを切り替える
   * @param {boolean} isCameraActive - カメラがアクティブかどうか
   */
  const setCameraView = (isCameraActive) => {
    DOMElements.cameraFeed.classList.toggle('hidden', !isCameraActive);
    DOMElements.photoCanvas.classList.toggle('hidden', isCameraActive);
    DOMElements.shutterButton.classList.toggle('hidden', !isCameraActive);
    DOMElements.cameraToggleButton.classList.toggle('hidden', !isCameraActive);
  };

  /**
   * 権限モーダルを表示する
   * @param {string} message - モーダルに表示するメッセージ
   */
  const showPermissionModal = (message) => {
    DOMElements.permissionMessage.textContent = message;
    DOMElements.permissionModal.style.display = 'flex';
    DOMElements.body.classList.add('modal-open');
  };

  /**
   * 権限モーダルを閉じる
   */
  const hidePermissionModal = () => {
    DOMElements.permissionModal.style.display = 'none';
    DOMElements.body.classList.remove('modal-open');
  };

  /**
   * プレビューモーダルを開く
   * @param {HTMLCanvasElement} canvas - プレビュー表示するキャンバス
   */
  function openPreviewModalWithCanvas(canvas) {
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;

    canvas.toBlob((blob) => {
      if (!blob) {
        DOMElements.previewImage.src = canvas.toDataURL('image/png');
      } else {
        lastCaptureBlob = blob;
        lastCaptureObjectURL = URL.createObjectURL(blob);
        DOMElements.previewImage.src = lastCaptureObjectURL;
      }
      DOMElements.previewModal.classList.remove('hidden');
      DOMElements.body.classList.add('modal-open');
    }, 'image/png');
  }

  /**
   * プレビューモーダルを閉じ、再撮影を開始する
   */
  function closePreviewModalAndRetake() {
    DOMElements.previewModal.classList.add('hidden');
    DOMElements.body.classList.remove('modal-open');

    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;

    startCamera(); // 再撮影を開始
  }

  /**
   * スタンプ選択シートを開く
   */
  function openStampSheet() {
    // シート表示中はダイヤルを隠す（被り防止）
    if (dialOpen) {
      hideActionDial();
    }
    DOMElements.stampSheet.classList.add('open');
    isSheetOpen = true;
    DOMElements.container.classList.add('sheet-open');
    activateStampTab(currentStampTab); // 前回のタブをアクティブにする
  }

  /**
   * スタンプ選択シートを閉じる
   */
  function closeStampSheet() {
    DOMElements.stampSheet.classList.remove('open');
    isSheetOpen = false;
    DOMElements.container.classList.remove('sheet-open');
  }

  /**
   * 指定されたスタンプタブをアクティブにする
   * @param {string} tabName - アクティブにするタブの名前 (data-tab属性の値)
   */
  function activateStampTab(tabName) {
    currentStampTab = tabName;

    DOMElements.stampTabsContainer.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      const panelId = `panel-${btn.dataset.tab}`;
      btn.setAttribute('aria-controls', panelId);
      btn.id = `tab-${btn.dataset.tab}`;
    });

    document.querySelectorAll('.stamp-panel').forEach(panel => {
      const isActive = panel.dataset.tab === tabName;
      panel.classList.toggle('active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        panel.id = `panel-${tabName}`;
        panel.setAttribute('aria-labelledby', `tab-${tabName}`);
      }
    });
  }


  // ==================== カメラ機能 ====================

  /**
   * カメラを起動する
   */
  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: currentFacingMode },
          width: { ideal: CAMERA_SETTINGS.idealWidth },
          height: { ideal: CAMERA_SETTINGS.idealHeight }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : null;

      // 利用可能な最大解像度を適用
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

      DOMElements.cameraFeed.srcObject = stream;
      await DOMElements.cameraFeed.play();

      // インカメラの場合、video要素自体を水平反転させる
      if (currentFacingMode === 'user') {
        DOMElements.cameraFeed.style.transform = 'scaleX(-1)';
      } else {
        DOMElements.cameraFeed.style.transform = 'none'; // 背面カメラの場合は反転を解除
      }

      const settings = track.getSettings ? track.getSettings() : {};
      console.log('Active camera resolution =', settings.width, 'x', settings.height, ', Facing Mode =', currentFacingMode);

      setCameraView(true);
      // カメラが起動したら権限モーダルの内容を更新
      DOMElements.permissionMessage.style.textAlign = 'center';
      DOMElements.permissionMessage.innerHTML = [
        'IM課 モックアップ制作',
        "B'zライブツアー",
        'WebARコンテンツ'
      ].join('<br>');
      hidePermissionModal(); // カメラ起動に成功したらモーダルを閉じる

      if (!fcanvas) {
        initFabricCanvas();
      } else {
        resizeStampCanvas(); // カメラ再起動時はキャンバスサイズ調整
      }
    } catch (err) {
      console.error('カメラへのアクセスに失敗:', err);
      let errorMessage = 'カメラへのアクセス中にエラーが発生しました。';
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        errorMessage = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'カメラが見つかりませんでした。';
      } else if (err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
        errorMessage = 'カメラにアクセスできません。他のアプリで使用中かもしれません。';
      }
      showPermissionModal(errorMessage);
    }
  };


  // ==================== フレーム描画機能 ====================

  /**
   * フレーム画像をキャンバスに描画する
   */
  async function drawFramesToCanvas() {
    await Promise.all([waitImage(DOMElements.frameTopEl), waitImage(DOMElements.frameBottomEl)]);

    const cw = DOMElements.photoCanvas.width;
    const ch = DOMElements.photoCanvas.height;
    const ctx = canvasContext;

    const drawOneFrame = (imgEl, place) => {
      if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return;

      const iw = imgEl.naturalWidth;
      const ih = imgEl.naturalHeight;
      const scale = cw / iw; // キャンバス幅にフィットするためのスケール
      const drawW = cw;
      const drawH = Math.round(ih * scale);
      const dx = 0;
      const dy = (place === 'top') ? 0 : (ch - drawH);

      ctx.drawImage(imgEl, 0, 0, iw, ih, dx, dy, drawW, drawH);
    };

    drawOneFrame(DOMElements.frameTopEl, 'top');
    drawOneFrame(DOMElements.frameBottomEl, 'bottom');
  }


  // ==================== Fabric.js スタンプ機能 ====================

  /**
   * Fabric.jsキャンバスを初期化し、イベントリスナーを設定する
   */
  function initFabricCanvas() {
    if (fcanvas) {
      resizeStampCanvas();
      return;
    }

    fcanvas = new fabric.Canvas(DOMElements.stampCanvasEl, {
      selection: true,
      preserveObjectStacking: true,
      defaultCursor: 'grab',
      allowTouchScrolling: false, // Fabric.jsがタッチスクロールを妨げないように
      targetFindTolerance: 12,
    });
    resizeStampCanvas();

    // Fabric.jsが生成するラッパー要素にスタイルを適用
    const container = fcanvas.getElement().parentNode; // .canvas-container
    if (container) {
      Object.assign(container.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '7'
      });
    }
    Object.assign(fcanvas.upperCanvasEl.style, {
      touchAction: 'none', pointerEvents: 'auto', zIndex: '7'
    });

    // Fabric.jsオブジェクトのデフォルト設定
    Object.assign(fabric.Object.prototype, FABRIC_OBJECT_SETTINGS);

    // 上下左右のコントロールを非表示にする
    fabric.Object.prototype.setControlsVisibility({
      mt: false, mb: false, ml: false, mr: false
    });

    // ===== 2本指ジェスチャ（拡大/回転） =====
    let gestureObject = null;
    let gestureStart = null;

    fcanvas.upperCanvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const obj = fcanvas.getActiveObject();
        if (!obj) return;
        gestureObject = obj;
        gestureStart = {
          dist: getDistance(e.touches[0], e.touches[1]),
          angle: getAngle(e.touches[0], e.touches[1]),
          scaleX: obj.scaleX || 1,
          angleDeg: obj.angle || 0
        };
        e.preventDefault(); // デフォルトのスクロールやズームを防止
      }
    }, { passive: false });

    fcanvas.upperCanvasEl.addEventListener('touchmove', (e) => {
      if (gestureObject && e.touches.length === 2) {
        const currentDist = getDistance(e.touches[0], e.touches[1]);
        const currentAng = getAngle(e.touches[0], e.touches[1]);

        const scaleChange = currentDist / gestureStart.dist;
        const newScale = Math.max(CAMERA_SETTINGS.minScale, Math.min(CAMERA_SETTINGS.maxScale, gestureStart.scaleX * scaleChange));
        gestureObject.scale(newScale);

        const angleChangeDeg = (currentAng - gestureStart.angle) * (180 / Math.PI);
        gestureObject.rotate(gestureStart.angleDeg + angleChangeDeg);

        gestureObject.setCoords();
        fcanvas.requestRenderAll();
        e.preventDefault();
      }
    }, { passive: false });

    fcanvas.upperCanvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length < 2 && gestureObject) {
        gestureObject = null;
        gestureStart = null;
        e.preventDefault();
      }
    }, { passive: false });

    // ====== 長押しフリック・ダイヤル ======
    if (DOMElements.actionDial) {
      setupStampActionDial();
    }
  }

  /**
   * Fabric.jsキャンバスのサイズを調整する
   */
  function resizeStampCanvas() {
    if (!DOMElements.stampCanvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = DOMElements.container.getBoundingClientRect();

    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));

    DOMElements.stampCanvasEl.width = Math.round(cssW * dpr);
    DOMElements.stampCanvasEl.height = Math.round(cssH * dpr);
    DOMElements.stampCanvasEl.style.width = cssW + 'px';
    DOMElements.stampCanvasEl.style.height = cssH + 'px';

    if (fcanvas) {
      fcanvas.setWidth(cssW);
      fcanvas.setHeight(cssH);
      // fcanvas.setZoom(dpr); // DPI ZoomはFabric.jsの内部描画に影響するため、通常はCSSで対応
      fcanvas.renderAll();
      fcanvas.calcOffset(); // オフセットを再計算
    }
  }

  /**
   * URLからスタンプをFabric.jsキャンバスに追加する
   * @param {string} url - スタンプ画像のURL
   */
  function addStampFromURL(url) {
    if (!fcanvas) return;

    fabric.Image.fromURL(url, (img) => {
      // 初期設定を適用
      Object.assign(img, FABRIC_OBJECT_SETTINGS);
      // 上下左右のコントロールを非表示にする
      img.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });

      // 初期スケール：短辺の30%
      const cssW = fcanvas.getWidth();
      const cssH = fcanvas.getHeight();
      const base = Math.min(cssW, cssH) * CAMERA_SETTINGS.initialStampScaleRatio;
      const scale = base / img.width;
      img.scale(scale);

      fcanvas.add(img);
      fcanvas.viewportCenterObject(img); // 画面中央に配置
      img.setCoords();

      fcanvas.bringToFront(img); // 最前面へ
      fcanvas.setActiveObject(img); // 選択状態にする
      fcanvas.requestRenderAll();

      closeStampSheet(); // 追加後はシートを閉じる
    }, { crossOrigin: 'anonymous' });
  }

  /**
   * 対象オブジェクトをダイヤル表示中に一時的にロックする
   * @param {fabric.Object} target
   */
  function freezeTargetForDial(target) {
    if (!target) return;
    target.__preLock = {
      mvx: target.lockMovementX, mvy: target.lockMovementY,
      sx: target.lockScalingX, sy: target.lockScalingY,
      rot: target.lockRotation, hc: target.hasControls,
      sel: target.selectable, ev: target.evented
    };
    target.lockMovementX = target.lockMovementY = true;
    target.lockScalingX = target.lockScalingY = true;
    target.lockRotation = true;
    target.hasControls = false;
    target.selectable = false; // ダイヤル中は選択不可に
    target.evented = false; // イベントも受け付けない
    target.setCoords && target.setCoords();
  }

  /**
   * 対象オブジェクトの一時ロックを解除する
   * @param {fabric.Object} target
   */
  function unfreezeTargetAfterDial(target) {
    if (!target || target._locked) return; // "本ロック"が指定されたら維持
    const p = target.__preLock;
    if (!p) return;
    target.lockMovementX = p.mvx;
    target.lockMovementY = p.mvy;
    target.lockScalingX = p.sx;
    target.lockScalingY = p.sy;
    target.lockRotation = p.rot;
    target.hasControls = p.hc;
    target.selectable = p.sel;
    target.evented = p.ev;
    target.__preLock = null;
    target.setCoords && target.setCoords();
  }

  /**
   * スタンプアクションダイヤルを設定する
   */
  function setupStampActionDial() {
    const upperCanvas = fcanvas.upperCanvasEl;

    /**
     * アクションダイヤルを表示する
     * @param {number} x - クリック/タップの中心X座標 (client座標)
     * @param {number} y - クリック/タップの中心Y座標 (client座標)
     * @param {fabric.Object} target - 操作対象のFabricオブジェクト
     */
    const showActionDial = (x, y, target) => {
      const containerRect = DOMElements.container.getBoundingClientRect();
      const localX = x - containerRect.left;
      const localY = y - containerRect.top;

      // 対象を一時ロック（フリック中に動かないように）
      freezeTargetForDial(target);

      // Canvas 側もターゲット探索を止めて誤ドラッグを防ぐ
      fcanvas.skipTargetFind = true;
      fcanvas.selection = false;

      DOMElements.actionDial.style.left = `${localX}px`;
      DOMElements.actionDial.style.top = `${localY}px`;
      DOMElements.actionDial.classList.remove('hidden');
      DOMElements.actionDial.setAttribute('aria-hidden', 'false');
      dialOpen = true;

      const lockBtn = DOMElements.actionDial.querySelector('[data-action="lock-toggle"]');
      if (lockBtn) {
        lockBtn.textContent = target._locked ? 'ロック解除' : 'ロック';
      }
    };

    /**
     * アクションダイヤルを非表示にする
     */
    const hideActionDial = () => {
      if (!dialOpen) return;
      DOMElements.actionDial.classList.add('hidden');
      DOMElements.actionDial.setAttribute('aria-hidden', 'true');
      dialOpen = false;

      fcanvas.skipTargetFind = false;
      fcanvas.selection = true;
      if (lpTarget) unfreezeTargetAfterDial(lpTarget);
    };

    /**
     * スタンプアクションを実行する
     * @param {string} action - 実行するアクション ('delete', 'front', 'back', 'lock-toggle')
     * @param {fabric.Object} target - 操作対象のFabricオブジェクト
     */
    const doStampAction = (action, target) => {
      if (!target || !fcanvas) return;
      switch (action) {
        case 'delete':
          fcanvas.remove(target);
          break;
        case 'front':
          fcanvas.bringToFront(target);
          break;
        case 'back':
          fcanvas.sendToBack(target);
          break;
        case 'lock-toggle':
          target._locked = !target._locked; // ロック状態をトグル
          // ロック状態に基づいてプロパティを設定
          target.lockMovementX = target.lockMovementY = target._locked;
          target.lockScalingX = target.lockScalingY = target._locked;
          target.lockRotation = target._locked;
          target.hasControls = !target._locked;
          target.selectable = !target._locked; // ロック時は選択不可
          target.evented = !target._locked; // ロック時はイベント無効
          target.opacity = target._locked ? 0.95 : 1;
          break;
      }
      target.setCoords?.();
      fcanvas.requestRenderAll();
    };

    // 長押し開始
    upperCanvas.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || isSheetOpen) {
        clearTimeout(lpTimer);
        return;
      }

      // その位置のターゲットを拾う
      // event.target.closest('.canvas-container') が Fabric Canvas の DOM 要素
      // fcanvas.findTarget(e) は、Fabric オブジェクトが実際にタップされたか検出
      const pointer = fcanvas.getPointer(e.touches[0]);
      const target = fcanvas.findTarget(e.touches[0], false) || fcanvas.getActiveObject();

      if (!target || target.isType('activeSelection')) { // 複数選択は対象外
        clearTimeout(lpTimer);
        return;
      }

      lpTarget = target;
      lpStartPoint = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        // 長押し成立：アクティブ化してダイヤル表示
        fcanvas.setActiveObject(lpTarget);
        fcanvas.requestRenderAll();
        showActionDial(lpStartPoint.x, lpStartPoint.y, lpTarget);
        lpTimer = null;
      }, LONGPRESS_MS);
    }, { passive: true });

    // 長押し判定中に大きく動いたらキャンセル
    upperCanvas.addEventListener('touchmove', (e) => {
      if (lpTimer && e.touches.length === 1 && lpStartPoint) {
        const dx = e.touches[0].clientX - lpStartPoint.x;
        const dy = e.touches[0].clientY - lpStartPoint.y;
        if (Math.hypot(dx, dy) > 10) {
          clearTimeout(lpTimer);
          lpTimer = null;
        }
      }
    }, { passive: true });

    // フリック判定 & 後片付け
    upperCanvas.addEventListener('touchend', (e) => {
      // タイマーが残っていれば長押し不成立（通常タップ/ドラッグ）
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
        lpStartPoint = null;
        lpTarget = null;
        return;
      }

      if (dialOpen && lpStartPoint && lpTarget) {
        const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
        if (t) {
          const dx = t.clientX - lpStartPoint.x;
          const dy = t.clientY - lpStartPoint.y;
          const dist = Math.hypot(dx, dy);

          if (dist >= FLICK_THRESHOLD) {
            let action = null;
            if (Math.abs(dx) > Math.abs(dy)) {
              action = dx > 0 ? 'delete' : 'lock-toggle'; // →削除 / ←ロック(解除)
            } else {
              action = dy < 0 ? 'front' : 'back'; // ↑前面へ / ↓背面へ
            }
            doStampAction(action, lpTarget);
          }
        }
        hideActionDial(); // 仮ロック解除もここで実行
        lpStartPoint = null;
        lpTarget = null;
      }
    }, { passive: true });

    // ダイヤルのボタン（タップ）
    DOMElements.actionDial.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.dial-btn');
      if (!btn || !lpTarget) return;
      const action = btn.getAttribute('data-action');
      doStampAction(action, lpTarget);
      hideActionDial();
      lpStartPoint = null;
      lpTarget = null;
    });
  }


  // ==================== イベントリスナーの登録 ====================

  /**
   * 全てのイベントリスナーを設定する
   */
  function setupEventListeners() {
    DOMElements.closeModalButton.addEventListener('click', hidePermissionModal);
    DOMElements.cameraToggleButton.addEventListener('click', () => {
      currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
      startCamera();
    });
    DOMElements.stampButton.addEventListener('click', () => {
      if (!fcanvas) initFabricCanvas();
      isSheetOpen ? closeStampSheet() : openStampSheet();
    });
    DOMElements.sheetCloseX.addEventListener('click', closeStampSheet);

    // スタンプサムネイルのクリックイベント
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.stamp-thumb');
      if (!btn) return;
      const src = btn.getAttribute('data-src');
      if (src) addStampFromURL(src);
    });

    // スタンプタブのクリックイベント
    DOMElements.stampTabsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tabName = btn.dataset.tab;
      if (tabName) activateStampTab(tabName);
    });

    // シャッターボタン
    DOMElements.shutterButton.addEventListener('click', async () => {
      if (!stream || !DOMElements.cameraFeed.srcObject) return;

      // キャンバスの出力サイズはコンテナの表示サイズに合わせる
      const containerRect = DOMElements.container.getBoundingClientRect();
      DOMElements.photoCanvas.width = Math.max(1, Math.round(containerRect.width));
      DOMElements.photoCanvas.height = Math.max(1, Math.round(containerRect.height));

      const vw = DOMElements.cameraFeed.videoWidth;
      const vh = DOMElements.cameraFeed.videoHeight;
      if (!vw || !vh || DOMElements.cameraFeed.readyState < 2) {
        setTimeout(() => DOMElements.shutterButton.click(), 50); // 動画が準備できてなければリトライ
        return;
      }

      // 描画するビデオの領域を計算 (アスペクト比を維持して中央を切り抜く)
      const videoRatio = vw / vh;
      const canvasRatio = DOMElements.photoCanvas.width / DOMElements.photoCanvas.height;
      let sx, sy, sWidth, sHeight;

      if (videoRatio > canvasRatio) { // ビデオがキャンバスより横長
        sHeight = vh;
        sWidth = Math.round(vh * canvasRatio);
        sx = Math.round((vw - sWidth) / 2);
        sy = 0;
      } else { // ビデオがキャンバスより縦長
        sWidth = vw;
        sHeight = Math.round(vw / canvasRatio);
        sx = 0;
        sy = Math.round((vh - sHeight) / 2);
      }

      // 1) カメラ画像をキャンバスに描画
      canvasContext.setTransform(1, 0, 0, 1, 0, 0); // 変換をリセット
      canvasContext.clearRect(0, 0, DOMElements.photoCanvas.width, DOMElements.photoCanvas.height);

      // インカメラの場合、画像を水平反転させる (video要素の表示に合わせてcanvasも反転)
      if (currentFacingMode === 'user') {
        canvasContext.translate(DOMElements.photoCanvas.width, 0);
        canvasContext.scale(-1, 1);
      }

      canvasContext.drawImage(
        DOMElements.cameraFeed,
        sx, sy, sWidth, sHeight,
        0, 0, DOMElements.photoCanvas.width, DOMElements.photoCanvas.height
      );

      canvasContext.setTransform(1, 0, 0, 1, 0, 0); // 反転状態をリセット

      // 2) フレームを合成
      await drawFramesToCanvas();

      // 3) スタンプを合成（最前面）
      if (fcanvas) {
        fcanvas.discardActiveObject(); // アクティブなオブジェクトの選択を解除
        fcanvas.renderAll(); // 変更を反映
        canvasContext.drawImage(
          DOMElements.stampCanvasEl,
          0, 0, DOMElements.stampCanvasEl.width, DOMElements.stampCanvasEl.height,
          0, 0, DOMElements.photoCanvas.width, DOMElements.photoCanvas.height
        );
      }

      // ストリーム停止 → ビュー切替 → プレビュー
      stream.getTracks().forEach(t => t.stop());
      DOMElements.cameraFeed.srcObject = null;
      setCameraView(false);

      openPreviewModalWithCanvas(DOMElements.photoCanvas);
    });

    // プレビューモーダル操作
    DOMElements.previewSaveBtn.addEventListener('click', () => {
      const url = DOMElements.photoCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `photo_${new Date().getTime()}.png`;
      DOMElements.body.appendChild(a);
      a.click();
      DOMElements.body.removeChild(a);
    });

    DOMElements.previewShareBtn.addEventListener('click', async () => {
      try {
        if (navigator.canShare && lastCaptureBlob) {
          const file = new File([lastCaptureBlob], 'photo.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] });
            return;
          }
        }
        // フォールバック：保存に誘導
        const url = DOMElements.photoCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `photo_${new Date().getTime()}.png`;
        DOMElements.body.appendChild(a);
        a.click();
        DOMElements.body.removeChild(a);
        alert('共有がサポートされていないため、画像を保存しました。端末の共有機能からX/Instagramへ送ってください。');
      } catch (e) {
        console.warn('共有に失敗:', e);
        if (e.name !== 'AbortError') { // ユーザーが共有をキャンセルした場合はアラートしない
          alert('共有に失敗しました。保存してから端末の共有機能をご利用ください。');
        }
      }
    });

    DOMElements.previewCloseBtn.addEventListener('click', closePreviewModalAndRetake);
    DOMElements.previewCloseX.addEventListener('click', closePreviewModalAndRetake);

    // リサイズイベントハンドラ
    window.addEventListener('resize', () => {
      resizeStampCanvas();
      if (fcanvas) fcanvas.calcOffset();
    });

    // ページ離脱時にストリーム停止
    window.addEventListener('beforeunload', () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    });
  }

  // ==================== 初期化処理 ====================
  // 最初にカメラを起動
  await startCamera();

  // カメラ起動失敗時などに権限モーダルが表示されたままの場合の対応
  if (DOMElements.permissionModal.style.display === 'flex' && !DOMElements.permissionMessage.textContent) {
    DOMElements.permissionMessage.textContent = 'カメラのアクセスを待機しています...';
  }

  // イベントリスナーを設定
  setupEventListeners();

  // 初期タブをアクティブ化
  activateStampTab(currentStampTab);
});