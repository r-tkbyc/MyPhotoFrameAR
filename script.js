document.addEventListener('DOMContentLoaded', async () => {
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas');
    const shutterButton = document.getElementById('shutterButton');
    const saveButton = document.getElementById('saveButton'); // 追加
    const retakeButton = document.getElementById('retakeButton');
    const permissionModal = document.getElementById('permissionModal');
    const permissionMessage = document.getElementById('permissionMessage');
    const closeModalButton = document.getElementById('closeModalButton');

    let stream = null;
    let canvasContext = photoCanvas.getContext('2d');

    // ★ 追加：フレームDOM参照と高さ固定ユーティリティ
    const frameTopEl    = document.getElementById('frameTop');
    const frameBottomEl = document.getElementById('frameBottom');

    function lockFrameHeightsOnce(imgEl) {
        if (!imgEl) return;
        const apply = () => {
            if (imgEl.naturalHeight) {
                // 縦は画像の元の高さそのまま（横はCSSで100%）
                imgEl.style.height = imgEl.naturalHeight + 'px';
            }
        };
        if (imgEl.complete) apply();
        else imgEl.addEventListener('load', apply, { once: true });
    }

    // ★ 追加：ロード時に高さを固定
    lockFrameHeightsOnce(frameTopEl);
    lockFrameHeightsOnce(frameBottomEl);

    // cameraFeedとphotoCanvasの表示を制御する関数
    const setCameraView = (isCameraActive) => {
        if (isCameraActive) {
            cameraFeed.classList.remove('hidden');
            photoCanvas.classList.add('hidden');
            shutterButton.classList.remove('hidden');
            saveButton.classList.add('hidden');    // 保存ボタンを非表示
            retakeButton.classList.add('hidden');
        } else {
            cameraFeed.classList.add('hidden');
            photoCanvas.classList.remove('hidden');
            shutterButton.classList.add('hidden');
            saveButton.classList.remove('hidden'); // 保存ボタンを表示
            retakeButton.classList.remove('hidden');
        }
    };

    const startCamera = async () => {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    // 端末任せで最大に近い解像度を狙う
                    facingMode: { ideal: 'environment' }, // exactは機種で失敗が出やすい
                    width:  { ideal: 4096 },
                    height: { ideal: 4096 }
                }
            });

            // capabilities を見て最大値にさらに寄せる
            const track = stream.getVideoTracks()[0];
            const caps = track.getCapabilities ? track.getCapabilities() : null;
            if (caps && caps.width && caps.height) {
              try {
                await track.applyConstraints({
                  width:  { ideal: caps.width.max },
                  height: { ideal: caps.height.max }
                });
              } catch (e) {
                console.warn('applyConstraints skipped:', e);
              }
            }

            cameraFeed.srcObject = stream;
            cameraFeed.play();

            const settings = track.getSettings ? track.getSettings() : {};
            console.log('Active camera resolution =', settings.width, 'x', settings.height);

            setCameraView(true);
            
            permissionMessage.textContent = 'カメラの使用が許可されました。'; 

        } catch (err) {
            console.error('カメラへのアクセスに失敗しました:', err);
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

    shutterButton.addEventListener('click', () => {
      if (!stream || !cameraFeed.srcObject) {
        console.warn('カメラが起動していません。');
        return;
      }

      // 1) 「見えているサイズ」は非表示の canvas ではなく、可視の video から取る
      const cw = cameraFeed.clientWidth;
      const ch = cameraFeed.clientHeight;

      // 念のためのフォールバック（極端なケースで 0 を避ける）
      if (!cw || !ch) {
        const containerRect = document.querySelector('.container').getBoundingClientRect();
        photoCanvas.width  = Math.max(1, Math.round(containerRect.width));
        photoCanvas.height = Math.max(1, Math.round(containerRect.height));
      } else {
        photoCanvas.width  = cw;
        photoCanvas.height = ch;
      }

      // 2) CSSの object-fit: cover と同じ見え方でクロップして描画
      const vw = cameraFeed.videoWidth;
      const vh = cameraFeed.videoHeight;

      // readyState が足りないと iOS/Safari で黒くなることがあるので保険
      if (!vw || !vh || cameraFeed.readyState < 2) {
        // 何も描けない状態なら、少し待ってから再試行（最小ディレイ）
        setTimeout(() => shutterButton.click(), 50);
        return;
      }

      const videoRatio  = vw / vh;
      const canvasRatio = photoCanvas.width / photoCanvas.height;
      let sx, sy, sWidth, sHeight;

      if (videoRatio > canvasRatio) {
        // 動画の方が横に広い → 左右をカット
        sHeight = vh;
        sWidth  = Math.round(vh * canvasRatio);
        sx = Math.round((vw - sWidth) / 2);
        sy = 0;
      } else {
        // 動画の方が縦に長い → 上下をカット
        sWidth  = vw;
        sHeight = Math.round(vw / canvasRatio);
        sx = 0;
        sy = Math.round((vh - sHeight) / 2);
      }

      // 以前の transform が残って黒くなるのを避けるために一旦リセット
      canvasContext.setTransform(1, 0, 0, 1, 0, 0);
      canvasContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
      canvasContext.drawImage(
        cameraFeed,
        sx, sy, sWidth, sHeight,   // ソース（切り出し範囲）
        0, 0, photoCanvas.width, photoCanvas.height // 出力（見えているサイズ）
      );

      // ★ 追加：フレームをキャンバスに合成（見た目どおり）
      const drawFrame = (imgEl, place) => {
        if (!imgEl || !imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) return;
        const targetW = photoCanvas.width;           // 横は端末幅いっぱい
        const targetH = imgEl.naturalHeight;         // 縦は元画像の高さそのまま
        const dx = 0;
        const dy = (place === 'top') ? 0 : (photoCanvas.height - targetH);
        canvasContext.drawImage(
          imgEl,
          0, 0, imgEl.naturalWidth, imgEl.naturalHeight,
          dx, dy, targetW, targetH
        );
      };
      drawFrame(frameTopEl, 'top');
      drawFrame(frameBottomEl, 'bottom');

      // 3) 描画が終わってからストリーム停止＆ビュー切り替え
      stream.getTracks().forEach(track => track.stop());
      cameraFeed.srcObject = null;

      setCameraView(false); // 撮影画像ビューへ（保存ボタンが出る）
    });

    // 保存ボタンのイベントリスナー (追加)
    saveButton.addEventListener('click', () => {
        // canvasの内容を画像データURLとして取得
        const imageDataURL = photoCanvas.toDataURL('image/png'); // PNG形式で取得

        // ダウンロード用のリンク要素を作成
        const a = document.createElement('a');
        a.href = imageDataURL;
        a.download = 'photo_' + new Date().getTime() + '.png'; // ファイル名を生成
        document.body.appendChild(a); // DOMに追加 (一時的)
        a.click(); // クリックしてダウンロードをトリガー
        document.body.removeChild(a); // リンク要素を削除
    });

    retakeButton.addEventListener('click', () => {
        startCamera(); // カメラを再起動
    });

    window.addEventListener('beforeunload', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });
});
