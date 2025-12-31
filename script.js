const canvas = document.getElementById('gameCanvas');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const lobbyMenu = document.getElementById('lobbyMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

// 新增 UI 變數
const ingameMenu = document.getElementById('ingameMenu');
const ingameSensRange = document.getElementById('ingameSensRange');
const ingameSensValue = document.getElementById('ingameSensValue');
const settingsIcon = document.getElementById('settingsIcon');

let score = 0, timeLeft = 30, gameActive = false;
let sensitivity = 0.002, yaw = 0, pitch = 0;
let peer = null, connections = {}, playersState = {};
let isPractice = false;

// --- 3D 初始化 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

camera.position.set(0, 1.6, 5);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

const grid = new THREE.GridHelper(100, 50, 0x00ff88, 0x222222);
grid.position.y = -2;
scene.add(grid);

let targets = [];
const targetGeo = new THREE.SphereGeometry(0.6, 32, 32);

function spawnTarget() {
    const mat = new THREE.MeshPhongMaterial({ color: 0x00d4ff, emissive: 0x002233 });
    const mesh = new THREE.Mesh(targetGeo, mat);
    mesh.position.set((Math.random()-0.5)*20, Math.random()*5, -Math.random()*15 - 5);
    scene.add(mesh);
    targets.push(mesh);
}

// --- 控制與射擊 ---
document.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas && ingameMenu.style.display === 'none') {
        yaw -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
        pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

// Esc 鍵功能
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameActive) {
        if (ingameMenu.style.display === 'none') openIngameMenu();
        else resumeGame();
    }
});

const raycaster = new THREE.Raycaster();
window.addEventListener('mousedown', (e) => {
    if (!gameActive || ingameMenu.style.display !== 'none') return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = raycaster.intersectObjects(targets);
    if (hits.length > 0) {
        const obj = hits[0].object;
        scene.remove(obj);
        targets = targets.filter(t => t !== obj);
        score += 100;
        scoreElement.innerText = score;
        if (peer && playersState[peer.id]) {
            playersState[peer.id].score = score;
            updateLeaderboard();
            broadcast({ type: 'scoreUpdate', id: peer.id, score: score });
        }
    }
});

// --- 遊戲中選單邏輯 ---
function openIngameMenu() {
    ingameMenu.style.display = 'block';
    ingameSensRange.value = sensitivity;
    ingameSensValue.innerText = sensitivity;
    document.exitPointerLock();
}

function resumeGame() {
    ingameMenu.style.display = 'none';
    canvas.requestPointerLock();
}

function quitToLobby() {
    ingameMenu.style.display = 'none';
    settingsIcon.style.display = 'none';
    if (isPractice) {
        stopPractice();
    } else {
        location.reload();
    }
}

// --- 模式切換 ---
function startPractice() {
    applySensitivity();
    isPractice = true;
    gameActive = true;
    score = 0;
    scoreElement.innerText = score;
    lobbyMenu.style.display = 'none';
    document.getElementById('crosshair').style.display = 'block';
    document.getElementById('exitPracticeBtn').style.display = 'block';
    settingsIcon.style.display = 'block';
    canvas.requestPointerLock();
}

function stopPractice() {
    isPractice = false;
    gameActive = false;
    targets.forEach(t => scene.remove(t));
    targets = [];
    lobbyMenu.style.display = 'block';
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('exitPracticeBtn').style.display = 'none';
    settingsIcon.style.display = 'none';
    document.exitPointerLock();
}

// --- 房間邏輯與 PeerJS (保留原功能) ---
function generateRandomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let res = '';
    for (let i = 0; i < 5; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return res;
}

window.addEventListener('load', () => {
    document.getElementById('roomCodeInput').value = generateRandomCode();
});

function handleEntry() {
    const name = document.getElementById('playerNameInput').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    if (!name || !code) return alert("請輸入名稱與房間代碼！");
    if (peer) peer.destroy();
    peer = new Peer(code, { debug: 1 });
    peer.on('open', (id) => {
        setupLocalPlayer(name, id, code);
        enterLobby();
        document.getElementById('connStatus').innerText = "狀態: 房間已建立 (Host)";
    });
    peer.on('connection', setupConnection);
    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') switchToClient(name, code);
        else alert("連線失敗: " + err.type);
    });
}

