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
  const FRAME_SCALE = 0.65; // CSSと一致

  // スタンプ（Fabric）
  const stampCanvasEl = document.getElementById('stampCanvas');
  const stampButton   = document.getElementById('stampButton');
  const stampSheet    = document.getElementById('stampSheet');
  const sheetCloseBtn = document.getElementById('sheetCloseBtn');

  let fcanvas = null;   // Fabric.Canvas
  let isSheetOpen = false;

  let stream = null;
  const canvasContext = photoCanvas.getContext('2d');

  // プレビュー画像の一時データ
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;

  // カメラ表示/撮影結果の切替
  const setCameraView = (isCameraActive) => {
    if (isCameraActive) {
      cameraFeed.classList.remove('hidden');
      photoCanvas.classList.add('hidden');
      shutterButton.classList.remove('hidden');
    } else {
      cameraFeed.classList.add('hidden');
      photoCanvas.classList.remove('hidden');
      shutterButton.classList.add('hidden');
    }
  };

  const startCamera = async () => {
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());

      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
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

      const settings = track.getSettings ? track.getSettings() : {};
      console.log('Active camera resolution =', settings.width, 'x', settings.height);

      setCameraView(true);
      permissionMessage.textContent = 'カメラの使用が許可されました。';

      // 初回に Fabric 初期化
      initFabricCanvas();
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

  await startCamera();

  if (permissionMessage.textContent || cameraFeed.srcObject) {
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

  // ---- フレーム合成（表示と一致）
  function drawFramesToCanvas() {
    const cw = photoCanvas.width;
    const ch = photoCanvas.height;
    const ctx = canvasContext;

    const drawOne = (imgEl, place) => {
      if (!imgEl) return;
      const iw = imgEl.naturalWidth;
      const ih = imgEl.naturalHeight;
      if (!iw || !ih) return;
      const drawW = Math.round(iw * FRAME_SCALE);
      const drawH = Math.round(ih * FRAME_SCALE);
      const dx = Math.round((cw - drawW) / 2);
      const dy = (place === 'top') ? 0 : (ch - drawH);
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
  function initFabricCanvas() {
    if (fcanvas) { resizeStampCanvas(); return; }

    fcanvas = new fabric.Canvas(stampCanvasEl, {
      selection: true,
      preserveObjectStacking: true
    });
    resizeStampCanvas();
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
    const cssW = fcanvas.getWidth();
    const cssH = fcanvas.getHeight();

    fabric.Image.fromURL(url, (img) => {
      img.set({
        originX: 'center',
        originY: 'center',
        left: cssW / 2,
        top:  cssH / 2,
        selectable: true,
        transparentCorners: false,
        cornerColor: '#ff5b82',
        cornerStyle: 'circle',
        borderColor: '#ff5b82',
        cornerSize: 14
      });
      const base = Math.min(cssW, cssH) * 0.3; // 初期サイズ：短辺の30%
      const scale = base / img.width;
      img.scale(scale);

      fcanvas.add(img);
      fcanvas.setActiveObject(img);
      fcanvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }

  function openStampSheet() {
    stampSheet.classList.add('open');
    isSheetOpen = true;
    stampCanvasEl.classList.add('interactive'); // 編集中はタッチ拾う
  }
  function closeStampSheet() {
    stampSheet.classList.remove('open');
    isSheetOpen = false;
    stampCanvasEl.classList.remove('interactive');
  }

  stampButton?.addEventListener('click', () => {
    if (!fcanvas) initFabricCanvas();
    if (isSheetOpen) closeStampSheet(); else openStampSheet();
  });
  sheetCloseBtn?.addEventListener('click', closeStampSheet);

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.stamp-thumb');
    if (!btn) return;
    const src = btn.getAttribute('data-src');
    if (src) {
      addStampFromURL(src);
      // closeStampSheet(); // 自動で閉じたければ有効化
    }
  });

  window.addEventListener('resize', () => {
    resizeStampCanvas();
    if (fcanvas) fcanvas.calcOffset();
  });

  // =================== シャッター（スタンプ合成を追加） ===================
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
    canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, photoCanvas.width, photoCanvas.height);

    // 1.5) スタンプ（Fabricキャンバス）を合成
    if (fcanvas) {
      canvasContext.drawImage(
        stampCanvasEl,
        0, 0, stampCanvasEl.width, stampCanvasEl.height,
        0, 0, photoCanvas.width, photoCanvas.height
      );
    }

    // 2) フレーム（ロード完了を保証 → 合成）
    await ensureFramesReady();
    drawFramesToCanvas();

    // 3) ストリーム停止 → ビュー切替 → プレビュー
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
