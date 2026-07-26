class DominoGame {
    constructor() {
        this.players = []; // Array of player objects { id, name, hand: [], score: 0, isTeam2: false }
        this.deck = [];
        this.board = []; // Array of { tile: [left, right], rotated: false, isDouble: false }
        this.currentTurnIndex = 0;
        this.leftEnd = null;
        this.rightEnd = null;
        this.gameState = 'LOBBY'; // LOBBY, PLAYING, ROUND_OVER, GAME_OVER
        this.consecutivePasses = 0; // To detect blocked game
        this.maxScore = 100;
        this.isTeamGame = false;
        
        // Log callbacks (for UI)
        this.onLog = (msg) => console.log(msg);
    }

    // Initialize players from the network player list
    initPlayers(networkPlayers) {
        this.players = networkPlayers.map((p, index) => ({
            id: p.id,
            name: p.name,
            hand: [],
            score: 0,
            // If 4 players, alternating teams (0 and 2 vs 1 and 3)
            isTeam2: networkPlayers.length === 4 ? (index % 2 !== 0) : false
        }));
        this.isTeamGame = this.players.length === 4;
        this.roundResult = null;
    }

    startRound(winnerIndex = -1) {
        this.gameState = 'PLAYING';
        this.board = [];
        this.leftEnd = null;
        this.rightEnd = null;
        this.consecutivePasses = 0;
        this.roundResult = null;
        
        // Generate and shuffle deck
        this.deck = [];
        for (let i = 0; i <= 6; i++) {
            for (let j = i; j <= 6; j++) {
                this.deck.push([i, j]);
            }
        }
        this.shuffle(this.deck);

        // Deal 7 tiles to each player
        this.players.forEach(p => { p.hand = []; });
        for (let i = 0; i < 7; i++) {
            for (let p of this.players) {
                p.hand.push(this.deck.pop());
            }
        }

        // Determine starting player
        if (winnerIndex !== -1) {
            // Next round starts with the winner of previous round
            this.currentTurnIndex = winnerIndex;
        } else {
            // First round starts with 6|6, or highest double
            this.currentTurnIndex = this.findStartingPlayer();
        }
        
        return this.getState();
    }

    findStartingPlayer() {
        // Look for 6|6 down to 0|0
        for (let i = 6; i >= 0; i--) {
            for (let pIdx = 0; pIdx < this.players.length; pIdx++) {
                const hand = this.players[pIdx].hand;
                if (hand.some(tile => tile[0] === i && tile[1] === i)) {
                    return pIdx;
                }
            }
        }
        // Fallback if no doubles were dealt (rare, but possible with < 4 players)
        return 0; // Just start with player 0
    }

    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    getValidMoves(hand) {
        if (this.board.length === 0) {
            // First move: any tile is valid. 
            // In strict Algerian, it MUST be the 6|6 if they have it.
            const has66 = hand.find(t => t[0] === 6 && t[1] === 6);
            if (has66) return [{ tile: has66, side: 'first' }];
            return hand.map(t => ({ tile: t, side: 'first' }));
        }

        let valid = [];
        hand.forEach(tile => {
            if (tile[0] === this.leftEnd || tile[1] === this.leftEnd) valid.push({ tile, side: 'left' });
            if (tile[0] === this.rightEnd || tile[1] === this.rightEnd) valid.push({ tile, side: 'right' });
        });
        return valid;
    }

    playTile(playerId, tileData, side) {
        if (this.players[this.currentTurnIndex].id !== playerId) return false;
        
        const player = this.players[this.currentTurnIndex];
        const tileIndex = player.hand.findIndex(t => t[0] === tileData[0] && t[1] === tileData[1]);
        if (tileIndex === -1) return false;

        const tile = player.hand[tileIndex];
        let playedTile = { tile: [...tile], isDouble: tile[0] === tile[1], rotated: false };

        if (this.board.length === 0) {
            this.board.push(playedTile);
            this.leftEnd = tile[0];
            this.rightEnd = tile[1];
        } else {
            if (side === 'left') {
                if (tile[1] === this.leftEnd) {
                    playedTile.rotated = false;
                    this.leftEnd = tile[0];
                } else if (tile[0] === this.leftEnd) {
                    playedTile.rotated = true;
                    this.leftEnd = tile[1];
                }
                this.board.unshift(playedTile);
            } else if (side === 'right') {
                if (tile[0] === this.rightEnd) {
                    playedTile.rotated = false;
                    this.rightEnd = tile[1];
                } else if (tile[1] === this.rightEnd) {
                    playedTile.rotated = true;
                    this.rightEnd = tile[0];
                }
                this.board.push(playedTile);
            }
        }

        // Remove from hand
        player.hand.splice(tileIndex, 1);
        this.consecutivePasses = 0;

        this.checkRoundEnd();
        if (this.gameState === 'PLAYING') {
            this.nextTurn();
        }
        return true;
    }

    drawTile(playerId) {
        if (this.players[this.currentTurnIndex].id !== playerId) return false;
        if (this.deck.length === 0) return false;
        
        const player = this.players[this.currentTurnIndex];
        const validMoves = this.getValidMoves(player.hand);
        if (validMoves.length > 0) return false; // Cannot draw if you already have valid moves

        const tile = this.deck.pop();
        player.hand.push(tile);
        this.consecutivePasses = 0;
        return true;
    }

    passTurn(playerId) {
        if (this.players[this.currentTurnIndex].id !== playerId) return false;
        
        const player = this.players[this.currentTurnIndex];
        const validMoves = this.getValidMoves(player.hand);
        
        // Cannot pass if they have a valid move OR if reserve still has tiles to draw
        if (validMoves.length > 0 || this.deck.length > 0) {
            return false;
        }

        this.consecutivePasses++;
        this.checkRoundEnd();
        if (this.gameState === 'PLAYING') {
            this.nextTurn();
        }
        return true;
    }

    nextTurn() {
        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
    }

    checkRoundEnd() {
        // Condition 1: A player played all their tiles (Domino)
        const winnerIndex = this.players.findIndex(p => p.hand.length === 0);
        if (winnerIndex !== -1) {
            this.endRound(winnerIndex, false);
            return;
        }

        // Condition 2: Game is blocked (everyone passed consecutively)
        if (this.consecutivePasses >= this.players.length) {
            // Find player with least points in hand
            let minPoints = Infinity;
            let blockedWinnerIndex = -1;
            
            if (this.isTeamGame) {
                // Team points
                let team1Points = this.calculateHandPoints(this.players[0].hand) + this.calculateHandPoints(this.players[2].hand);
                let team2Points = this.calculateHandPoints(this.players[1].hand) + this.calculateHandPoints(this.players[3].hand);
                blockedWinnerIndex = team1Points <= team2Points ? 0 : 1; // 0 represents team 1, 1 represents team 2
            } else {
                this.players.forEach((p, idx) => {
                    const pts = this.calculateHandPoints(p.hand);
                    if (pts < minPoints) {
                        minPoints = pts;
                        blockedWinnerIndex = idx;
                    }
                });
            }
            this.endRound(blockedWinnerIndex, true);
        }
    }

    calculateHandPoints(hand) {
        return hand.reduce((sum, tile) => sum + tile[0] + tile[1], 0);
    }

    endRound(winnerIndex, isBlocked) {
        this.gameState = 'ROUND_OVER';
        
        let roundPoints = 0;
        let winnerName = "";
        
        if (this.isTeamGame) {
            const winningTeamIs2 = this.players[winnerIndex].isTeam2;
            winnerName = winningTeamIs2 ? "Team 2" : "Team 1";
            
            // Sum points of opposing team
            this.players.forEach(p => {
                if (p.isTeam2 !== winningTeamIs2) {
                    roundPoints += this.calculateHandPoints(p.hand);
                }
            });

            // Add points to both players in winning team
            this.players.forEach(p => {
                if (p.isTeam2 === winningTeamIs2) p.score += roundPoints;
            });

        } else {
            winnerName = this.players[winnerIndex].name;
            // Sum points of all opponents
            this.players.forEach((p, idx) => {
                if (idx !== winnerIndex) {
                    roundPoints += this.calculateHandPoints(p.hand);
                }
            });
            this.players[winnerIndex].score += roundPoints;
        }

        // Check if game over
        const isGameOver = this.players.some(p => p.score >= this.maxScore);
        if (isGameOver) {
            this.gameState = 'GAME_OVER';
        }

        this.roundResult = {
            winnerIndex,
            winnerName,
            pointsGained: roundPoints,
            isBlocked,
            isGameOver
        };
    }

    // Get sanitized state to send to clients
    getState() {
        return {
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                isTeam2: p.isTeam2,
                handCount: p.hand.length,
                hand: p.hand 
            })),
            board: this.board,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd,
            currentTurnIndex: this.currentTurnIndex,
            activePlayerId: this.players[this.currentTurnIndex]?.id,
            gameState: this.gameState,
            roundResult: this.roundResult,
            deckCount: this.deck.length
        };
    }

    // Host receives action from client and applies it
    processAction(actionData) {
        if (this.gameState !== 'PLAYING') return;
        
        const { action, playerId } = actionData;
        
        if (action.type === 'PLAY') {
            this.playTile(playerId, action.tile, action.side);
        } else if (action.type === 'DRAW') {
            this.drawTile(playerId);
        } else if (action.type === 'PASS') {
            this.passTurn(playerId);
        }
    }
}
