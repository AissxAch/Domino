document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const screens = {
        mainMenu: document.getElementById('main-menu'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen')
    };

    const buttons = {
        host: document.getElementById('btn-host'),
        join: document.getElementById('btn-join'),
        copyCode: document.getElementById('btn-copy-code'),
        startGame: document.getElementById('btn-start-game'),
        leaveLobby: document.getElementById('btn-leave-lobby'),
        passTurn: document.getElementById('btn-pass'),
        nextRound: document.getElementById('btn-next-round'),
        backMenu: document.getElementById('btn-back-menu')
    };

    const inputs = { joinCode: document.getElementById('join-code') };
    const lobby = {
        codeDisplay: document.getElementById('display-room-code'),
        playerCount: document.getElementById('player-count'),
        playersList: document.getElementById('lobby-players')
    };

    const gameUI = {
        board: document.getElementById('board'),
        localHand: document.getElementById('local-hand'),
        turnIndicator: document.getElementById('turn-indicator'),
        gameOverModal: document.getElementById('game-over-modal'),
        gameOverTitle: document.getElementById('game-over-title'),
        gameOverMessage: document.getElementById('game-over-message'),
        scoreBoard: document.getElementById('score-board'),
        toastContainer: document.getElementById('toast-container')
    };

    // --- State ---
    let network = null;
    let game = null;
    let localPlayerId = null;
    let localPlayerName = "Player " + Math.floor(Math.random() * 1000);

    function getPlayerName() {
        const nameInput = document.getElementById('player-name');
        const name = nameInput ? nameInput.value.trim() : '';
        return name || localPlayerName; // fallback to random name
    }
    let currentState = null;

    // --- Core Functions ---
    function switchScreen(screenName) {
        Object.values(screens).forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        screens[screenName].classList.remove('hidden');
        screens[screenName].classList.add('active');
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        gameUI.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- Network Callbacks ---
    const onStateUpdate = (state) => {
        if (network && network.isHost && state.action) {
            // Host processes incoming player action
            game.processAction(state);
            const newState = game.getState();
            network.broadcastState(newState);
            currentState = newState;
            renderGame(newState);
        } else if (network && !network.isHost && !state.action) {
            // Client receives full state from host
            currentState = state;
            renderGame(state);
        }
    };

    const onPlayerJoin = (players) => {
        lobby.playerCount.innerText = players.length;
        lobby.playersList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            const isMe = network && p.id === network.playerId;
            li.innerHTML = `<span>${p.name} ${isMe ? '(You)' : ''}</span> 
                            <span>${p.isHost ? '👑 Host' : ''}</span>`;
            lobby.playersList.appendChild(li);
        });

        if (network && network.isHost && players.length >= 2) {
            buttons.startGame.classList.remove('hidden');
        } else {
            buttons.startGame.classList.add('hidden');
        }
    };

    const onPlayerLeave = (players) => {
        onPlayerJoin(players);
        showToast("A player left.");
    };

    const onGameStart = (state) => {
        currentState = state;
        switchScreen('game');
        renderGame(state);
    };

    // --- Initialization ---
    function createNetwork() {
        if (network) {
            network.disconnect();
        }
        network = new PeerNetwork(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart);
        
        const statusLog = document.getElementById('status-log');
        if (statusLog) {
            statusLog.classList.remove('hidden');
            statusLog.innerHTML = '';
            network.onStatus = (msg) => {
                const line = document.createElement('div');
                line.innerText = msg;
                statusLog.appendChild(line);
                statusLog.scrollTop = statusLog.scrollHeight;
            };
        }
    }

    // --- Event Listeners ---
    buttons.host.addEventListener('click', async () => {
        buttons.host.disabled = true;
        buttons.host.innerText = "Hosting...";
        createNetwork();
        try {
            localPlayerName = getPlayerName();
            const code = await network.hostRoom(localPlayerName);
            localPlayerId = network.playerId;
            game = new DominoGame(); // Only host runs the game engine
            lobby.codeDisplay.innerText = code;
            switchScreen('lobby');
            // Update lobby with host as first player
            onPlayerJoin(network.players);
        } catch (e) {
            alert("Failed to host: " + (e.message || e));
            network.disconnect();
            network = null;
        } finally {
            buttons.host.disabled = false;
            buttons.host.innerText = "Host Game";
        }
    });

    buttons.join.addEventListener('click', async () => {
        const code = inputs.joinCode.value.trim();
        if (!code) return alert("Please enter a room code");
        
        buttons.join.disabled = true;
        buttons.join.innerText = "Joining...";
        createNetwork();
        try {
            localPlayerName = getPlayerName();
            await network.joinRoom(code, localPlayerName);
            localPlayerId = network.playerId;
            lobby.codeDisplay.innerText = code.toUpperCase();
            switchScreen('lobby');
        } catch (e) {
            alert("Failed to join: " + (e.message || e));
            if (network) {
                network.disconnect();
                network = null;
            }
        } finally {
            buttons.join.disabled = false;
            buttons.join.innerText = "Join Game";
        }
    });

    buttons.copyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(lobby.codeDisplay.innerText).then(() => {
            showToast("Code copied!");
        }).catch(() => {
            // Fallback: select text
            const el = lobby.codeDisplay;
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            showToast("Select & copy the code manually");
        });
    });

    buttons.leaveLobby.addEventListener('click', () => {
        if (network) {
            network.disconnect();
            network = null;
        }
        switchScreen('mainMenu');
    });

    buttons.startGame.addEventListener('click', () => {
        if (!network || !network.isHost) return;
        game.initPlayers(network.players);
        const state = game.startRound();
        network.broadcastStart(state);
        onGameStart(state); // Host triggers its own start
    });

    buttons.nextRound.addEventListener('click', () => {
        if (!network || !network.isHost) return;
        const state = game.startRound(game.roundResult.winnerIndex);
        network.broadcastState(state);
        gameUI.gameOverModal.classList.add('hidden');
        currentState = state;
        renderGame(state);
    });

    buttons.backMenu.addEventListener('click', () => {
        if (network) {
            network.disconnect();
            network = null;
        }
        window.location.reload();
    });

    buttons.passTurn.addEventListener('click', () => {
        if (network) {
            network.sendAction({ type: 'PASS' });
        }
    });

    // --- DOM Rendering Tools ---
    
    function createDominoElement(tile, hidden = false, horizontal = false) {
        const dom = document.createElement('div');
        dom.className = `domino${hidden ? ' hidden' : ''}${horizontal ? ' horizontal' : ''}`;
        
        if (!hidden) {
            const half1 = document.createElement('div');
            half1.className = 'domino-half';
            appendDots(half1, tile[0]);
            
            const half2 = document.createElement('div');
            half2.className = 'domino-half';
            appendDots(half2, tile[1]);
            
            dom.appendChild(half1);
            dom.appendChild(half2);
            dom.dataset.t0 = tile[0];
            dom.dataset.t1 = tile[1];
        }
        return dom;
    }

    function appendDots(container, count) {
        const layouts = {
            0: [],
            1: [5],
            2: [1, 9],
            3: [1, 5, 9],
            4: [1, 3, 7, 9],
            5: [1, 3, 5, 7, 9],
            6: [1, 3, 4, 6, 7, 9]
        };
        (layouts[count] || []).forEach(pos => {
            const dot = document.createElement('div');
            dot.className = `dot p${pos}`;
            container.appendChild(dot);
        });
    }

    // --- Main Game Render Loop ---
    function renderGame(state) {
        if (!state || !state.players) return;
        
        // 1. Identify local player and opponents mapping
        const localIndex = state.players.findIndex(p => p.id === localPlayerId);
        if (localIndex === -1) return; // Safety check
        const myPlayer = state.players[localIndex];
        
        // Setup opponent positions based on player count
        const opponents = [];
        let numPlayers = state.players.length;
        for (let i = 1; i < numPlayers; i++) {
            opponents.push(state.players[(localIndex + i) % numPlayers]);
        }

        // 2. Render Opponent UI
        ['top', 'left', 'right'].forEach(pos => {
            document.querySelector(`.${pos}-opponent`).style.visibility = 'hidden';
        });

        if (numPlayers === 2) {
            renderOpponent(opponents[0], 'top', state);
        } else if (numPlayers === 3) {
            renderOpponent(opponents[0], 'left', state);
            renderOpponent(opponents[1], 'right', state);
        } else if (numPlayers === 4) {
            renderOpponent(opponents[0], 'left', state);
            renderOpponent(opponents[1], 'top', state);
            renderOpponent(opponents[2], 'right', state);
        }

        // 3. Render Local Player Info
        const localInfo = document.getElementById('player-local-info');
        localInfo.querySelector('.player-name').innerText = "You" + (myPlayer.isTeam2 ? " (Team 2)" : (numPlayers === 4 ? " (Team 1)" : ""));
        localInfo.querySelector('.player-score').innerText = `Score: ${myPlayer.score}`;
        
        // 4. Render Local Hand
        gameUI.localHand.innerHTML = '';
        const isMyTurn = state.activePlayerId === localPlayerId && state.gameState === 'PLAYING';
        const validMoves = isMyTurn ? getLocalValidMoves(myPlayer.hand, state.leftEnd, state.rightEnd, state.board.length) : [];
        
        (myPlayer.hand || []).forEach(tile => {
            const domTile = createDominoElement(tile, false, false);
            
            if (isMyTurn) {
                const validOptions = validMoves.filter(v => v.tile[0] === tile[0] && v.tile[1] === tile[1]);
                if (validOptions.length > 0) {
                    domTile.classList.add('valid-move');
                    domTile.addEventListener('click', () => handleTileClick(tile, validOptions));
                } else {
                    domTile.classList.add('disabled');
                }
            } else {
                domTile.classList.add('disabled');
            }
            gameUI.localHand.appendChild(domTile);
        });

        // 5. Controls & Turn Indicator
        gameUI.turnIndicator.classList.toggle('active-turn', isMyTurn);
        if (isMyTurn) {
            gameUI.turnIndicator.innerText = "Your Turn!";
            if (validMoves.length === 0) {
                buttons.passTurn.classList.remove('hidden');
            } else {
                buttons.passTurn.classList.add('hidden');
            }
        } else {
            const activePlayer = state.players.find(p => p.id === state.activePlayerId);
            gameUI.turnIndicator.innerText = `${activePlayer ? activePlayer.name : 'Waiting'}'s Turn`;
            buttons.passTurn.classList.add('hidden');
        }

        // 6. Render Board
        renderBoard(state.board);

        // 7. Check Game Over states
        if (state.gameState === 'ROUND_OVER' || state.gameState === 'GAME_OVER') {
            showGameOverModal(state);
        } else {
            gameUI.gameOverModal.classList.add('hidden');
        }
    }

    function renderOpponent(player, position, state) {
        const container = document.querySelector(`.${position}-opponent`);
        container.style.visibility = 'visible';
        
        const info = document.getElementById(`player-${position}-info`);
        const numPlayers = state.players.length;
        info.querySelector('.player-name').innerText = player.name + (player.isTeam2 ? " (T2)" : (numPlayers === 4 ? " (T1)" : ""));
        info.querySelector('.player-score').innerText = `Score: ${player.score}`;

        const handContainer = document.getElementById(`hand-${position}`);
        handContainer.innerHTML = '';
        const isVerticalSlot = (position === 'left' || position === 'right');
        for (let i = 0; i < player.handCount; i++) {
            handContainer.appendChild(createDominoElement([0, 0], true, !isVerticalSlot));
        }
    }

    function renderBoard(boardTiles) {
        gameUI.board.innerHTML = '';
        if (!boardTiles || boardTiles.length === 0) return;

        // Use flexbox for a clean straight-line layout
        gameUI.board.style.display = 'flex';
        gameUI.board.style.alignItems = 'center';
        gameUI.board.style.justifyContent = 'center';
        gameUI.board.style.gap = '2px';
        gameUI.board.style.width = 'max-content';
        gameUI.board.style.margin = 'auto';
        gameUI.board.style.padding = '10px';

        boardTiles.forEach(bTile => {
            const isDouble = bTile.tile[0] === bTile.tile[1];
            // Doubles render vertically (not horizontal), others render horizontally
            const domTile = createDominoElement(bTile.tile, false, !isDouble);
            
            // If rotated, swap the visual order of the halves
            if (!isDouble && bTile.rotated) {
                domTile.style.flexDirection = 'row-reverse';
            }
            
            // Board tiles shouldn't have hover effects
            domTile.style.cursor = 'default';
            
            gameUI.board.appendChild(domTile);
        });

        // Auto-scroll the board container to center if it overflows
        const container = document.querySelector('.board-container');
        if (gameUI.board.scrollWidth > container.clientWidth) {
            container.style.overflowX = 'auto';
            requestAnimationFrame(() => {
                container.scrollLeft = (gameUI.board.scrollWidth - container.clientWidth) / 2;
            });
        } else {
            container.style.overflowX = 'hidden';
        }
    }

    // --- Helper logic (client side validation) ---
    function getLocalValidMoves(hand, leftEnd, rightEnd, boardLength) {
        if (boardLength === 0) {
            const has66 = hand.find(t => t[0] === 6 && t[1] === 6);
            if (has66) return [{ tile: has66, side: 'first' }];
            return hand.map(t => ({ tile: t, side: 'first' }));
        }

        let valid = [];
        hand.forEach(tile => {
            const matchesLeft = (tile[0] === leftEnd || tile[1] === leftEnd);
            const matchesRight = (tile[0] === rightEnd || tile[1] === rightEnd);
            if (matchesLeft) valid.push({ tile, side: 'left' });
            if (matchesRight) valid.push({ tile, side: 'right' });
        });
        return valid;
    }

    function handleTileClick(tile, validOptions) {
        // If only one valid option, play it immediately
        if (validOptions.length === 1) {
            network.sendAction({ type: 'PLAY', tile: tile, side: validOptions[0].side });
            return;
        }

        // If multiple (can go left or right), prompt user
        const side = window.confirm(`Play on LEFT end?\n(OK = Left, Cancel = Right)`) ? 'left' : 'right';
        
        const chosenOption = validOptions.find(o => o.side === side);
        if (chosenOption) {
            network.sendAction({ type: 'PLAY', tile: tile, side: side });
        } else {
            showToast("Invalid choice, try the other side.");
        }
    }

    function showGameOverModal(state) {
        const r = state.roundResult;
        if (!r) return;
        gameUI.gameOverModal.classList.remove('hidden');
        
        if (state.gameState === 'GAME_OVER') {
            gameUI.gameOverTitle.innerText = "🏆 Game Over!";
            buttons.nextRound.classList.add('hidden');
        } else {
            gameUI.gameOverTitle.innerText = r.isBlocked ? "🔒 Game Blocked!" : "✅ Round Over!";
            if (network && network.isHost) {
                buttons.nextRound.classList.remove('hidden');
            } else {
                buttons.nextRound.classList.add('hidden');
            }
        }

        gameUI.gameOverMessage.innerText = `${r.winnerName} won and gained ${r.pointsGained} points!`;
        
        gameUI.scoreBoard.innerHTML = '';
        state.players.forEach(p => {
            const div = document.createElement('div');
            div.style.padding = '0.3rem 0';
            div.innerText = `${p.name}${p.isTeam2 ? ' (Team 2)' : ''}: ${p.score} pts`;
            gameUI.scoreBoard.appendChild(div);
        });
    }

});
