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

  // フレーム画像（DOM上に配置されていることが前提）
  const frameTopEl    = document.getElementById('frameTop');
  const frameBottomEl = document.getElementById('frameBottom');
  // CSSの scale(0.65) に合わせる（表示と保存の見え方を一致）
  const FRAME_SCALE = 0.65;

  let stream = null;
  const canvasContext = photoCanvas.getContext('2d');

  // 共有用の一時データ（モーダル表示中のプレビュー画像）
  let lastCaptureBlob = null;
  let lastCaptureObjectURL = null;

  // カメラ表示/撮影結果の切り替え（旧save/retakeボタンは廃止済み）
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

  // ---- フレーム合成：表示と同じ（中央寄せ・上下端揃え・縮尺0.65）でキャンバスへ描画
  function drawFramesToCanvas() {
    const cw = photoCanvas.width;
    const ch = photoCanvas.height;
    const ctx = canvasContext;

    const drawOne = (imgEl, place) => {
      if (!imgEl) return;
      const doDraw = () => {
        const iw = imgEl.naturalWidth;
        const ih = imgEl.naturalHeight;
        if (!iw || !ih) return;
        const drawW = Math.round(iw * FRAME_SCALE);
        const drawH = Math.round(ih * FRAME_SCALE);
        const dx = Math.round((cw - drawW) / 2);         // 中央寄せ（はみ出しOK）
        const dy = (place === 'top') ? 0 : (ch - drawH); // 上端／下端揃え
        ctx.drawImage(imgEl, 0, 0, iw, ih, dx, dy, drawW, drawH);
      };
      if (imgEl.complete) doDraw();
      else imgEl.addEventListener('load', doDraw, { once: true });
    };

    drawOne(frameTopEl, 'top');
    drawOne(frameBottomEl, 'bottom');
  }

  // ---- モーダル用：canvas から Blob/URL を作って差し込む
  function openPreviewModalWithCanvas(canvas) {
    // 既存URLのクリーンアップ
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

  function refreshPreviewImageFromCanvas() {
    // すでにモーダルが開いている場合、合成更新を反映（フレーム画像が遅延ロードしたケースなど）
    if (!previewModal || previewModal.classList.contains('hidden')) return;
    if (lastCaptureObjectURL) {
      URL.revokeObjectURL(lastCaptureObjectURL);
      lastCaptureObjectURL = null;
    }
    photoCanvas.toBlob((blob) => {
      if (!blob) return;
      lastCaptureBlob = blob;
      lastCaptureObjectURL = URL.createObjectURL(blob);
      previewImage.src = lastCaptureObjectURL;
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

    // カメラ再起動（再撮影）
    startCamera();
  }

  // ---- シャッター：見えているサイズで撮影（object-fit:cover相当でクロップ）
  shutterButton.addEventListener('click', () => {
    if (!stream || !cameraFeed.srcObject) return;

    // キャンバスの出力サイズは可視のvideoと一致させる
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

    // 1) カメラ画像を描く
    canvasContext.setTransform(1, 0, 0, 1, 0, 0);
    canvasContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, photoCanvas.width, photoCanvas.height);

    // 2) 直後にフォトフレームを合成（表示と同じ見え方）
    drawFramesToCanvas();

    // 3) ストリーム停止 → 写真ビュー化 → モーダルにプレビュー
    stream.getTracks().forEach(t => t.stop());
    cameraFeed.srcObject = null;
    setCameraView(false);

    // フレームが遅延ロード中でも、まずは描けた分で表示
    openPreviewModalWithCanvas(photoCanvas);

    // もしフレーム画像がこの時点で未ロードだった場合、load後に再プレビュー更新
    const tryRefreshAfterLoad = (imgEl) => {
      if (!imgEl) return;
      if (imgEl.complete) {
        refreshPreviewImageFromCanvas();
      } else {
        imgEl.addEventListener('load', () => refreshPreviewImageFromCanvas(), { once: true });
      }
    };
    tryRefreshAfterLoad(frameTopEl);
    tryRefreshAfterLoad(frameBottomEl);
  });

  // ---- プレビューモーダルの操作
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
      // フォールバック：保存してから共有を案内
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
