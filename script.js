document.addEventListener('DOMContentLoaded', async () => {
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas');
    const shutterButton = document.getElementById('shutterButton');
    const saveButton = document.getElementById('saveButton'); // 追加
    const retakeButton = document.getElementById('retakeButton');
    const permissionModal = document.getElementById('permissionModal');
    const permissionMessage = document.getElementById('permissionMessage');
    const closeModalButton = document.getElementById('closeModalButton');

    // ▼ 追記：プレビュー用モーダルの参照
    const previewModal    = document.getElementById('previewModal');
    const previewImage    = document.getElementById('previewImage');
    const previewSaveBtn  = document.getElementById('previewSaveBtn');
    const previewShareBtn = document.getElementById('previewShareBtn');
    const previewCloseBtn = document.getElementById('previewCloseBtn');
    const previewCloseX   = document.getElementById('previewCloseX');

    let stream = null;
    let canvasContext = photoCanvas.getContext('2d');

    // ▼ 追記：共有用の一時データ
    let lastCaptureBlob = null;
    let lastCaptureObjectURL = null;

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

    // ▼ 追記：プレビュー用モーダル制御
    function openPreviewModalWithCanvas(canvas) {
        // 既存URLのクリーンアップ
        if (lastCaptureObjectURL) {
            URL.revokeObjectURL(lastCaptureObjectURL);
            lastCaptureObjectURL = null;
        }
        lastCaptureBlob = null;

        // Blob作成してプレビューへ
        canvas.toBlob((blob) => {
            if (!blob) {
                // フォールバック：dataURLで表示
                previewImage.src = canvas.toDataURL('image/png');
            } else {
                lastCaptureBlob = blob;
                lastCaptureObjectURL = URL.createObjectURL(blob);
                previewImage.src = lastCaptureObjectURL;
            }
            // モーダルを開く
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

        // 再撮影（従来の再起動）
        startCamera();
    }

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

      // ▼ 追記：フレームの合成（現状のまま／必要に応じて既存処理を維持）
      // もし既に別箇所でフレーム描画を行っている場合は、その処理を残してください。
      // （ここでは追加の変更はしません）

      // 3) 描画が終わってからストリーム停止＆ビュー切り替え
      stream.getTracks().forEach(track => track.stop());
      cameraFeed.srcObject = null;

      setCameraView(false); // 撮影画像ビューへ（保存ボタンが出る）

      // ▼ 追記：撮影後プレビュー・モーダルを開く
      openPreviewModalWithCanvas(photoCanvas);
    });

    // 保存ボタン（既存。プレビュー上の保存でも同等の動作をします）
    saveButton.addEventListener('click', () => {
        const imageDataURL = photoCanvas.toDataURL('image/png'); // PNG形式で取得
        const a = document.createElement('a');
        a.href = imageDataURL;
        a.download = 'photo_' + new Date().getTime() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    retakeButton.addEventListener('click', () => {
        startCamera(); // カメラを再起動
    });

    window.addEventListener('beforeunload', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });

    // ▼ 追記：プレビューモーダルのボタン群
    previewSaveBtn?.addEventListener('click', () => {
        // 従来保存と同じ（dataURLダウンロード）
        const imageDataURL = photoCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = imageDataURL;
        a.download = 'photo_' + new Date().getTime() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    });

    previewShareBtn?.addEventListener('click', async () => {
        try {
            if (navigator.canShare && lastCaptureBlob) {
                const file = new File([lastCaptureBlob], 'photo.png', { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                    await navigator.share({ files: [file] });
                    return;
                }
            }
            // フォールバック：保存してから共有を案内
            const imageDataURL = photoCanvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = imageDataURL;
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

    function handlePreviewClose() {
        closePreviewModalAndRetake();
    }
    previewCloseBtn?.addEventListener('click', handlePreviewClose);
    previewCloseX ?.addEventListener('click', handlePreviewClose);
});
