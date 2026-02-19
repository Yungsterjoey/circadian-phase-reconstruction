var axios = require('axios');
var fs = require('fs');
var path = require('path');

// ============================================
// HARVESTER v1.0 - Autonomous Wealth Recovery
// ============================================

var STATE_FILE = path.join(__dirname, '../data/harvester_state.json');
var FINDINGS_FILE = path.join(__dirname, '../data/harvester_findings.json');

// Ensure data directory exists
var dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Default state
var defaultState = {
    running: false,
    paused: false,
    mode: 'scan', // scan | analyze | harvest
    stats: {
        started_at: null,
        addresses_scanned: 0,
        chains_checked: 0,
        findings_total: 0,
        value_found_usd: 0,
        value_harvested_usd: 0
    },
    config: {
        target_wallet: null, // Your BTC/ETH wallet for deposits
        min_value_usd: 10, // Minimum value to harvest
        scan_delay_ms: 2000, // Delay between scans (rate limiting)
        chains: ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base'],
        auto_harvest: false // Safety: manual approval by default
    },
    current_scan: {
        chain: null,
        block: null,
        address: null
    }
};

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch(e) {}
    return JSON.parse(JSON.stringify(defaultState));
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadFindings() {
    try {
        if (fs.existsSync(FINDINGS_FILE)) {
            return JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8'));
        }
    } catch(e) {}
    return [];
}

function saveFindings(findings) {
    fs.writeFileSync(FINDINGS_FILE, JSON.stringify(findings, null, 2));
}

function addFinding(finding) {
    var findings = loadFindings();
    finding.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    finding.found_at = new Date().toISOString();
    finding.status = 'pending'; // pending | approved | harvested | failed
    findings.push(finding);
    saveFindings(findings);
    return finding;
}

// ============================================
// CHAIN SCANNERS
// ============================================

var CHAIN_RPCS = {
    ethereum: 'https://eth.llamarpc.com',
    bsc: 'https://bsc-dataseed.binance.org',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    optimism: 'https://mainnet.optimism.io',
    base: 'https://mainnet.base.org'
};

var CHAIN_APIS = {
    ethereum: 'https://api.etherscan.io/api',
    bsc: 'https://api.bscscan.com/api',
    polygon: 'https://api.polygonscan.com/api',
    arbitrum: 'https://api.arbiscan.io/api',
    optimism: 'https://api-optimistic.etherscan.io/api',
    base: 'https://api.basescan.org/api'
};

// Scan for dormant wallets with value
async function scanDormantWallets(chain, startBlock, count) {
    var api = CHAIN_APIS[chain];
    if (!api) return { error: 'Unknown chain' };
    
    var findings = [];
    
    try {
        // Get recent transactions to find addresses
        var resp = await axios.get(api, {
            params: {
                module: 'proxy',
                action: 'eth_getBlockByNumber',
                tag: '0x' + startBlock.toString(16),
                boolean: true
            },
            timeout: 10000
        });
        
        if (resp.data && resp.data.result && resp.data.result.transactions) {
            var txs = resp.data.result.transactions;
            var addresses = new Set();
            
            txs.forEach(function(tx) {
                if (tx.from) addresses.add(tx.from);
                if (tx.to) addresses.add(tx.to);
            });
            
            // Check each address for dormant funds
            for (var addr of addresses) {
                await sleep(500); // Rate limit
                
                var balResp = await axios.get(api, {
                    params: { module: 'account', action: 'balance', address: addr },
                    timeout: 5000
                });
                
                if (balResp.data && balResp.data.result) {
                    var balance = parseFloat(balResp.data.result) / 1e18;
                    
                    if (balance > 0.01) {
                        // Check last tx time
                        var txResp = await axios.get(api, {
                            params: { module: 'account', action: 'txlist', address: addr, page: 1, offset: 1, sort: 'desc' },
                            timeout: 5000
                        });
                        
                        var lastTx = txResp.data && txResp.data.result && txResp.data.result[0];
                        var dormantDays = 0;
                        
                        if (lastTx && lastTx.timeStamp) {
                            dormantDays = Math.floor((Date.now()/1000 - parseInt(lastTx.timeStamp)) / 86400);
                        }
                        
                        // Flag if dormant > 2 years
                        if (dormantDays > 730) {
                            findings.push({
                                chain: chain,
                                address: addr,
                                balance: balance,
                                dormant_days: dormantDays,
                                type: 'DORMANT_WALLET',
                                harvestable: false, // Can't harvest without private key
                                note: 'Dormant wallet detected - informational only'
                            });
                        }
                    }
                }
            }
        }
    } catch(err) {
        console.log('[HARVESTER] Scan error:', err.message);
    }
    
    return { chain, startBlock, findings };
}

// Scan for unclaimed airdrops (tokens sent but never moved)
async function scanUnclaimedAirdrops(chain, tokenContract) {
    var api = CHAIN_APIS[chain];
    var findings = [];
    
    try {
        // Get token transfer events
        var resp = await axios.get(api, {
            params: {
                module: 'account',
                action: 'tokentx',
                contractaddress: tokenContract,
                page: 1,
                offset: 1000,
                sort: 'desc'
            },
            timeout: 10000
        });
        
        if (resp.data && resp.data.result) {
            var received = {};
            var sent = {};
            
            resp.data.result.forEach(function(tx) {
                if (tx.to) {
                    if (!received[tx.to]) received[tx.to] = 0;
                    received[tx.to] += parseFloat(tx.value);
                }
                if (tx.from) {
                    sent[tx.from] = true;
                }
            });
            
            // Find addresses that received but never sent (unclaimed)
            Object.keys(received).forEach(function(addr) {
                if (!sent[addr] && received[addr] > 0) {
                    findings.push({
                        chain: chain,
                        address: addr,
                        token: tokenContract,
                        balance: received[addr],
                        type: 'UNCLAIMED_AIRDROP',
                        harvestable: false,
                        note: 'Tokens received but never moved'
                    });
                }
            });
        }
    } catch(err) {
        console.log('[HARVESTER] Airdrop scan error:', err.message);
    }
    
    return { chain, token: tokenContract, findings };
}

