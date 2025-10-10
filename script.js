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

    let stream = null;
    const canvasContext = photoCanvas.getContext('2d');

    // 共有用の一時データ
    let lastCaptureBlob = null;
    let lastCaptureObjectURL = null;

    // カメラ表示/撮影結果の切り替え（旧save/retakeボタン操作は廃止）
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

    // プレビューモーダル表示
    function openPreviewModalWithCanvas(canvas) {
        // 後片付け
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

        // 再撮影（カメラ再起動）
        startCamera();
    }

    // シャッター：見えているサイズで撮影（object-fit:cover相当でクロップ）
    shutterButton.addEventListener('click', () => {
        if (!stream || !cameraFeed.srcObject) return;

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

        canvasContext.setTransform(1, 0, 0, 1, 0, 0);
        canvasContext.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
        canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, photoCanvas.width, photoCanvas.height);

        // （必要ならここでフレーム合成を実行。現状維持なら省略）

        // 停止 → 撮影ビュー切替
        stream.getTracks().forEach(t => t.stop());
        cameraFeed.srcObject = null;
        setCameraView(false);

        // モーダルにプレビュー表示
        openPreviewModalWithCanvas(photoCanvas);
    });

    // プレビューモーダルの操作
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
            // フォールバック：保存して案内
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
