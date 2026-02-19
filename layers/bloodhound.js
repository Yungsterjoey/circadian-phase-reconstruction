var axios = require('axios');
var cheerio = require('cheerio');

// ============================================
// BLOODHOUND PROTOCOL v1.0
// Asset Recovery & Dormant Wealth Detection
// ============================================

// Free API endpoints (no key required)
var ENDPOINTS = {
    // Blockchain explorers (free tiers)
    etherscan: 'https://api.etherscan.io/api',
    bscscan: 'https://api.bscscan.com/api',
    polygonscan: 'https://api.polygonscan.com/api',
    arbiscan: 'https://api.arbiscan.io/api',
    optimism: 'https://api-optimistic.etherscan.io/api',
    
    // Aggregators
    debank: 'https://pro-openapi.debank.com/v1',
    
    // Australian government sources
    asic: 'https://moneysmart.gov.au/find-unclaimed-money',
    ato_super: 'https://www.ato.gov.au/forms-and-instructions/lost-super-search',
    nsw_revenue: 'https://www.revenue.nsw.gov.au/unclaimed-money',
    qld_treasury: 'https://www.treasury.qld.gov.au/unclaimed-moneys/'
};

// ============================================
// 1. CRYPTO HUNTER - Multi-chain wallet scan
// ============================================

async function huntCrypto(address) {
    console.log("[BLOODHOUND] Crypto scan initiated:", address);
    var findings = [];
    
    // Validate address
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return { success: false, error: 'Invalid EVM address format' };
    }
    
    var chains = [
        { name: 'Ethereum', api: ENDPOINTS.etherscan, symbol: 'ETH' },
        { name: 'BSC', api: ENDPOINTS.bscscan, symbol: 'BNB' },
        { name: 'Polygon', api: ENDPOINTS.polygonscan, symbol: 'MATIC' },
        { name: 'Arbitrum', api: ENDPOINTS.arbiscan, symbol: 'ETH' },
        { name: 'Optimism', api: ENDPOINTS.optimism, symbol: 'ETH' }
    ];
    
    for (var i = 0; i < chains.length; i++) {
        var chain = chains[i];
        try {
            // Check native balance
            var balResp = await axios.get(chain.api, {
                params: { module: 'account', action: 'balance', address: address },
                timeout: 5000
            });
            
            if (balResp.data && balResp.data.result) {
                var balance = parseFloat(balResp.data.result) / 1e18;
                if (balance > 0.001) {
                    findings.push({
                        chain: chain.name,
                        asset: chain.symbol,
                        amount: balance.toFixed(6),
                        value_usd: null, // Would need price API
                        status: balance > 0.01 ? 'RECOVERABLE' : 'DUST',
                        type: 'NATIVE_BALANCE'
                    });
                }
            }
            
            // Check token balances (ERC20)
            var tokResp = await axios.get(chain.api, {
                params: { module: 'account', action: 'tokentx', address: address, page: 1, offset: 100 },
                timeout: 5000
            });
            
            if (tokResp.data && tokResp.data.result && Array.isArray(tokResp.data.result)) {
                // Find unique tokens received
                var tokensSeen = {};
                tokResp.data.result.forEach(function(tx) {
                    if (tx.to && tx.to.toLowerCase() === address.toLowerCase() && !tokensSeen[tx.contractAddress]) {
                        tokensSeen[tx.contractAddress] = {
                            symbol: tx.tokenSymbol,
                            name: tx.tokenName,
                            lastTx: tx.timeStamp
                        };
                    }
                });
                
                // Check for potential airdrops (tokens received but never sent)
                var sent = {};
                tokResp.data.result.forEach(function(tx) {
                    if (tx.from && tx.from.toLowerCase() === address.toLowerCase()) {
                        sent[tx.contractAddress] = true;
                    }
                });
                
                Object.keys(tokensSeen).forEach(function(contract) {
                    if (!sent[contract]) {
                        var tk = tokensSeen[contract];
                        var age = (Date.now()/1000 - parseInt(tk.lastTx)) / 86400;
                        if (age > 365) {
                            findings.push({
                                chain: chain.name,
                                asset: tk.symbol || 'UNKNOWN',
                                name: tk.name,
                                contract: contract,
                                amount: 'Check balance',
                                status: 'POTENTIAL_AIRDROP',
                                type: 'ERC20',
                                age_days: Math.floor(age)
                            });
                        }
                    }
                });
            }
            
            // Rate limit protection
            await sleep(200);
            
        } catch (err) {
            console.log("[BLOODHOUND] " + chain.name + " error:", err.message);
        }
    }
    
    return { success: true, address: address, findings: findings, chains_scanned: chains.length };
}

// ============================================
// 2. AIRDROP ELIGIBILITY CHECKER
// ============================================

var KNOWN_AIRDROPS = [
    { name: 'Arbitrum', check: 'https://arbitrum.io/airdrop', criteria: 'Bridge usage before cutoff' },
    { name: 'Optimism', check: 'https://optimism.io/airdrop', criteria: 'Network usage metrics' },
    { name: 'ENS', check: 'https://claim.ens.domains', criteria: 'ENS domain ownership' },
    { name: 'Blur', check: 'https://blur.io/airdrop', criteria: 'NFT trading activity' },
    { name: 'Uniswap', check: 'https://app.uniswap.org', criteria: 'Pre-Sept 2020 usage' },
    { name: 'dYdX', check: 'https://dydx.exchange', criteria: 'Trading volume' },
    { name: 'Jito', check: 'https://jito.network', criteria: 'Solana staking' },
    { name: 'Jupiter', check: 'https://jup.ag', criteria: 'Solana DEX usage' }
];

