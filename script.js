document.addEventListener('DOMContentLoaded', async () => {
    const cameraFeed = document.getElementById('cameraFeed');
    const photoCanvas = document.getElementById('photoCanvas'); // 追加
    const shutterButton = document.getElementById('shutterButton'); // 追加
    const retakeButton = document.getElementById('retakeButton'); // 追加
    const permissionModal = document.getElementById('permissionModal');
    const permissionMessage = document.getElementById('permissionMessage');
    const closeModalButton = document.getElementById('closeModalButton');

    let stream = null; // カメラのストリームを保持する変数
    let canvasContext = photoCanvas.getContext('2d'); // Canvasのコンテキスト

    // カメラを起動する関数
    const startCamera = async () => {
        try {
            // 既存のストリームがあれば停止
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            // 背面カメラへのアクセスを要求
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: 'environment' }
                },
                audio: false
            });

            cameraFeed.srcObject = stream;
            cameraFeed.play(); // カメラ映像を再生

            // モーダル表示は初回のみなので、ここでは非表示にする処理はしない

            // シャッターボタンを表示、再撮影ボタンを非表示
            shutterButton.classList.remove('hidden');
            retakeButton.classList.add('hidden');

            // video要素とcanvas要素の表示を切り替える
            cameraFeed.classList.remove('hidden'); // videoを表示
            photoCanvas.classList.add('hidden'); // canvasを非表示

        } catch (err) {
            console.error('カメラへのアクセスに失敗しました:', err);
            if (err.name === 'NotAllowedError') {
                permissionMessage.textContent = 'カメラの使用が拒否されました。ブラウザの設定で許可してください。';
            } else if (err.name === 'NotFoundError') {
                permissionMessage.textContent = 'カメラが見つかりませんでした。';
            } else {
                permissionMessage.textContent = 'カメラへのアクセス中にエラーが発生しました。';
            }
            permissionModal.style.display = 'flex'; // モーダルを表示
            document.body.classList.add('modal-open'); // スクロールを無効にする
        }
    };

    // 初期起動時のカメラ設定とモーダル表示
    try {
        await startCamera(); // カメラを起動

        permissionMessage.textContent = 'カメラの使用が許可されました。';
        permissionModal.style.display = 'flex'; // モーダルを表示
        document.body.classList.add('modal-open'); // スクロールを無効にする

    } catch (err) {
        // startCamera内でエラーハンドリングしているので、ここでは特に何もしない
        // 強制的にモーダルを表示するためにここにエラーメッセージを設定することも可能
    }

    // モーダルを閉じるボタンのイベントリスナー
    closeModalButton.addEventListener('click', () => {
        permissionModal.style.display = 'none'; // モーダルを非表示にする
        document.body.classList.remove('modal-open'); // スクロールを有効にする
    });

    // シャッターボタンのイベントリスナー
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
        cameraFeed.srcObject = null; // video要素からストリームを解放

        // video要素を非表示にし、canvasを表示
        cameraFeed.classList.add('hidden');
        photoCanvas.classList.remove('hidden');

        // シャッターボタンを非表示にし、再撮影ボタンを表示
        shutterButton.classList.add('hidden');
        retakeButton.classList.remove('hidden');
    });

    // 再撮影ボタンのイベントリスナー
    retakeButton.addEventListener('click', () => {
        startCamera(); // カメラを再起動
    });

    // ページを離れる際にカメラを停止する処理
    window.addEventListener('beforeunload', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });
});