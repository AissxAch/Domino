document.addEventListener('DOMContentLoaded', () => {
    // ========= UI REFS =========
    const screens = {
        mainMenu: document.getElementById('main-menu'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen')
    };

    const btn = {
        host: document.getElementById('btn-host'),
        join: document.getElementById('btn-join'),
        copyCode: document.getElementById('btn-copy-code'),
        startGame: document.getElementById('btn-start-game'),
        leaveLobby: document.getElementById('btn-leave-lobby'),
        pass: document.getElementById('btn-pass'),
        draw: document.getElementById('btn-draw'),
        nextRound: document.getElementById('btn-next-round'),
        backMenu: document.getElementById('btn-back-menu')
    };

    const lobbyUI = {
        codeDisplay: document.getElementById('display-room-code'),
        playerCount: document.getElementById('player-count'),
        playersList: document.getElementById('lobby-players')
    };

    const gameUI = {
        board: document.getElementById('board'),
        boardScroller: document.querySelector('.board-scroller'),
        localHand: document.getElementById('local-hand'),
        turnBadge: document.getElementById('turn-indicator'),
        reserveCount: document.getElementById('reserve-count'),
        drawCount: document.getElementById('draw-count'),
        localInfo: document.getElementById('player-local-info'),
        gameOverModal: document.getElementById('game-over-modal'),
        gameOverTitle: document.getElementById('game-over-title'),
        gameOverMsg: document.getElementById('game-over-message'),
        scoreBoard: document.getElementById('score-board'),
        toasts: document.getElementById('toast-container')
    };

    // Opponent slots (up to 3)
    const oppSlots = [0, 1, 2].map(i => ({
        slot: document.getElementById(`opp-slot-${i}`),
        badge: document.getElementById(`opp-badge-${i}`)
    }));

    // ========= STATE =========
    let network = null;
    let game = null;
    let localPlayerId = null;
    let localPlayerName = 'Player' + Math.floor(Math.random() * 999);
    let currentState = null;
    let selectedTile = null; // For dual-side selection

    function getName() {
        const el = document.getElementById('player-name');
        return (el && el.value.trim()) || localPlayerName;
    }

    // ========= SCREEN MGMT =========
    function switchScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    function toast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        gameUI.toasts.appendChild(t);
        setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2500);
    }

    // ========= NETWORK CALLBACKS =========
    const onStateUpdate = (state) => {
        if (network?.isHost && state.action) {
            game.processAction(state);
            const s = game.getState();
            network.broadcastState(s);
            currentState = s;
            render(s);
        } else if (network && !network.isHost && !state.action) {
            currentState = state;
            render(state);
        }
    };

    const onPlayerJoin = (players) => {
        lobbyUI.playerCount.textContent = players.length;
        lobbyUI.playersList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            const me = network && p.id === network.playerId;
            li.innerHTML = `<span>${p.name}${me ? ' (You)' : ''}</span><span>${p.isHost ? '👑' : ''}</span>`;
            lobbyUI.playersList.appendChild(li);
        });
        btn.startGame.classList.toggle('hidden', !(network?.isHost && players.length >= 2));
    };

    const onPlayerLeave = (players) => { onPlayerJoin(players); toast('A player left'); };

    const onGameStart = (state) => {
        currentState = state;
        selectedTile = null;
        switchScreen('game');
        render(state);
    };

    // ========= NETWORK INIT =========
    function createNetwork() {
        if (network) network.disconnect();
        network = new PeerNetwork(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart);
        const log = document.getElementById('status-log');
        if (log) {
            log.classList.remove('hidden');
            log.innerHTML = '';
            network.onStatus = (msg) => {
                const d = document.createElement('div');
                d.textContent = msg;
                log.appendChild(d);
                log.scrollTop = log.scrollHeight;
            };
        }
    }

    // ========= BUTTON HANDLERS =========
    btn.host.addEventListener('click', async () => {
        btn.host.disabled = true; btn.host.textContent = 'Hosting…';
        createNetwork();
        try {
            localPlayerName = getName();
            const code = await network.hostRoom(localPlayerName);
            localPlayerId = network.playerId;
            game = new DominoGame();
            lobbyUI.codeDisplay.textContent = code;
            switchScreen('lobby');
            onPlayerJoin(network.players);
        } catch (e) {
            alert('Failed: ' + (e.message || e));
            network?.disconnect(); network = null;
        } finally { btn.host.disabled = false; btn.host.textContent = '🏠 Host Game'; }
    });

    btn.join.addEventListener('click', async () => {
        const code = document.getElementById('join-code').value.trim();
        if (!code) return alert('Enter a room code');
        btn.join.disabled = true; btn.join.textContent = 'Joining…';
        createNetwork();
        try {
            localPlayerName = getName();
            await network.joinRoom(code, localPlayerName);
            localPlayerId = network.playerId;
            lobbyUI.codeDisplay.textContent = code.toUpperCase();
            switchScreen('lobby');
        } catch (e) {
            alert('Failed: ' + (e.message || e));
            network?.disconnect(); network = null;
        } finally { btn.join.disabled = false; btn.join.textContent = '🔗 Join Game'; }
    });

    btn.copyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(lobbyUI.codeDisplay.textContent)
            .then(() => toast('Code copied!'))
            .catch(() => toast('Copy the code manually'));
    });

    btn.leaveLobby.addEventListener('click', () => { network?.disconnect(); network = null; switchScreen('mainMenu'); });
    btn.startGame.addEventListener('click', () => {
        if (!network?.isHost) return;
        game.initPlayers(network.players);
        const s = game.startRound();
        network.broadcastStart(s);
        onGameStart(s);
    });
    btn.nextRound.addEventListener('click', () => {
        if (!network?.isHost) return;
        const s = game.startRound(game.roundResult.winnerIndex);
        network.broadcastState(s);
        gameUI.gameOverModal.classList.add('hidden');
        selectedTile = null;
        currentState = s;
        render(s);
    });
    btn.backMenu.addEventListener('click', () => { network?.disconnect(); network = null; window.location.reload(); });
    btn.pass.addEventListener('click', () => { selectedTile = null; network?.sendAction({ type: 'PASS' }); });
    btn.draw.addEventListener('click', () => { selectedTile = null; network?.sendAction({ type: 'DRAW' }); });

    // ========= DOMINO ELEMENT BUILDER =========
    const DOT_MAP = { 0:[], 1:[5], 2:[1,9], 3:[1,5,9], 4:[1,3,7,9], 5:[1,3,5,7,9], 6:[1,3,4,6,7,9] };

    function makeTile(tile, facedown = false, horiz = false) {
        const el = document.createElement('div');
        el.className = 'domino' + (facedown ? ' facedown' : '') + (horiz ? ' horizontal' : '');
        if (!facedown) {
            [0, 1].forEach(i => {
                const half = document.createElement('div');
                half.className = 'domino-half';
                (DOT_MAP[tile[i]] || []).forEach(p => {
                    const d = document.createElement('div');
                    d.className = 'dot p' + p;
                    half.appendChild(d);
                });
                el.appendChild(half);
            });
            el.dataset.t0 = tile[0];
            el.dataset.t1 = tile[1];
        }
        return el;
    }

    // ========= MAIN RENDER =========
    function render(state) {
        if (!state?.players) return;
        const myIdx = state.players.findIndex(p => p.id === localPlayerId);
        if (myIdx === -1) return;
        const me = state.players[myIdx];
        const n = state.players.length;
        const deckCount = state.deckCount || 0;

        // --- Opponents (top bar) ---
        const opps = [];
        for (let i = 1; i < n; i++) opps.push(state.players[(myIdx + i) % n]);

        oppSlots.forEach((slot, i) => {
            if (i < opps.length) {
                const o = opps[i];
                slot.slot.classList.add('active');
                const badge = slot.badge;
                const team = o.isTeam2 ? ' T2' : (n === 4 ? ' T1' : '');
                badge.querySelector('.opp-name').textContent = o.name + team;
                badge.querySelector('.opp-score').textContent = o.score + ' pts';
                badge.querySelector('.opp-tiles').textContent = '🁣 ' + o.handCount;
                badge.classList.toggle('is-turn', state.activePlayerId === o.id);
            } else {
                slot.slot.classList.remove('active');
            }
        });

        // --- Reserve ---
        gameUI.reserveCount.textContent = deckCount;
        if (gameUI.drawCount) gameUI.drawCount.textContent = deckCount;

        // --- My info ---
        const team = me.isTeam2 ? ' (T2)' : (n === 4 ? ' (T1)' : '');
        gameUI.localInfo.querySelector('.pi-name').textContent = 'You' + team;
        gameUI.localInfo.querySelector('.pi-score').textContent = me.score + ' pts';

        // --- My hand ---
        gameUI.localHand.innerHTML = '';
        const myTurn = state.activePlayerId === localPlayerId && state.gameState === 'PLAYING';
        const moves = myTurn ? validMoves(me.hand, state.leftEnd, state.rightEnd, state.board.length) : [];

        (me.hand || []).forEach(tile => {
            const el = makeTile(tile);
            if (myTurn) {
                const opts = moves.filter(v => v.tile[0] === tile[0] && v.tile[1] === tile[1]);
                if (opts.length > 0) {
                    el.classList.add('valid-move');
                    if (selectedTile && selectedTile[0] === tile[0] && selectedTile[1] === tile[1]) {
                        el.classList.add('selected');
                    }
                    el.addEventListener('click', () => onTileClick(tile, opts, state));
                } else {
                    el.classList.add('disabled');
                }
            } else {
                el.classList.add('disabled');
            }
            gameUI.localHand.appendChild(el);
        });

        // --- Turn indicator & action buttons ---
        gameUI.turnBadge.classList.toggle('my-turn', myTurn);
        if (myTurn) {
            gameUI.turnBadge.textContent = '🎯 Your Turn';
            if (moves.length === 0) {
                if (deckCount > 0) {
                    btn.draw.classList.remove('hidden');
                    btn.pass.classList.add('hidden');
                } else {
                    btn.draw.classList.add('hidden');
                    btn.pass.classList.remove('hidden');
                }
            } else {
                btn.draw.classList.add('hidden');
                btn.pass.classList.add('hidden');
            }
        } else {
            const active = state.players.find(p => p.id === state.activePlayerId);
            gameUI.turnBadge.textContent = (active ? active.name : '…') + "'s turn";
            btn.draw.classList.add('hidden');
            btn.pass.classList.add('hidden');
            selectedTile = null;
        }

        // --- Board ---
        renderBoard(state.board);

        // --- Game over ---
        if (state.gameState === 'ROUND_OVER' || state.gameState === 'GAME_OVER') {
            showEndModal(state);
        } else {
            gameUI.gameOverModal.classList.add('hidden');
        }
    }

    // ========= BOARD RENDER =========
    function renderBoard(tiles) {
        gameUI.board.innerHTML = '';

        if (!tiles || tiles.length === 0) {
            const ph = document.createElement('div');
            ph.className = 'board-empty';
            ph.textContent = 'Play first tile';
            gameUI.board.appendChild(ph);
            return;
        }

        // Left target
        if (selectedTile && tiles.length > 0) {
            const lt = document.createElement('div');
            lt.className = 'board-target';
            lt.textContent = '⬅ LEFT';
            lt.addEventListener('click', () => {
                network.sendAction({ type: 'PLAY', tile: selectedTile, side: 'left' });
                selectedTile = null;
            });
            gameUI.board.appendChild(lt);
        }

        // Board tiles
        tiles.forEach(bt => {
            const isDouble = bt.tile[0] === bt.tile[1];
            const el = makeTile(bt.tile, false, !isDouble);
            if (!isDouble && bt.rotated) el.style.flexDirection = 'row-reverse';
            el.style.cursor = 'default';
            gameUI.board.appendChild(el);
        });

        // Right target
        if (selectedTile && tiles.length > 0) {
            const rt = document.createElement('div');
            rt.className = 'board-target';
            rt.textContent = 'RIGHT ➡';
            rt.addEventListener('click', () => {
                network.sendAction({ type: 'PLAY', tile: selectedTile, side: 'right' });
                selectedTile = null;
            });
            gameUI.board.appendChild(rt);
        }

        // Center scroll
        if (gameUI.boardScroller) {
            requestAnimationFrame(() => {
                const sl = (gameUI.board.scrollWidth - gameUI.boardScroller.clientWidth) / 2;
                if (sl > 0) gameUI.boardScroller.scrollLeft = sl;
            });
        }
    }

    // ========= CLIENT VALIDATION =========
    function validMoves(hand, left, right, boardLen) {
        if (boardLen === 0) {
            const d6 = hand.find(t => t[0] === 6 && t[1] === 6);
            if (d6) return [{ tile: d6, side: 'first' }];
            return hand.map(t => ({ tile: t, side: 'first' }));
        }
        const v = [];
        hand.forEach(t => {
            if (t[0] === left || t[1] === left) v.push({ tile: t, side: 'left' });
            if (t[0] === right || t[1] === right) v.push({ tile: t, side: 'right' });
        });
        return v;
    }

    // ========= TILE CLICK (INLINE SIDE SELECTION) =========
    function onTileClick(tile, opts, state) {
        if (opts.length === 1) {
            selectedTile = null;
            network.sendAction({ type: 'PLAY', tile, side: opts[0].side });
            return;
        }
        // Toggle selection for both-side tiles
        if (selectedTile && selectedTile[0] === tile[0] && selectedTile[1] === tile[1]) {
            selectedTile = null;
        } else {
            selectedTile = tile;
        }
        render(state || currentState);
    }

    // ========= END MODAL =========
    function showEndModal(state) {
        const r = state.roundResult;
        if (!r) return;
        gameUI.gameOverModal.classList.remove('hidden');

        if (state.gameState === 'GAME_OVER') {
            gameUI.gameOverTitle.textContent = '🏆 Game Over!';
            btn.nextRound.classList.add('hidden');
        } else {
            gameUI.gameOverTitle.textContent = r.isBlocked ? '🔒 Blocked!' : '✅ Round Over!';
            btn.nextRound.classList.toggle('hidden', !(network?.isHost));
        }

        gameUI.gameOverMsg.textContent = `${r.winnerName} won (+${r.pointsGained} pts)`;
        gameUI.scoreBoard.innerHTML = '';
        state.players.forEach(p => {
            const d = document.createElement('div');
            d.style.padding = '0.2rem 0';
            const win = p.score >= 100;
            d.innerHTML = `${win ? '🏆 ' : ''}${p.name}${p.isTeam2 ? ' (T2)' : ''}: <strong>${p.score}</strong> pts`;
            gameUI.scoreBoard.appendChild(d);
        });
    }
});