function switchToClient(name, code) {
    if (peer) peer.destroy();
    peer = new Peer();
    peer.on('open', (id) => {
        setupLocalPlayer(name, id, code);
        const conn = peer.connect(code);
        setupConnection(conn);
    });
}

function setupLocalPlayer(name, id, code) {
    playersState[id] = { name: name, ready: false, score: 0 };
    document.getElementById('displayRoomCode').innerText = code;
}

function setupConnection(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        enterLobby();
        document.getElementById('connStatus').innerText = "狀態: 已連線";
        conn.send({ type: 'initInfo', name: playersState[peer.id].name });
    });
    conn.on('data', (data) => {
        if (data.type === 'initInfo') {
            playersState[conn.peer] = { name: data.name, ready: false, score: 0 };
            updateLobbyUI();
            if (!data.reply) conn.send({ type: 'initInfo', name: playersState[peer.id].name, reply: true });
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
}

function broadcast(data) {
    Object.values(connections).forEach(c => { if (c.open) c.send(data); });
}

function pressReady() {
    const myId = peer.id;
    playersState[myId].ready = !playersState[myId].ready;
    const btn = document.getElementById('readyBtn');
    btn.innerText = playersState[myId].ready ? "取消準備" : "準備開始";
    btn.style.background = playersState[myId].ready ? "#ff4757" : "#00ff88";
    updateLobbyUI();
    broadcast({ type: 'readyStatus', status: playersState[myId].ready });
    checkAllReady();
}

function updateLobbyUI() {
    const list = document.getElementById('playerList');
    list.innerHTML = Object.entries(playersState).map(([id, s]) => 
        `<div class="player-tag ${s.ready ? 'ready' : ''}">${s.name}${id === peer.id ? ' (我)' : ''}</div>`
    ).join('');
}

function checkAllReady() {
    const players = Object.values(playersState);
    if (players.length >= 1 && players.every(p => p.ready)) {
        broadcast({ type: 'gameStart' });
        setTimeout(realStartGame, 500);
    }
}

function realStartGame() {
    if (gameActive) return;
    gameActive = true;
    timeLeft = 30;
    score = 0;
    scoreElement.innerText = score;
    lobbyMenu.style.display = 'none';
    document.getElementById('crosshair').style.display = 'block';
    settingsIcon.style.display = 'block';
    canvas.requestPointerLock();
    const itv = setInterval(() => {
        if (!gameActive) { clearInterval(itv); return; }
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) { clearInterval(itv); endGame(); }
    }, 1000);
}

function endGame() {
    gameActive = false;
    settingsIcon.style.display = 'none';
    document.exitPointerLock();
    document.getElementById('crosshair').style.display = 'none';
    if (!isPractice) {
        alert(`遊戲結束！得分: ${score}`);
        location.reload();
    }
}

function enterLobby() {
    startMenu.style.display = 'none';
    lobbyMenu.style.display = 'block';
    updateLobbyUI();
}

function updateLeaderboard() {
    const sorted = Object.entries(playersState).sort((a,b)=>b[1].score-a[1].score);
    leaderList.innerHTML = sorted.map(([id, s]) => `<li>${s.name}: ${s.score}</li>`).join('');
}

function render() {
    requestAnimationFrame(render);
    if (gameActive && targets.length < 5) spawnTarget();
    renderer.render(scene, camera);
}
render();

// 靈敏度連動邏輯
sensRange.addEventListener('input', (e) => {
    sensValue.innerText = e.target.value;
});

ingameSensRange.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    sensitivity = val;
    ingameSensValue.innerText = val;
    sensRange.value = val;
    sensValue.innerText = val;
});

function applySensitivity() {
    sensitivity = parseFloat(sensRange.value);
    const btn = document.getElementById('applySensBtn');
    
    // 防止重複點擊
    if (btn.innerText === "已套用！") return;

    const originalText = "套用靈敏度";
    btn.innerText = "已套用！";
    btn.style.background = "#00ff88"; 
    btn.style.color = "#000"; // 變色時改為黑字，確保看得到字

    setTimeout(() => {
        btn.innerText = originalText;
        // 清除內聯樣式，恢復 CSS 定義的樣式
        btn.style.background = ""; 
        btn.style.color = "";
    }, 1000);
}

function leaveLobby() {
    if (peer) peer.destroy();
    location.reload();
}