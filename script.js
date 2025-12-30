const canvas = document.getElementById('gameCanvas');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const lobbyMenu = document.getElementById('lobbyMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

let score = 0, timeLeft = 30, gameActive = false;
let sensitivity = 0.002, yaw = 0, pitch = 0;
let peer = null, connections = {}, playersState = {};

// --- 1. Three.js 3D 初始化 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

// 燈光與環境
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

// 輔助地板
const grid = new THREE.GridHelper(100, 50, 0x00ff88, 0x222222);
grid.position.y = -2;
scene.add(grid);

// 目標球體管理
let targets = [];
const targetGeo = new THREE.SphereGeometry(0.6, 32, 32);

function spawnTarget() {
    const mat = new THREE.MeshPhongMaterial({ color: 0x00d4ff, emissive: 0x002233 });
    const mesh = new THREE.Mesh(targetGeo, mat);
    mesh.position.set((Math.random()-0.5)*20, Math.random()*5, -Math.random()*15 - 5);
    scene.add(mesh);
    targets.push(mesh);
}

// --- 2. 視角與射擊控制 ---
document.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas) {
        yaw -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
        pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

const raycaster = new THREE.Raycaster();
window.addEventListener('mousedown', () => {
    if (!gameActive) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }

    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = raycaster.intersectObjects(targets);

    if (hits.length > 0) {
        const obj = hits[0].object;
        scene.remove(obj);
        targets = targets.filter(t => t !== obj);
        score += 100;
        scoreElement.innerText = score;
        playersState[peer.id].score = score;
        updateLeaderboard();
        broadcast({ type: 'scoreUpdate', id: peer.id, score: score });
    }
});

// --- 1. 修改：在宣告區下方直接定義產生 ID 的函式 ---

function generateRandomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 2. 新增：初始化填寫代碼的函式
function initRoomCode() {
    const roomInput = document.getElementById('roomCodeInput');
    if (roomInput && !roomInput.value) {
        roomInput.value = generateRandomCode();
    }
}

// 3. 在原本的頁面載入位置執行
window.addEventListener('load', () => {
    initRoomCode(); // 進入網頁立刻產生代碼
});

// --- 3. 多人連線邏輯 (解決連線錯誤) ---
function joinRoom(role) {
    const nameInput = document.getElementById('playerNameInput');
    const codeInput = document.getElementById('roomCodeInput');
    const statusDisplay = document.getElementById('connStatus'); // 修正 ID 引用

    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();

    if (!name || !code) {
        alert("請輸入名稱與房間代碼！");
        return;
    }

    // 更新狀態文字，讓使用者知道點擊有效
    statusDisplay.innerText = "狀態: 正在建立連線...";
    statusDisplay.style.color = "#ffcc00";

    if (peer) peer.destroy();

    // 房主以代碼為 ID；加入者由系統分配 ID
    const peerId = (role === 'host') ? code : null;
    peer = new Peer(peerId);

    peer.on('open', (id) => {
        playersState[id] = { name: name, ready: false, score: 0 };
        document.getElementById('displayRoomCode').innerText = code;
        
        if (role === 'host') {
            enterLobby();
            statusDisplay.innerText = "狀態: 房間已建立 (房主)";
            statusDisplay.style.color = "#00ff88";
        } else {
            statusDisplay.innerText = "狀態: 正在尋找房間 " + code + "...";
            const conn = peer.connect(code);
            setupConnection(conn);
        }
    });

    peer.on('connection', setupConnection);

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err.type);
        statusDisplay.style.color = "#ff4757";
        if (err.type === 'unavailable-id') {
            alert('房間代碼已存在，請換一個代碼或嘗試「加入房間」。');
            statusDisplay.innerText = "狀態: ID 重複";
        } else if (err.type === 'peer-not-found') {
            alert('找不到該房間代碼，請確認房主是否已建立房間。');
            statusDisplay.innerText = "狀態: 找不到房間";
        } else {
            alert("連線錯誤: " + err.type);
            statusDisplay.innerText = "狀態: 出錯";
        }
        // 錯誤時回到初始狀態
        setTimeout(() => location.reload(), 2000);
    });
}

