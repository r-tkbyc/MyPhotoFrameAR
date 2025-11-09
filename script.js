document.addEventListener('DOMContentLoaded', async () => {
  const cameraFeed = document.getElementById('cameraFeed');
  const photoCanvas = document.getElementById('photoCanvas');
  const shutterButton = document.getElementById('shutterButton');

  const permissionModal = document.getElementById('permissionModal');
  const permissionMessage = document.getElementById('permissionMessage');
  const closeModalButton = document.getElementById('closeModalButton');

  // プレビュー用モーダル
  const previewModal    = document.getElementById('previewModal');
  const previewImage    = document.getElementById('previewImage');
  const previewSaveBtn  = document.getElementById('previewSaveBtn');
  const previewShareBtn = document.getElementById('previewShareBtn');
  const previewCloseBtn = document.getElementById('previewCloseBtn');
  const previewCloseX   = document.getElementById('previewCloseX');

  // フレーム
  const frameTopEl    = document.getElementById('frameTop');
  const frameBottomEl = document.getElementById('frameBottom');

  // スタンプ（Fabric）
  const stampCanvasEl = document.getElementById('stampCanvas');
  const stampButton   = document.getElementById('stampButton');
  const stampSheet    = document.getElementById('stampSheet');
  const sheetCloseX  = document.getElementById('sheetCloseX');

  // カメラ切り替えボタン
  const cameraToggleButton = document.getElementById('cameraToggleButton');
  let currentFacingMode = 'environment'; // 'environment' (背面) or 'user' (前面)

  // 長押しフリック用ダイヤル
  const actionDial = document.getElementById('stampActionDial');
  const LONGPRESS_MS = 450;
  const FLICK_THRESHOLD = 50;

  let fcanvas = null;      // Fabric.Canvas
  let isSheetOpen = false;

  let stream = null;
  const canvasContext = photoCanvas.getContext('2d');

  // プレビュー画像の一時データ
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;

  // ===== 長押し・フリック用ワーク変数 =====
  let lpTimer = null;
  let lpStartPoint = null;  // {x, y} (client座標)
  let lpTarget = null;      // fabric.Object
  let dialOpen = false;

  // カメラ表示/撮影結果の切替
  const setCameraView = (isCameraActive) => {
    if (isCameraActive) {
      cameraFeed.classList.remove('hidden');
      photoCanvas.classList.add('hidden');
      shutterButton.classList.remove('hidden');
      cameraToggleButton.classList.remove('hidden'); // カメラボタンも表示
    } else {
      cameraFeed.classList.add('hidden');
      photoCanvas.classList.remove('hidden'); // 撮影後は非表示
      shutterButton.classList.add('hidden');
      cameraToggleButton.classList.add('hidden'); // カメラボタンも非表示
    }
  };

  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: currentFacingMode }, // ここを切り替え
          width:  { ideal: 4096 },
          height: { ideal: 4096 }
        }
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);

      const track = stream.getVideoTracks()[0];
      const caps  = track.getCapabilities ? track.getCapabilities() : null;
      if (caps && caps.width && caps.height) {
        try {
          await track.applyConstraints({
            width:  { ideal: caps.width.max },
            height: { ideal: caps.height.max }
          });
        } catch (e) { console.warn('applyConstraints skipped:', e); }
      }

      cameraFeed.srcObject = stream;
      await cameraFeed.play();

      // インカメラの場合、video要素自体を水平反転させる
      if (currentFacingMode === 'user') {
        cameraFeed.style.transform = 'scaleX(-1)';
      } else {
        cameraFeed.style.transform = 'none'; // 背面カメラの場合は反転を解除
      }

      const settings = track.getSettings ? track.getSettings() : {};
      console.log('Active camera resolution =', settings.width, 'x', settings.height, ', Facing Mode =', currentFacingMode);

      setCameraView(true);
      permissionMessage.style.textAlign = 'center';
      permissionMessage.innerHTML = [
        'IM課 モックアップ制作',
        "B'zライブツアー",
        'WebARコンテンツ'
      ].join('<br>');

      // 初回に Fabric 初期化
      if (!fcanvas) {
        initFabricCanvas();
      } else {
        resizeStampCanvas(); // カメラ再起動時はキャンバスサイズ調整
      }
    } catch (err) {
      console.error('カメラへのアクセスに失敗:', err);
      if (err.name === 'NotAllowedError') {
        permissionMessage.textContent = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
      } else if (err.name === 'NotFoundError') {
        permissionMessage.textContent = 'カメラが見つかりませんでした。';
      } else {
        permissionMessage.textContent = 'カメラへのアクセス中にエラーが発生しました。';
      }
      permissionModal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
  };

  // カメラ切り替えボタンのイベントリスナー
  cameraToggleButton.addEventListener('click', async () => {
    currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
    await startCamera();
  });

  await startCamera();

  if (permissionMessage.textContent || cameraFeed.srcObject) {
    // 権限メッセージが設定されている場合、またはカメラストリームがまだない場合のみ表示
    if (!cameraFeed.srcObject && !permissionMessage.textContent) {
      // ストリームがまだなく、エラーメッセージもなければ、許可待ちの状態
      permissionMessage.textContent = 'カメラのアクセスを待機しています...';
    }
    permissionModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  }
  closeModalButton.addEventListener('click', () => {
    permissionModal.style.display = 'none';
    document.body.classList.remove('modal-open');
  });

  // ---- フレーム画像のロード完了を保証
  function waitImage(el) {
    return new Promise((resolve) => {
      if (!el) return resolve(null);
      if (el.complete && el.naturalWidth && el.naturalHeight) return resolve(el);
      el.addEventListener('load', () => resolve(el), { once: true });
      el.addEventListener('error', () => resolve(null), { once: true });
    });
  }
  async function ensureFramesReady() {
    await Promise.all([waitImage(frameTopEl), waitImage(frameBottomEl)]);
  }

  // ---- フレーム合成（表示と一致）幅100%フィット
  function drawFramesToCanvas() {
    const cw = photoCanvas.width;
    const ch = photoCanvas.height;
    const ctx = canvasContext;

    const drawOne = (imgEl, place) => {
      if (!imgEl) return;
      const iw = imgEl.naturalWidth;
      const ih = imgEl.naturalHeight;
      if (!iw || !ih) return;

      // キャンバス幅にフィット（等比）
      const scale = cw / iw;
      const drawW = cw;                     // 幅100%
      const drawH = Math.round(ih * scale); // 高さは比率で
      const dx = 0;                         // 幅いっぱいなので0
      const dy = (place === 'top') ? 0 : (ch - drawH); // 上端 or 下端に揃える

      ctx.drawImage(imgEl, 0, 0, iw, ih, dx, dy, drawW, drawH);
    };

    drawOne(frameTopEl, 'top');
    drawOne(frameBottomEl, 'bottom');
  }

  // ---- プレビューをモーダルに表示
  function openPreviewModalWithCanvas(canvas) {
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;

    canvas.toBlob((blob) => {
      if (!blob) {
        previewImage.src = canvas.toDataURL('image/png');
      } else {
        lastCaptureBlob = blob;
        lastCaptureObjectURL = URL.createObjectURL(blob);
        previewImage.src = lastCaptureObjectURL;
      }
      previewModal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    }, 'image/png');
  }

  function closePreviewModalAndRetake() {
    previewModal.classList.add('hidden');
    document.body.classList.remove('modal-open');

    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    lastCaptureBlob = null;

    // 再撮影
    startCamera();
  }

  // =================== Fabric.js：スタンプ ===================

  // ---- ダイヤル表示中の一時ロック
  function freezeTargetForDial(target){
    if (!target) return;
    target.__preLock = {
      mvx: target.lockMovementX, mvy: target.lockMovementY,
      sx: target.lockScalingX, sy: target.lockScalingY,
      rot: target.lockRotation, hc: target.hasControls
    };
    target.lockMovementX = target.lockMovementY = true;
    target.lockScalingX  = target.lockScalingY  = true;
    target.lockRotation  = true;
    target.hasControls   = false;
    target.setCoords && target.setCoords();
  }
  function unfreezeTargetAfterDial(target){
    if (!target || target._locked) return; // “本ロック”が指定されたら維持
    const p = target.__preLock;
    if (!p) return;
    target.lockMovementX = p.mvx; target.lockMovementY = p.mvy;
    target.lockScalingX  = p.sx;  target.lockScalingY  = p.sy;
    target.lockRotation  = p.rot; target.hasControls   = p.hc;
    target.__preLock = null;
    target.setCoords && target.setCoords();
  }

  function initFabricCanvas() {
    if (fcanvas) { resizeStampCanvas(); return; }

    fcanvas = new fabric.Canvas(stampCanvasEl, {
      selection: true,
      preserveObjectStacking: true
    });
    resizeStampCanvas();

    // ラッパ/上キャンバスに z-index とタッチ設定を明示
    const container = fcanvas.getElement().parentNode; // .canvas-container
    if (container) {
      container.style.position  = 'absolute';
      container.style.inset     = '0';
      container.style.width     = '100%';
      container.style.height    = '100%';
      container.style.zIndex    = '7';      // フレーム(6)より前
    }
    fcanvas.upperCanvasEl.style.touchAction   = 'none';
    fcanvas.upperCanvasEl.style.pointerEvents = 'auto';
    fcanvas.upperCanvasEl.style.zIndex        = '7';
    stampCanvasEl.style.pointerEvents = 'auto';
    stampCanvasEl.style.touchAction   = 'none';
    fcanvas.defaultCursor             = 'grab';
    fcanvas.allowTouchScrolling       = false;
    fcanvas.targetFindTolerance       = 12;
    fabric.Object.prototype.cornerSize = 26;
    fabric.Object.prototype.cornerStyle = 'circle';
    fabric.Object.prototype.cornerColor = '#ff5b82';
    fabric.Object.prototype.borderColor = '#ff5b82';
    fabric.Object.prototype.transparentCorners = false;

    // ===== 2本指ジェスチャ（拡大/回転） =====
    let gObj = null, gStart = null;
    const getDist = (a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    const getAngle=(a,b)=>Math.atan2(b.clientY-a.clientY,b.clientX-a.clientX);

    fcanvas.upperCanvasEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const obj = fcanvas.getActiveObject();
        if (!obj) return;
        gObj = obj;
        gStart = {
          dist: getDist(e.touches[0], e.touches[1]),
          angle: getAngle(e.touches[0], e.touches[1]),
          scaleX: obj.scaleX || obj.scale || 1,
          angleDeg: obj.angle || 0
        };
        e.preventDefault();
      }
    }, { passive:false });

    fcanvas.upperCanvasEl.addEventListener('touchmove', (e) => {
      if (gObj && e.touches.length === 2) {
        const dist = getDist(e.touches[0], e.touches[1]);
        const ang  = getAngle(e.touches[0], e.touches[1]);

        const s = dist / gStart.dist;
        const newScale = Math.max(0.1, Math.min(5, gStart.scaleX * s));
        gObj.scale(newScale);

        const deltaDeg = (ang - gStart.angle) * (180/Math.PI);
        gObj.rotate(gStart.angleDeg + deltaDeg);

        gObj.setCoords();
        fcanvas.requestRenderAll();
        e.preventDefault();
      }
    }, { passive:false });

    fcanvas.upperCanvasEl.addEventListener('touchend', (e) => {
      if (e.touches.length < 2 && gObj) {
        gObj = null;
        gStart = null;
        e.preventDefault();
      }
    }, { passive:false });

    // ====== 長押しフリック・ダイヤル（存在する場合のみ有効化） ======
    if (actionDial) {
      const upper = fcanvas.upperCanvasEl;

      const showActionDial = (x, y, target) => {
        const containerRect = document.querySelector('.container').getBoundingClientRect();
        const localX = x - containerRect.left;
        const localY = y - containerRect.top;

        // 対象を一時ロック（フリック中に動かないように）
        freezeTargetForDial(target);

        // Canvas 側もターゲット探索を止めて誤ドラッグを防ぐ
        fcanvas.skipTargetFind = true;
        fcanvas.selection = false;

        actionDial.style.left = `${localX}px`;
        actionDial.style.top  = `${localY}px`;
        actionDial.classList.remove('hidden');
        actionDial.setAttribute('aria-hidden', 'false');
        dialOpen = true;

        const lockBtn = actionDial.querySelector('[data-action="lock-toggle"]');
        if (lockBtn) {
          const locked = !!target._locked;
          lockBtn.textContent = locked ? 'ロック解除' : 'ロック';
        }
      };

      const hideActionDial = () => {
        if (!dialOpen) return;
        actionDial.classList.add('hidden');
        actionDial.setAttribute('aria-hidden', 'true');
        dialOpen = false;

        // Canvas 側設定を元に戻す
        fcanvas.skipTargetFind = false;
        fcanvas.selection = true;

        // 対象の一時ロックを解除（本ロックは維持）
        if (lpTarget) unfreezeTargetAfterDial(lpTarget);
      };

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
            if (target._locked) {
              // --- ロック解除 ---
              target.lockMovementX = target.lockMovementY = false;
              target.lockScalingX  = target.lockScalingY  = false;
              target.lockRotation  = false;
              target.hasControls   = true;
              target.selectable    = true;
              target.evented       = true;
              target._locked       = false;
              target.opacity       = 1;

              // ★ 重要：仮ロックの復元を無効化
              target.__preLock = null;
            } else {
              // --- ロック ---
              target.lockMovementX = target.lockMovementY = true;
              target.lockScalingX  = target.lockScalingY  = true;
              target.lockRotation  = true;
              target.hasControls   = false;
              // 選択は可能なままでもOK（編集不可）
              target.selectable    = true;
              target.evented       = true;
              target._locked       = true;
              target.opacity       = 0.95;
            }
            break;
        }
        target.setCoords?.();
        fcanvas.requestRenderAll();
      };

      // 長押し開始
      upper.addEventListener('touchstart', (e) => {
        // ピンチやシート表示中はスキップ
        if (e.touches.length !== 1 || isSheetOpen) { clearTimeout(lpTimer); return; }

        // その位置のターゲットを拾う
        const target = fcanvas.findTarget(e, true) || fcanvas.getActiveObject();
        if (!target) { clearTimeout(lpTimer); return; }

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
      upper.addEventListener('touchmove', (e) => {
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
      upper.addEventListener('touchend', (e) => {
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
                action = dy < 0 ? 'front' : 'back';         // ↑前面へ / ↓背面へ
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
      actionDial.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.dial-btn');
        if (!btn || !lpTarget) return;
        const action = btn.getAttribute('data-action');
        doStampAction(action, lpTarget);
        hideActionDial();
        lpStartPoint = null;
        lpTarget = null;
      });
    }
  }

  function resizeStampCanvas() {
    if (!stampCanvasEl) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = document.querySelector('.container').getBoundingClientRect();

    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));

    stampCanvasEl.width  = Math.round(cssW * dpr);
    stampCanvasEl.height = Math.round(cssH * dpr);
    stampCanvasEl.style.width  = cssW + 'px';
    stampCanvasEl.style.height = cssH + 'px';

    if (fcanvas) {
      fcanvas.setWidth(cssW);
      fcanvas.setHeight(cssH);
      fcanvas.setZoom(dpr);
      fcanvas.renderAll();
    }
  }

  function addStampFromURL(url) {
    if (!fcanvas) return;

    fabric.Image.fromURL(url, (img) => {
      img.set({
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: true,
        hasBorders: true,
        lockScalingFlip: false,
        transparentCorners: false,
        cornerColor: '#ff5b82',
        cornerStyle: 'circle',
        borderColor: '#ff5b82',
        cornerSize: 26
      });

      // 初期スケール：短辺の30%
      const cssW = fcanvas.getWidth();
      const cssH = fcanvas.getHeight();
      const base = Math.min(cssW, cssH) * 0.3;
      const scale = base / img.width;
      img.scale(scale);

      fcanvas.add(img);

      // 画面の“見た目の中央”へ
      fcanvas.viewportCenterObject(img);
      img.setCoords();

      // 前面＆選択
      fcanvas.bringToFront(img);
      fcanvas.setActiveObject(img);
      fcanvas.requestRenderAll();

      // 追加後はシートを閉じて即編集できるように
      closeStampSheet();
    }, { crossOrigin: 'anonymous' });
  }

  function openStampSheet() {
    // シート表示中はダイヤルを隠す（被り防止）
    if (actionDial && dialOpen) {
      actionDial.classList.add('hidden');
      actionDial.setAttribute('aria-hidden', 'true');
      dialOpen = false;
    }
    stampSheet.classList.add('open');
    isSheetOpen = true;
    document.querySelector('.container')?.classList.add('sheet-open');
  }
  function closeStampSheet() {
    stampSheet.classList.remove('open');
    isSheetOpen = false;
    document.querySelector('.container')?.classList.remove('sheet-open');
  }

  // ===== タブ切り替え =====
  let currentStampTab = 'stamp1'; // デフォルト

  function activateStampTab(tabName) {
    currentStampTab = tabName;

    // タブボタンの状態
    document.querySelectorAll('#stampTabs .tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      // タブ→パネル関連ARIA
      const panelId = 'panel-' + btn.dataset.tab;
      btn.setAttribute('aria-controls', panelId);
      btn.id = 'tab-' + btn.dataset.tab;
    });

    // パネルの表示切替
    document.querySelectorAll('.stamp-panel').forEach(panel => {
      const isActive = panel.dataset.tab === tabName;
      panel.classList.toggle('active', isActive);
      panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      if (isActive) {
        panel.id = 'panel-' + tabName;
        panel.setAttribute('aria-labelledby', 'tab-' + tabName);
      }
    });
  }

  // タブボタンのクリック
  document.getElementById('stampTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tabName = btn.dataset.tab;
    if (tabName) activateStampTab(tabName);
  });

  // シートを開いたときは前回のタブを保持（初回は 'stamp1'）
  const _openStampSheetOrig = openStampSheet;
  openStampSheet = function() {
    _openStampSheetOrig();
    activateStampTab(currentStampTab || 'stamp1');
  };

  stampButton?.addEventListener('click', () => {
    if (!fcanvas) initFabricCanvas();
    if (isSheetOpen) closeStampSheet(); else openStampSheet();
  });
  sheetCloseX?.addEventListener('click', closeStampSheet);

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.stamp-thumb');
    if (!btn) return;
    const src = btn.getAttribute('data-src');
    if (src) addStampFromURL(src);
  });

  window.addEventListener('resize', () => {
    resizeStampCanvas();
    if (fcanvas) fcanvas.calcOffset();
  });

  // =================== シャッター（合成順：カメラ → フレーム → スタンプ） ===================
  shutterButton.addEventListener('click', async () => {
    if (!stream || !cameraFeed.srcObject) return;

    // キャンバスの出力サイズは可視の video と一致
    const cw = cameraFeed.clientWidth;
    const ch = cameraFeed.clientHeight;

    if (!cw || !ch) {
      const rect = document.querySelector('.container').getBoundingClientRect();
      photoCanvas.width  = Math.max(1, Math.round(rect.width));
      photoCanvas.height = Math.max(1, Math.round(rect.height));
    } else {
      photoCanvas.width  = cw;
      photoCanvas.height = ch;
    }

    const vw = cameraFeed.videoWidth;
    const vh = cameraFeed.videoHeight;
    if (!vw || !vh || cameraFeed.readyState < 2) {
      setTimeout(() => shutterButton.click(), 50);
      return;
    }

    const videoRatio  = vw / vh;
    const canvasRatio = photoCanvas.width / photoCanvas.height;
    let sx, sy, sWidth, sHeight;

    if (videoRatio > canvasRatio) {
      sHeight = vh;
      sWidth  = Math.round(vh * canvasRatio);
      sx = Math.round((vw - sWidth) / 2);
      sy = 0;
    } else {
      sWidth  = vw;
      sHeight = Math.round(vw / canvasRatio);
      sx = 0;
      sy = Math.round((vh - sHeight) / 2);
    }

    // 1) カメラ画像
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    canvasContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    
    // インカメラの場合、画像を水平反転させる (video要素の表示に合わせてcanvasも反転)
    if (currentFacingMode === 'user') {
      canvasContext.translate(photoCanvas.width, 0);
      canvasContext.scale(-1, 1);
    }

    canvasContext.drawImage(
      cameraFeed,
      sx, sy, sWidth, sHeight,
      0, 0, photoCanvas.width, photoCanvas.height
    );

    // 反転状態をリセット
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);

    // 2) フレーム（先に合成）
    await ensureFramesReady();
    drawFramesToCanvas();

    // 3) スタンプ（最後に合成＝最前面に見える）
    if (fcanvas) {
      canvasContext.drawImage(
        stampCanvasEl,
        0, 0, stampCanvasEl.width, stampCanvasEl.height,
        0, 0, photoCanvas.width, photoCanvas.height
      );
    }

    // ストリーム停止 → ビュー切替 → プレビュー
    stream.getTracks().forEach(t => t.stop());
    cameraFeed.srcObject = null;
    setCameraView(false);

    openPreviewModalWithCanvas(photoCanvas);
  });

  // プレビューモーダル操作
  previewSaveBtn.addEventListener('click', () => {
    const url = photoCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'photo_' + new Date().getTime() + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  previewShareBtn.addEventListener('click', async () => {
    try {
      if (navigator.canShare && lastCaptureBlob) {
        const file = new File([lastCaptureBlob], 'photo.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      }
      // フォールバック：保存に誘導
      const url = photoCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'photo_' + new Date().getTime() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      alert('共有がサポートされていないため、画像を保存しました。端末の共有機能からX/Instagramへ送ってください。');
    } catch (e) {
      console.warn('共有に失敗:', e);
      alert('共有に失敗しました。保存してから端末の共有機能をご利用ください。');
    }
  });

  function handlePreviewClose() { closePreviewModalAndRetake(); }
  previewCloseBtn.addEventListener('click', handlePreviewClose);
  previewCloseX .addEventListener('click', handlePreviewClose);

  // ページ離脱時にストリーム停止
  window.addEventListener('beforeunload', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
  });
});