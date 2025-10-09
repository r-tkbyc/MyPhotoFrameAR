// DOM取得
const cameraFeed      = document.getElementById('cameraFeed');
const overlayCanvasEl = document.getElementById('overlayCanvas');
const photoCanvas     = document.getElementById('photoCanvas');

const shutterButton = document.getElementById('shutterButton');
const saveButton    = document.getElementById('saveButton');
const retakeButton  = document.getElementById('retakeButton');

const frameSelect   = document.getElementById('frameSelect');
const stampFile     = document.getElementById('stampFile');
const clearOverlays = document.getElementById('clearOverlays');

const permissionModal   = document.getElementById('permissionModal');
const permissionMessage = document.getElementById('permissionMessage');
const retryButton       = document.getElementById('retryButton');

let stream = null;

// ===== カメラ起動（フォールバック付き） =====
const getStreamWithFallback = async () => {
  const trials = [
    { video: { facingMode: { exact: 'environment' } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr = null;
  for (const c of trials) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
};

const startCamera = async () => {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await getStreamWithFallback();
    cameraFeed.srcObject = stream;
    await cameraFeed.play();

    setCameraView(true);

    // 成功時はモーダル非表示
    permissionMessage.textContent = '';
    permissionModal.style.display = 'none';
    document.body.classList.remove('modal-open');

    // videoサイズが得られたらオーバーレイを合わせる
    await ensureVideoMetadata();
    syncOverlaySize();

  } catch (err) {
    console.error('カメラへのアクセスに失敗:', err);
    let msg = 'カメラへのアクセス中にエラーが発生しました。';
    if (err.name === 'NotAllowedError') msg = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
    else if (err.name === 'NotFoundError' || err.name === 'OverConstrainedError') msg = 'カメラが見つからないか、指定条件で起動できませんでした。';
    permissionMessage.textContent = msg;
    permissionModal.style.display = 'flex';
    document.body.classList.add('modal-open');
  }
};

const ensureVideoMetadata = () => new Promise((resolve) => {
  if (cameraFeed.videoWidth && cameraFeed.videoHeight) return resolve();
  cameraFeed.addEventListener('loadedmetadata', () => resolve(), { once: true });
});

// ===== fabric.js 初期化 =====
const fcanvas = new fabric.Canvas('overlayCanvas', {
  backgroundColor: 'transparent',
  selection: true,
  preserveObjectStacking: true,
});

// 見やすいコントロール（角のハンドル）設定（任意）
fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.cornerStyle = 'circle';
fabric.Object.prototype.cornerColor = '#4aa3ff';
fabric.Object.prototype.borderColor = '#4aa3ff';
fabric.Object.prototype.cornerSize = 14;

// リサイズ（videoに追従）
const syncOverlaySize = () => {
  const rect = cameraFeed.getBoundingClientRect();
  overlayCanvasEl.width  = rect.width;
  overlayCanvasEl.height = rect.height;
  fcanvas.setWidth(rect.width);
  fcanvas.setHeight(rect.height);
  fcanvas.requestRenderAll();
};

window.addEventListener('resize', () => {
  // 見た目比率を維持する簡易対応：サイズだけ合わせる
  syncOverlaySize();
});

// ===== フレーム（最背面・非選択） =====
let frameObj = null;
const setFrame = (src) => {
  // 既存のフレームを消す
  if (frameObj) { fcanvas.remove(frameObj); frameObj = null; }

  if (!src) {
    fcanvas.requestRenderAll();
    return;
  }
  fabric.Image.fromURL(src, (img) => {
    // キャンバス全体にフィット（contain）
    const cw = fcanvas.getWidth();
    const ch = fcanvas.getHeight();
    const scale = Math.min(cw / img.width, ch / img.height);
    img.set({
      selectable: false,
      evented: false,
      hasControls: false,
      left: (cw - img.width * scale) / 2,
      top:  (ch - img.height * scale) / 2,
      scaleX: scale,
      scaleY: scale,
      opacity: 1,
    });
    frameObj = img;
    fcanvas.add(img);
    img.moveTo(0); // 最背面
    fcanvas.requestRenderAll();
  }, { crossOrigin: 'anonymous' });
};

// ===== スタンプ追加 =====
const addStampByURL = (src) => {
  fabric.Image.fromURL(src, (img) => {
    // キャンバス幅の30%程度で出す
    const cw = fcanvas.getWidth();
    const targetW = cw * 0.3;
    const scale = targetW / img.width;

    img.set({
      left: cw * 0.5 - (img.width * scale) / 2,
      top: fcanvas.getHeight() * 0.5 - (img.height * scale) / 2,
      scaleX: scale,
      scaleY: scale,
      hasRotatingPoint: true,
      cornerStyle: 'circle'
    });
    // フレームより手前に置きたいので、フレームがあればその上に
    if (frameObj) fcanvas.add(img).bringToFront(img);
    else fcanvas.add(img);
    fcanvas.setActiveObject(img);
    fcanvas.requestRenderAll();
  }, { crossOrigin: 'anonymous' });
};

// ファイルアップロードからスタンプ
stampFile.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => addStampByURL(reader.result);
  reader.readAsDataURL(file);
  // 同じファイルを続けて選べるように値クリア
  e.target.value = '';
});