function enterLobby() {
    startMenu.style.display = 'none';
    lobbyMenu.style.display = 'block';
    updateLobbyUI();
}

function setupConnection(conn) {
    // 進入大廳
    enterLobby();

    conn.on('open', () => {
        connections[conn.peer] = conn;
        document.getElementById('connStatus').innerText = "狀態: 已成功連線";
        document.getElementById('connStatus').style.color = "#00ff88";
        // 發送初始資訊
        conn.send({ type: 'initInfo', name: playersState[peer.id].name });
    });

    conn.on('data', (data) => {
        if (data.type === 'initInfo') {
            playersState[conn.peer] = { name: data.name, ready: false, score: 0 };
            updateLobbyUI();
            if (!data.reply) {
                conn.send({ type: 'initInfo', name: playersState[peer.id].name, reply: true });
            }
        } else if (data.type === 'readyStatus') {
            if (playersState[conn.peer]) {
                playersState[conn.peer].ready = data.status;
                updateLobbyUI();
                checkAllReady();
            }
        } else if (data.type === 'gameStart') {
            realStartGame();
        } else if (data.type === 'scoreUpdate') {
            if (playersState[data.id]) {
                playersState[data.id].score = data.score;
                updateLeaderboard();
            }
        }
    });

    conn.on('close', () => {
        delete connections[conn.peer];
        delete playersState[conn.peer];
        updateLobbyUI();
        document.getElementById('connStatus').innerText = "狀態: 對方已離線";
        document.getElementById('connStatus').style.color = "#ff4757";
    });
}

function broadcast(data) {
    Object.values(connections).forEach(c => c.send(data));
}

function pressReady() {
    playersState[peer.id].ready = !playersState[peer.id].ready;
    document.getElementById('readyBtn').innerText = playersState[peer.id].ready ? "取消準備" : "準備開始";
    updateLobbyUI();
    broadcast({ type: 'readyStatus', status: playersState[peer.id].ready });
    checkAllReady();
}

function updateLobbyUI() {
    const list = document.getElementById('playerList');
    list.innerHTML = Object.entries(playersState).map(([id, s]) => 
        `<div class="player-tag ${s.ready ? 'ready' : ''}">${s.name}${id === peer.id ? ' (我)' : ''}</div>`
    ).join('');
}

function checkAllReady() {
    if (Object.values(playersState).every(p => p.ready)) {
        broadcast({ type: 'gameStart' });
        realStartGame();
    }
}

function realStartGame() {
    gameActive = true;
    lobbyMenu.style.display = 'none';
    
    // 新增：遊戲開始時顯示準心
    document.getElementById('crosshair').style.display = 'block'; 

    canvas.requestPointerLock();
    const itv = setInterval(() => {
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(itv);
            endGame(); // 建議呼叫 endGame 而不是直接 reload
        }
    }, 1000);
}

function updateLeaderboard() {
    const sorted = Object.entries(playersState).sort((a,b)=>b[1].score-a[1].score);
    leaderList.innerHTML = sorted.map(([id, s]) => `<li>${s.name}: ${s.score}</li>`).join('');
}

// 遊戲渲染循環
function render() {
    requestAnimationFrame(render);
    if (gameActive && targets.length < 5) spawnTarget();
    renderer.render(scene, camera);
}
render();

// 靈敏度與縮放修正
sensRange.addEventListener('input', (e) => {
    sensitivity = parseFloat(e.target.value);
    sensValue.innerText = sensitivity;
});
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function endGame() {
    gameActive = false;
    document.exitPointerLock();
    
    // 新增：遊戲結束時隱藏準心
    document.getElementById('crosshair').style.display = 'none'; 

    alert(`遊戲結束！你的得分是: ${score}`);
    location.reload(); 
}