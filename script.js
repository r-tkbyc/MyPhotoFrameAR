document.addEventListener('DOMContentLoaded', async () => {
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas');
    const shutterButton = document.getElementById('shutterButton');
    const retakeButton = document.getElementById('retakeButton');
    const permissionModal = document.getElementById('permissionModal');
    const permissionMessage = document.getElementById('permissionMessage');
    const closeModalButton = document.getElementById('closeModalButton');

    let stream = null;
    let canvasContext = photoCanvas.getContext('2d');

    // cameraFeedとphotoCanvasの表示を制御する関数
    const setCameraView = (isCameraActive) => {
        if (isCameraActive) {
            cameraFeed.classList.remove('hidden');
            photoCanvas.classList.add('hidden');
            shutterButton.classList.remove('hidden');
            retakeButton.classList.add('hidden');
        } else {
            cameraFeed.classList.add('hidden');
            photoCanvas.classList.remove('hidden');
            shutterButton.classList.add('hidden');
            retakeButton.classList.remove('hidden');
        }
    };

    const startCamera = async () => {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: 'environment' }
                },
                audio: false
            });

            cameraFeed.srcObject = stream;
            cameraFeed.play();

            // カメラが起動したらカメラビューに切り替える
            setCameraView(true);

        } catch (err) {
            console.error('カメラへのアクセスに失敗しました:', err);
            // ... (エラーメッセージの設定は既存のまま) ...
            permissionModal.style.display = 'flex';
            document.body.classList.add('modal-open');
        }
    };

    // 初期起動時のカメラ設定とモーダル表示
    await startCamera(); // カメラを起動
    
    // 許可ダイアログは初回起動時にのみ表示されるべきなので、メッセージが設定されていれば表示
    if (permissionMessage.textContent) {
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

        // Canvasのサイズをvideo要素に合わせる
        photoCanvas.width = cameraFeed.videoWidth;
        photoCanvas.height = cameraFeed.videoHeight;

        // videoの内容をCanvasに描画
        canvasContext.drawImage(cameraFeed, 0, 0, photoCanvas.width, photoCanvas.height);

        // カメラ映像を停止
        stream.getTracks().forEach(track => track.stop());
        cameraFeed.srcObject = null;

        // 撮影画像ビューに切り替える
        setCameraView(false);
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