// Scan for stuck bridge transactions
async function scanStuckBridges() {
    // This would query bridge contracts for pending/stuck transactions
    // Requires specific bridge contract ABIs
    return { findings: [], note: 'Bridge scanning requires specific contract integration' };
}

// ============================================
// HARVESTER CONTROL
// ============================================

var harvesterInterval = null;

async function startHarvester(config) {
    var state = loadState();
    
    if (state.running) {
        return { success: false, error: 'Already running' };
    }
    
    state.running = true;
    state.paused = false;
    state.stats.started_at = new Date().toISOString();
    
    if (config) {
        if (config.target_wallet) state.config.target_wallet = config.target_wallet;
        if (config.min_value_usd) state.config.min_value_usd = config.min_value_usd;
        if (config.scan_delay_ms) state.config.scan_delay_ms = config.scan_delay_ms;
        if (config.chains) state.config.chains = config.chains;
        if (config.auto_harvest !== undefined) state.config.auto_harvest = config.auto_harvest;
    }
    
    saveState(state);
    
    // Start the scanning loop
    runHarvesterLoop();
    
    return { success: true, state: state };
}

function pauseHarvester() {
    var state = loadState();
    state.paused = true;
    saveState(state);
    return { success: true, state: state };
}

function resumeHarvester() {
    var state = loadState();
    if (!state.running) {
        return { success: false, error: 'Not running' };
    }
    state.paused = false;
    saveState(state);
    runHarvesterLoop();
    return { success: true, state: state };
}

function stopHarvester() {
    var state = loadState();
    state.running = false;
    state.paused = false;
    saveState(state);
    
    if (harvesterInterval) {
        clearTimeout(harvesterInterval);
        harvesterInterval = null;
    }
    
    return { success: true, state: state };
}

function getStatus() {
    var state = loadState();
    var findings = loadFindings();
    
    return {
        state: state,
        findings_count: findings.length,
        pending_harvest: findings.filter(f => f.status === 'pending').length,
        recent_findings: findings.slice(-10)
    };
}

async function runHarvesterLoop() {
    var state = loadState();
    
    if (!state.running || state.paused) {
        return;
    }
    
    console.log('[HARVESTER] Scan cycle starting...');
    
    // Rotate through chains
    var chains = state.config.chains;
    var chainIndex = chains.indexOf(state.current_scan.chain);
    chainIndex = (chainIndex + 1) % chains.length;
    var chain = chains[chainIndex];
    
    state.current_scan.chain = chain;
    state.stats.chains_checked++;
    saveState(state);
    
    try {
        // Get latest block
        var rpc = CHAIN_RPCS[chain];
        var blockResp = await axios.post(rpc, {
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1
        }, { timeout: 5000 });
        
        var latestBlock = parseInt(blockResp.data.result, 16);
        
        // Scan a random older block range (looking for dormant addresses)
        var scanBlock = latestBlock - Math.floor(Math.random() * 1000000) - 100000;
        
        var results = await scanDormantWallets(chain, scanBlock, 10);
        
        if (results.findings && results.findings.length > 0) {
            results.findings.forEach(function(f) {
                addFinding(f);
            });
            
            state = loadState();
            state.stats.findings_total += results.findings.length;
            saveState(state);
            
            console.log('[HARVESTER] Found', results.findings.length, 'items on', chain);
        }
        
        state = loadState();
        state.stats.addresses_scanned += 50;
        saveState(state);
        
    } catch(err) {
        console.log('[HARVESTER] Loop error:', err.message);
    }
    
    // Schedule next scan
    state = loadState();
    if (state.running && !state.paused) {
        harvesterInterval = setTimeout(runHarvesterLoop, state.config.scan_delay_ms);
    }
}

// Manual harvest approval
function approveHarvest(findingId) {
    var findings = loadFindings();
    var finding = findings.find(f => f.id === findingId);
    
    if (!finding) {
        return { success: false, error: 'Finding not found' };
    }
    
    if (!finding.harvestable) {
        return { success: false, error: 'This finding is not harvestable (informational only)' };
    }
    
    finding.status = 'approved';
    finding.approved_at = new Date().toISOString();
    saveFindings(findings);
    
    return { success: true, finding: finding };
}

// Execute harvest (transfer to your wallet)
async function executeHarvest(findingId, privateKey) {
    // SAFETY: This would execute an actual blockchain transaction
    // Only implement if you understand the risks
    return { 
        success: false, 
        error: 'Harvest execution disabled for safety. Implement with extreme caution.',
        note: 'You would need to sign a transaction with the source wallet private key'
    };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
    startHarvester,
    pauseHarvester,
    resumeHarvester,
    stopHarvester,
    getStatus,
    approveHarvest,
    executeHarvest,
    scanDormantWallets,
    scanUnclaimedAirdrops,
    loadFindings
};
