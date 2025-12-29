const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

let score = 0;
let timeLeft = 30;
let targets = [];
let gameActive = false;
let sensitivity = 1.0;
let crosshairX = 0, crosshairY = 0;

// 連線相關
let peer = null;
let conn = null;
let isReady = false;
let opponentReady = false;
let playersScores = {};

// 產生隨機 5 位英數字
function generateRandomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 移除容易混淆的字元如 I, O, 0, 1
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 初始化 Peer
function reinitializePeer() {
    if (peer) peer.destroy();
    
    const customId = document.getElementById('myCustomId').value.toUpperCase();
    peer = new Peer(customId);

    peer.on('open', (id) => {
        document.getElementById('currentIdDisplay').innerText = id;
        playersScores[id] = 0;
        updateLeaderboard();
        document.getElementById('connectionStatus').innerText = "狀態: 等待連線...";
    });

    peer.on('connection', (connection) => {
        setupConnection(connection);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            alert('此 ID 已被佔用，請換一個！');
        } else {
            console.error(err);
        }
    });
}

// 預設生成一個 ID 並初始化
document.getElementById('myCustomId').value = generateRandomId();
reinitializePeer();

function connectToPeer() {
    const targetId = document.getElementById('peerIdInput').value.toUpperCase();
    if (targetId) {
        setupConnection(peer.connect(targetId));
    }
}

function setupConnection(connection) {
    conn = connection;
    document.getElementById('connectionStatus').innerText = "狀態: 已連線";
    document.getElementById('connectionStatus').style.color = "#00ff88";

    conn.on('data', (data) => {
        if (data.type === 'ready') {
            opponentReady = true;
            checkStartCondition();
        }
        if (data.type === 'scoreUpdate') {
            playersScores[data.id] = data.score;
            updateLeaderboard();
        }
        if (data.type === 'startNow') {
            realStartGame();
        }
    });
}

function updateLeaderboard() {
    const sorted = Object.entries(playersScores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    leaderList.innerHTML = sorted.map(([id, s]) => 
        `<li>${id}: ${s}</li>`).join('');
}

// 畫布尺寸與準心對齊
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// 靈敏度調整
sensRange.addEventListener('input', (e) => {
    if (!gameActive) {
        sensitivity = parseFloat(e.target.value);
        sensValue.innerText = sensitivity.toFixed(1);
    }
});

// 滑鼠鎖定與位移邏輯
window.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas) {
        crosshairX += e.movementX * sensitivity;
        crosshairY += e.movementY * sensitivity;
        
        crosshairX = Math.max(0, Math.min(canvas.width, crosshairX));
        crosshairY = Math.max(0, Math.min(canvas.height, crosshairY));
    }
});

// 監聽鎖定狀態（處理 Esc）
document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && gameActive) {
        console.log("偵測到 Esc，點擊畫面可恢復");
    }
});

class Target {
    constructor() {
        this.radius = 25;
        this.x = Math.random() * (canvas.width - 50) + 25;
        this.y = Math.random() * (canvas.height - 50) + 25;
        const speed = 4;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.color = '#00d4ff';
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) this.vx *= -1;
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) this.vy *= -1;
    }
    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.closePath();
    }
}

function pressStart() {
    isReady = true;
    document.getElementById('startBtn').innerText = "等待對手中...";
    if (conn) conn.send({ type: 'ready' });
    checkStartCondition();
}

function checkStartCondition() {
    if (conn) {
        if (isReady && opponentReady) {
            conn.send({ type: 'startNow' });
            realStartGame();
        }
    } else if (isReady) {
        realStartGame();
    }
}

function realStartGame() {
    if (gameActive) return;
    canvas.requestPointerLock();
    score = 0; timeLeft = 30; targets = []; gameActive = true;
    startMenu.style.display = 'none';
    
    // 初始化準心到中心
    crosshairX = canvas.width / 2;
    crosshairY = canvas.height / 2;

    const timerInterval = setInterval(() => {
        if (!gameActive) { clearInterval(timerInterval); return; }
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) endGame();
    }, 1000);
    animate();
}

// 統一的點擊偵測邏輯
canvas.addEventListener('mousedown', () => {
    if (!gameActive) return;
    
    // 如果按了 Esc 後點擊，先重新鎖定，不計分
    if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
    }

    targets.forEach((t, i) => {
        const dist = Math.sqrt((crosshairX - t.x)**2 + (crosshairY - t.y)**2);
        if (dist < t.radius) {
            targets.splice(i, 1);
            score += 100;
            scoreElement.innerText = score;
            playersScores[peer.id] = score;
            updateLeaderboard();
            if (conn) conn.send({ type: 'scoreUpdate', id: peer.id, score: score });
        }
    });
});

function animate() {
    if (!gameActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (targets.length < 5) targets.push(new Target());
    targets.forEach(t => { t.update(); t.draw(); });
    
    // 畫準心 (僅在鎖定時顯示，避免 Esc 後出現兩個準心)
    if (document.pointerLockElement === canvas) {
        ctx.strokeStyle = "white"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(crosshairX-10, crosshairY); ctx.lineTo(crosshairX+10, crosshairY);
        ctx.moveTo(crosshairX, crosshairY-10); ctx.lineTo(crosshairX, crosshairY+10);
        ctx.stroke();
    }
    requestAnimationFrame(animate);
}

function endGame() {
    gameActive = false;
    document.exitPointerLock();
    alert(`遊戲結束！分數: ${score}`);
    location.reload(); 
}