document.addEventListener('DOMContentLoaded', async () => {
    const cameraFeed = document.getElementById('cameraFeed');
    const permissionModal = document.getElementById('permissionModal');
    const permissionMessage = document.getElementById('permissionMessage');
    const closeModalButton = document.getElementById('closeModalButton');

    let stream = null; // カメラのストリームを保持する変数

    try {
        // 背面カメラを優先し、見つからなければ他のカメラも許容する（フォールバックの可能性あり）
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment' // 'environment' を直接指定
            },
            audio: false
        });

        // 成功した場合
        cameraFeed.srcObject = stream;
        permissionMessage.textContent = 'カメラの使用が許可されました。';
        permissionModal.style.display = 'flex'; // モーダルを表示
        document.body.classList.add('modal-open'); // スクロールを無効にする

        // ここでFabric.jsの初期化を行うことも可能です
        // const canvas = new fabric.Canvas('photoCanvas'); // HTMLにcanvas要素があれば

    } catch (err) {
        // ユーザーが許可しなかった場合、またはエラーが発生した場合
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

    // モーダルを閉じるボタンのイベントリスナー
    closeModalButton.addEventListener('click', () => {
        permissionModal.style.display = 'none'; // モーダルを非表示にする
        document.body.classList.remove('modal-open'); // スクロールを有効にする
    });

    // ページを離れる際にカメラを停止する処理（オプション）
    window.addEventListener('beforeunload', () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
    });
});