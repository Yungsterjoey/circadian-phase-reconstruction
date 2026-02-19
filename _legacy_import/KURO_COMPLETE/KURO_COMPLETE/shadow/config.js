const config = {
  version: '2.2',
  
  features: {
    shadowProtocol: process.env.KURO_SHADOW_PROTOCOL === 'true',
    nephilimGate: process.env.KURO_NEPHILIM_GATE === 'true' || process.env.KURO_SHADOW_PROTOCOL === 'true',
    babylonProtocol: process.env.KURO_BABYLON_PROTOCOL === 'true' || process.env.KURO_SHADOW_PROTOCOL === 'true',
    mnemosyneCache: process.env.KURO_MNEMOSYNE_CACHE === 'true' || process.env.KURO_SHADOW_PROTOCOL === 'true',
    deadDrops: process.env.KURO_DEAD_DROPS === 'true' || process.env.KURO_SHADOW_PROTOCOL === 'true',
    onionRouting: process.env.KURO_ONION_ROUTING === 'true',
    vpnControl: process.env.KURO_VPN_CONTROL === 'true',
    dnsStats: true,
    provenanceOverlay: true,
    attestationBadges: true,
    trustZoneRail: true,
    intentCostRail: true,
    strictCapabilities: process.env.KURO_STRICT_CAPABILITIES === 'true'
  },
  
  shadow: {
    deadDropExpiry: 72 * 60 * 60 * 1000,
    chaffMultiplier: 20,
    maxHops: 5,
    dropsDir: '/var/www/kuro/data/shadow/drops'
  },
  
  trustZones: {
    LOCAL: { level: 4, allowWeb: false, allowCloud: false, requireSigned: true },
    VPS: { level: 3, allowWeb: false, allowCloud: false, requireSigned: false },
    PRIVATE: { level: 2, allowWeb: false, allowCloud: false, requireSigned: false },
    OPEN: { level: 1, allowWeb: true, allowCloud: true, requireSigned: false }
  }
};

module.exports = config;
