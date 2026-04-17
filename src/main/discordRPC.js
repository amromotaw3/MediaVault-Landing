const DiscordRPC = require('discord-rpc');
const clientId = '1493266136614310030';
let rpc;

function initDiscordRPC(ipcMain) {
    DiscordRPC.register(clientId);
    rpc = new DiscordRPC.Client({ transport: 'ipc' });
    
    let isConnected = false;
    let startTimestamp = new Date();

    rpc.on('ready', () => {
        console.log('[Discord RPC] Connected');
        isConnected = true;
        setActivity('Browsing Library');
    });

    rpc.login({ clientId }).catch(() => {
        console.warn('[Discord RPC] Could not connect to Discord client.');
    });

    function setActivity(state, details = '') {
        if (!isConnected) return;
        rpc.setActivity({
            details: details || 'In App',
            state: state,
            startTimestamp,
            largeImageKey: 'mediavault-logo', // Requires asset uploaded to Discord developer portal
            largeImageText: 'MediaVault',
            instance: false,
        }).catch(err => console.warn('[Discord RPC] Failed to set activity:', err.message));
    }

    // Set up IPC
    if (ipcMain) {
        ipcMain.on('discord-activity', (event, { type, title, subtitle }) => {
            if (type === 'playing') {
                setActivity(`Watching: ${title}`, subtitle);
            } else if (type === 'browsing') {
                setActivity('Browsing Library');
            } else if (type === 'clear') {
                if (isConnected) rpc.clearActivity().catch(() => {});
            }
        });
    }
}

module.exports = { initDiscordRPC };