// プリセットスタンプボタン
document.querySelectorAll('button[data-stamp]').forEach(btn => {
  btn.addEventListener('click', () => {
    const src = btn.getAttribute('data-stamp');
    addStampByURL(src);
  });
});

// フレーム選択
frameSelect.addEventListener('change', () => {
  setFrame(frameSelect.value || '');
});

// クリア（フレーム以外を削除）
clearOverlays.addEventListener('click', () => {
  const toRemove = fcanvas.getObjects().filter(o => o !== frameObj);
  toRemove.forEach(o => fcanvas.remove(o));
  fcanvas.discardActiveObject();
  fcanvas.requestRenderAll();
});

// ===== 撮影・保存・再撮影 =====
const setCameraView = (isLive) => {
  cameraFeed.classList.toggle('hidden', !isLive);
  overlayCanvasEl.classList.toggle('hidden', !isLive);
  shutterButton.classList.toggle('hidden', !isLive);

  photoCanvas.classList.toggle('hidden', isLive);
  saveButton.classList.toggle('hidden', isLive);
  retakeButton.classList.toggle('hidden', isLive);
};

// 撮影
shutterButton.addEventListener('click', async () => {
  if (!stream || !cameraFeed.srcObject) return;

  // DPR対応で高解像度に
  const dpr = window.devicePixelRatio || 1;
  const vw = cameraFeed.videoWidth;
  const vh = cameraFeed.videoHeight;

  // 出力キャンバス
  photoCanvas.width  = Math.round(vw * dpr);
  photoCanvas.height = Math.round(vh * dpr);
  const ctx = photoCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 1) まず動画フレームを描画
  ctx.drawImage(cameraFeed, 0, 0, vw, vh);

  // 2) fabricのオーバーレイを合成
  // overlayCanvas は画面サイズ（CSSピクセル）なので、videoの実サイズへスケーリングして重ねる
  const overlayCanvasCSS = fcanvas.toCanvasElement({ multiplier: 1 }); // 画面見た目サイズ
  // 画面の見た目サイズ -> 動画のピクセルサイズへのスケール
  const rect = cameraFeed.getBoundingClientRect();
  const scaleX = vw / rect.width;
  const scaleY = vh / rect.height;

  ctx.save();
  ctx.scale(scaleX, scaleY);
  ctx.drawImage(overlayCanvasCSS, 0, 0);
  ctx.restore();

  // 撮影後はストップ
  stream.getTracks().forEach(t => t.stop());
  cameraFeed.srcObject = null;

  setCameraView(false);
});

// 保存（iOSフォールバックあり）
saveButton.addEventListener('click', () => {
  const dataURL = photoCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = `photo_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;

  if (typeof a.download === 'string') {
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // iOS Safariなど download属性が効かない場合
    window.open(dataURL, '_blank');
  }
});

// 再撮影
retakeButton.addEventListener('click', async () => {
  await startCamera();
  setCameraView(true);
});

// 起動時
retryButton.addEventListener('click', startCamera);
window.addEventListener('DOMContentLoaded', startCamera);
