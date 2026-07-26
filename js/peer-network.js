class PeerNetwork {
    constructor(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart) {
        this.peer = null;
        this.connections = [];
        this.isHost = false;
        this.roomId = null;
        this.playerId = null;
        this.players = [];
        
        // STUN/TURN ICE Servers Configuration
        // Note: Mobile data requires a TURN server (e.g. Metered.ca free 20GB/month account)
        this.meteredApiKey = ""; // Insert Metered API Key here if available (e.g., "abcdef123456...")
        this.meteredAppName = ""; // Insert Metered App Name here if available (e.g., "my-domino-app")

        this.iceConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.cloudflare.com:3478' },
                { urls: 'stun:stun.services.mozilla.com' }
            ],
            iceCandidatePoolSize: 10
        };
        
        // Callbacks
        this.onStateUpdate = onStateUpdate;
        this.onPlayerJoin = onPlayerJoin;
        this.onPlayerLeave = onPlayerLeave;
        this.onGameStart = onGameStart;
        
        // Status callback for on-screen debug
        this.onStatus = null;
    }

    log(msg) {
        console.log(msg);
        if (this.onStatus) this.onStatus(msg);
    }

    async fetchIceConfig() {
        if (this.meteredAppName && this.meteredApiKey) {
            try {
                this.log('⏳ Fetching TURN relay credentials...');
                const res = await fetch(`https://${this.meteredAppName}.metered.live/api/v1/turn/credentials?apiKey=${this.meteredApiKey}`);
                const iceServers = await res.json();
                if (Array.isArray(iceServers) && iceServers.length > 0) {
                    this.iceConfig.iceServers = iceServers;
                    this.log('✅ TURN relay credentials loaded!');
                }
            } catch (err) {
                this.log('⚠️ Failed to fetch TURN credentials, using default STUN');
            }
        }
        return this.iceConfig;
    }

    async hostRoom(playerName) {
        return new Promise(async (resolve, reject) => {
            this.roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
            const fullPeerId = 'alg-domino-' + this.roomId;
            
            await this.fetchIceConfig();
            this.log('⏳ Connecting to signaling server...');
            
            this.peer = new Peer(fullPeerId, {
                debug: 2,
                config: this.iceConfig
            });
            
            this.peer.on('open', (id) => {
                this.log('✅ Signaling server connected!');
                this.log('🏠 Room created: ' + this.roomId);
                this.isHost = true;
                this.playerId = id;
                this.players = [{ id: this.playerId, name: playerName, isHost: true }];
                this.setupHostListeners();
                resolve(this.roomId);
            });

            this.peer.on('error', (err) => {
                this.log('❌ Host error: ' + err.type + ' - ' + err.message);
                if (err.type === 'unavailable-id') {
                    reject(new Error('Room code taken, please try again.'));
                } else {
                    reject(new Error(err.type + ': ' + err.message));
                }
            });

            this.peer.on('disconnected', () => {
                this.log('⚠️ Lost signaling server, reconnecting...');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            });
        });
    }

    async joinRoom(roomId, playerName) {
        return new Promise(async (resolve, reject) => {
            this.roomId = roomId.toUpperCase();
            const hostPeerId = 'alg-domino-' + this.roomId;
            let settled = false;
            
            await this.fetchIceConfig();
            this.log('⏳ Connecting to signaling server...');
            
            this.peer = new Peer(undefined, {
                debug: 2,
                config: this.iceConfig
            });
            
            this.peer.on('open', (id) => {
                this.log('✅ Signaling server connected!');
                this.log('🔍 Looking for room ' + this.roomId + '...');
                this.isHost = false;
                this.playerId = id;
                
                const conn = this.peer.connect(hostPeerId, {
                    metadata: { name: playerName },
                    reliable: true,
                    serialization: 'json'
                });

                this.log('⏳ Connecting to host (ICE negotiation)...');

                const timeout = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        this.log('❌ Connection timed out after 15s');
                        try { conn.close(); } catch(e) {}
                        reject(new Error('Connection timed out. The host may be behind a firewall.'));
                    }
                }, 15000);
                
                conn.on('open', () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    this.log('✅ Connected to host!');
                    this.connections = [conn];
                    this.setupClientListeners(conn);
                    resolve(this.roomId);
                });

                conn.on('error', (err) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    this.log('❌ Connection error: ' + (err.message || err));
                    reject(new Error('Connection failed: ' + (err.message || err)));
                });

                // Monitor ICE connection state
                if (conn.peerConnection) {
                    conn.peerConnection.oniceconnectionstatechange = () => {
                        this.log('🔄 ICE: ' + conn.peerConnection.iceConnectionState);
                    };
                    conn.peerConnection.onicegatheringstatechange = () => {
                        this.log('🔄 ICE gather: ' + conn.peerConnection.iceGatheringState);
                    };
                }
            });
            
            this.peer.on('error', (err) => {
                this.log('❌ PeerJS error: ' + err.type + ' - ' + err.message);
                if (!settled) {
                    settled = true;
                    if (err.type === 'peer-unavailable') {
                        reject(new Error('Room "' + this.roomId + '" not found. Check the code.'));
                    } else {
                        reject(new Error(err.type + ': ' + err.message));
                    }
                }
            });
        });
    }

    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            this.log('📥 Incoming connection from: ' + conn.peer);
            
            if (this.players.length >= 4) {
                conn.on('open', () => {
                    conn.send({ type: 'ERROR', message: 'Room is full' });
                    setTimeout(() => conn.close(), 1000);
                });
                return;
            }

            conn.on('open', () => {
                const playerName = (conn.metadata && conn.metadata.name) || 'Player';
                this.log('✅ ' + playerName + ' joined!');
                this.connections.push(conn);
                
                const newPlayer = { id: conn.peer, name: playerName, isHost: false };
                this.players.push(newPlayer);
                
                this.onPlayerJoin(this.players);
                this.broadcast({ type: 'PLAYER_LIST', players: this.players });

                conn.on('data', (data) => {
                    this.handleData(data, conn.peer);
                });

                conn.on('close', () => {
                    this.log('👋 ' + playerName + ' disconnected');
                    this.connections = this.connections.filter(c => c.peer !== conn.peer);
                    this.players = this.players.filter(p => p.id !== conn.peer);
                    this.onPlayerLeave(this.players);
                    this.broadcast({ type: 'PLAYER_LIST', players: this.players });
                });
            });
        });
    }

    setupClientListeners(conn) {
        conn.on('data', (data) => {
            this.handleData(data, conn.peer);
        });

        conn.on('close', () => {
            this.log('⚠️ Connection to host lost.');
        });
    }

    handleData(data, senderId) {
        switch (data.type) {
            case 'PLAYER_LIST':
                this.players = data.players;
                this.onPlayerJoin(this.players);
                break;
            case 'GAME_START':
                this.onGameStart(data.state);
                break;
            case 'STATE_UPDATE':
                this.onStateUpdate(data.state);
                break;
            case 'PLAYER_ACTION':
                if (this.isHost) {
                    this.onStateUpdate({ action: data.action, playerId: senderId });
                }
                break;
            case 'ERROR':
                alert(data.message);
                break;
        }
    }

    broadcastState(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'STATE_UPDATE', state: state });
    }
    
    broadcastStart(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'GAME_START', state: state });
    }

    broadcast(data) {
        this.connections.forEach(conn => {
            if (conn.open) {
                conn.send(data);
            }
        });
    }

    sendAction(action) {
        if (this.isHost) {
            this.onStateUpdate({ action: action, playerId: this.playerId });
        } else {
            if (this.connections[0] && this.connections[0].open) {
                this.connections[0].send({ type: 'PLAYER_ACTION', action: action });
            }
        }
    }

    disconnect() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.peer = null;
        this.connections = [];
        this.players = [];
        this.roomId = null;
        this.isHost = false;
    }
}
