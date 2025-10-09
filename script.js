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

        // キャンバスを「見えているサイズ（CSS）」に合わせる
        const cw = photoCanvas.clientWidth;
        const ch = photoCanvas.clientHeight;
        photoCanvas.width  = cw;
        photoCanvas.height = ch;

        // CSSの object-fit: cover と同じ見え方でクロップ描画
        const vw = cameraFeed.videoWidth;
        const vh = cameraFeed.videoHeight;
        const videoRatio  = vw / vh;
        const canvasRatio = cw / ch;
        let sx, sy, sWidth, sHeight;
        if (videoRatio > canvasRatio) {
          // 動画の方が横に広い → 左右をカット
          sHeight = vh;
          sWidth  = vh * canvasRatio;
          sx = (vw - sWidth) / 2;
          sy = 0;
        } else {
          // 動画の方が縦に長い → 上下をカット
          sWidth  = vw;
          sHeight = vw / canvasRatio;
          sx = 0;
          sy = (vh - sHeight) / 2;
        }
        canvasContext.drawImage(cameraFeed, sx, sy, sWidth, sHeight, 0, 0, cw, ch);

        stream.getTracks().forEach(track => track.stop());
        cameraFeed.srcObject = null;

        setCameraView(false); // 撮影画像ビューに切り替える (保存ボタンも表示される)
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