async function checkAirdrops(address) {
    console.log("[BLOODHOUND] Airdrop eligibility scan:", address);
    
    // This would require specific API calls to each protocol
    // For now, return the list of potential airdrops to manually check
    return {
        success: true,
        address: address,
        potential_airdrops: KNOWN_AIRDROPS,
        note: 'Manual verification required at each protocol site'
    };
}

// ============================================
// 3. AUSTRALIAN UNCLAIMED MONEY HUNTER
// ============================================

async function huntAustralianMoney(firstName, lastName, state) {
    console.log("[BLOODHOUND] AU unclaimed money scan:", firstName, lastName);
    var findings = [];
    
    // ASIC Unclaimed Money (national)
    try {
        // ASIC has a search portal - would need Puppeteer for full automation
        findings.push({
            source: 'ASIC - Unclaimed Money',
            url: 'https://moneysmart.gov.au/find-unclaimed-money',
            type: 'Bank accounts, shares, life insurance',
            search_link: 'https://moneysmart.gov.au/find-unclaimed-money?search=' + encodeURIComponent(firstName + ' ' + lastName),
            status: 'MANUAL_CHECK_REQUIRED',
            note: 'Includes: Bank accounts dormant 7+ years, uncashed dividends, matured bonds'
        });
    } catch(e) {}
    
    // ATO Lost Super
    try {
        findings.push({
            source: 'ATO - Lost Superannuation',
            url: 'https://www.ato.gov.au/Individuals/Super/In-detail/Searching-for-lost-super/',
            type: 'Superannuation',
            search_link: 'https://my.gov.au', // Requires MyGov login
            status: 'MANUAL_CHECK_REQUIRED',
            note: 'Average Australian has $4,500 in lost super. Check via MyGov.'
        });
    } catch(e) {}
    
    // State Revenue Offices
    var stateUrls = {
        'NSW': 'https://www.revenue.nsw.gov.au/unclaimed-money/search',
        'VIC': 'https://www.sro.vic.gov.au/unclaimed-money',
        'QLD': 'https://www.treasury.qld.gov.au/unclaimed-moneys/',
        'WA': 'https://www.wa.gov.au/service/justice/civil-law/search-unclaimed-money',
        'SA': 'https://www.revenuesa.sa.gov.au/unclaimed-money',
        'TAS': 'https://www.treasury.tas.gov.au/unclaimed-money',
        'ACT': 'https://www.revenue.act.gov.au/unclaimed-money',
        'NT': 'https://treasury.nt.gov.au/finance/unclaimed-money'
    };
    
    if (state && stateUrls[state.toUpperCase()]) {
        findings.push({
            source: state.toUpperCase() + ' Revenue Office',
            url: stateUrls[state.toUpperCase()],
            type: 'State unclaimed money',
            status: 'MANUAL_CHECK_REQUIRED',
            note: 'Includes: Bond refunds, overpayments, deceased estates'
        });
    } else {
        // Add all states
        Object.keys(stateUrls).forEach(function(st) {
            findings.push({
                source: st + ' Revenue Office',
                url: stateUrls[st],
                type: 'State unclaimed money',
                status: 'CHECK_ALL'
            });
        });
    }
    
    // Class Action Settlements
    findings.push({
        source: 'Class Action Database',
        url: 'https://www.classactionlawsuits.com.au/',
        type: 'Legal settlements',
        status: 'MANUAL_CHECK_REQUIRED',
        note: 'Bank fees, insurance overcharging, product recalls'
    });
    
    return {
        success: true,
        name: firstName + ' ' + lastName,
        state: state || 'ALL',
        findings: findings,
        total_sources: findings.length
    };
}

// ============================================
// 4. BRIDGE FAILURE SCANNER
// ============================================

async function scanBridgeFailures(address) {
    console.log("[BLOODHOUND] Bridge failure scan:", address);
    
    var bridges = [
        { name: 'Polygon Bridge', explorer: 'https://wallet.polygon.technology' },
        { name: 'Arbitrum Bridge', explorer: 'https://bridge.arbitrum.io' },
        { name: 'Optimism Bridge', explorer: 'https://app.optimism.io/bridge' },
        { name: 'Wormhole', explorer: 'https://wormhole.com/explorer' },
        { name: 'Stargate', explorer: 'https://stargate.finance' },
        { name: 'Hop Protocol', explorer: 'https://app.hop.exchange' }
    ];
    
    // Would need to query each bridge's API or indexer
    return {
        success: true,
        address: address,
        bridges_to_check: bridges,
        note: 'Stuck bridge transactions can be recovered by re-submitting with higher gas'
    };
}

// ============================================
// 5. FULL BLOODHOUND SCAN
// ============================================

async function fullScan(params) {
    var results = {
        scan_time: new Date().toISOString(),
        crypto: null,
        fiat_au: null,
        airdrops: null,
        bridges: null,
        total_findings: 0
    };
    
    if (params.wallet) {
        results.crypto = await huntCrypto(params.wallet);
        results.airdrops = await checkAirdrops(params.wallet);
        results.bridges = await scanBridgeFailures(params.wallet);
        if (results.crypto.findings) results.total_findings += results.crypto.findings.length;
    }
    
    if (params.firstName && params.lastName) {
        results.fiat_au = await huntAustralianMoney(params.firstName, params.lastName, params.state);
        if (results.fiat_au.findings) results.total_findings += results.fiat_au.findings.length;
    }
    
    return results;
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

module.exports = {
    huntCrypto: huntCrypto,
    huntAustralianMoney: huntAustralianMoney,
    checkAirdrops: checkAirdrops,
    scanBridgeFailures: scanBridgeFailures,
    fullScan: fullScan
};
