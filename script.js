const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const lobbyMenu = document.getElementById('lobbyMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

let score = 0, timeLeft = 30, targets = [], gameActive = false;
let sensitivity = 1.0, crosshairX = 0, crosshairY = 0;

let peer = null;
let connections = {}; 
let playersState = {}; // 格式: {peerId: {name: string, ready: bool, score: int}}

// --- 1. 多人連線與大廳邏輯 ---

function joinRoom(role) {
    const name = document.getElementById('playerNameInput').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();

    if (!name || !code) {
        alert("請輸入名稱與房間代碼！");
        return;
    }

    if (peer) peer.destroy();

    // 房主直接使用代碼作為 ID；加入者則讓系統生成 ID
    const peerId = (role === 'host') ? code : null;
    peer = new Peer(peerId);

    peer.on('open', (id) => {
        // 記錄自己的狀態
        playersState[id] = { name: name, ready: false, score: 0 };
        document.getElementById('displayRoomCode').innerText = code;
        
        if (role === 'host') {
            enterLobby();
            document.getElementById('connectionStatus').innerText = "狀態: 房間已建立";
            document.getElementById('connectionStatus').style.color = "#00ff88";
        } else {
            const conn = peer.connect(code);
            setupConnection(conn);
        }
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') alert('代碼已被佔用，請嘗試其他房間碼！');
        else if (err.type === 'peer-not-found') alert('找不到該房間，請確認代碼是否正確。');
        else console.error(err);
    });
}

function enterLobby() {
    startMenu.style.display = 'none';
    lobbyMenu.style.display = 'block';
    updateLobbyUI();
}

function setupConnection(conn) {
    enterLobby();
    
    conn.on('open', () => {
        connections[conn.peer] = conn;
        // 連線成功後，主動發送自己的名字給對方
        conn.send({ 
            type: 'initInfo', 
            name: playersState[peer.id].name 
        });
    });

    conn.on('data', (data) => {
        if (data.type === 'initInfo') {
            playersState[conn.peer] = { name: data.name, ready: false, score: 0 };
            updateLobbyUI();
            // 收到對方名字後，回傳自己的名字（確保雙方都有數據）
            if (!data.reply) {
                conn.send({ type: 'initInfo', name: playersState[peer.id].name, reply: true });
            }
        } else if (data.type === 'readyStatus') {
            if (playersState[conn.peer]) playersState[conn.peer].ready = data.status;
            updateLobbyUI();
            checkAllReady();
        } else if (data.type === 'gameStart') {
            realStartGame();
        } else if (data.type === 'scoreUpdate') {
            if (playersState[data.id]) playersState[data.id].score = data.score;
            updateLeaderboard();
        }
    });

    conn.on('close', () => {
        delete connections[conn.peer];
        delete playersState[conn.peer];
        updateLobbyUI();
    });
}

function broadcast(data) {
    Object.values(connections).forEach(c => { if(c.open) c.send(data); });
}

// --- 2. 大廳 UI 與準備機制 ---

function pressReady() {
    const myId = peer.id;
    playersState[myId].ready = !playersState[myId].ready;
    document.getElementById('readyBtn').innerText = playersState[myId].ready ? "取消準備" : "準備遊戲";
    
    updateLobbyUI();
    broadcast({ type: 'readyStatus', status: playersState[myId].ready });
    checkAllReady();
}

function updateLobbyUI() {
    const list = document.getElementById('playerList');
    list.innerHTML = '';
    Object.entries(playersState).forEach(([id, state]) => {
        const div = document.createElement('div');
        div.className = `player-tag ${state.ready ? 'ready' : ''}`;
        div.innerText = `${state.name}${id === peer.id ? ' (我)' : ''}: ${state.ready ? '已準備' : '未準備'}`;
        list.appendChild(div);
    });
}

function checkAllReady() {
    const players = Object.values(playersState);
    const allReady = players.every(p => p.ready);
    // 所有人準備好且房間內有玩家時同步開始
    if (allReady && players.length >= 1) {
        broadcast({ type: 'gameStart' });
        realStartGame();
    }
}

function updateLeaderboard() {
    const sorted = Object.entries(playersState)
        .sort((a,b)=>b[1].score - a[1].score)
        .slice(0, 10);
    leaderList.innerHTML = sorted.map(([id, s]) => `<li>${s.name}: ${s.score}</li>`).join('');
}

// --- 3. 遊戲核心邏輯 ---

class Target {
    constructor() {
        this.radius = 25;
        this.x = Math.random() * (canvas.width - 100) + 50;
        this.y = Math.random() * (canvas.height - 100) + 50;
        const speed = 4;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) this.vx *= -1;
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) this.vy *= -1;
    }
    draw() {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#00d4ff"; ctx.fill(); ctx.closePath();
    }
}

function realStartGame() {
    if (gameActive) return;
    canvas.requestPointerLock();
    score = 0; timeLeft = 30; targets = []; gameActive = true;
    lobbyMenu.style.display = 'none';
    crosshairX = canvas.width / 2; crosshairY = canvas.height / 2;

    const timerInterval = setInterval(() => {
        if (!gameActive) { clearInterval(timerInterval); return; }
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) endGame();
    }, 1000);
    animate();
}

function animate() {
    if (!gameActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (targets.length < 5) targets.push(new Target());
    targets.forEach(t => { t.update(); t.draw(); });
    
    if (document.pointerLockElement === canvas) {
        ctx.strokeStyle = "white"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(crosshairX-10, crosshairY); ctx.lineTo(crosshairX+10, crosshairY);
        ctx.moveTo(crosshairX, crosshairY-10); ctx.lineTo(crosshairX, crosshairY+10);
        ctx.stroke();
    }
    requestAnimationFrame(animate);
}

canvas.addEventListener('mousedown', () => {
    if (!gameActive) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    targets.forEach((t, i) => {
        const d = Math.sqrt((crosshairX - t.x)**2 + (crosshairY - t.y)**2);
        if (d < t.radius) {
            targets.splice(i, 1);
            score += 100; scoreElement.innerText = score;
            playersState[peer.id].score = score;
            updateLeaderboard();
            broadcast({ type: 'scoreUpdate', id: peer.id, score: score });
        }
    });
});

window.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas) {
        crosshairX += e.movementX * sensitivity;
        crosshairY += e.movementY * sensitivity;
        crosshairX = Math.max(0, Math.min(canvas.width, crosshairX));
        crosshairY = Math.max(0, Math.min(canvas.height, crosshairY));
    }
});

sensRange.addEventListener('input', (e) => {
    sensitivity = parseFloat(e.target.value);
    sensValue.innerText = sensitivity.toFixed(1);
});

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

function endGame() {
    gameActive = false; document.exitPointerLock();
    alert(`遊戲結束！你的得分是: ${score}`);
    location.reload();
}