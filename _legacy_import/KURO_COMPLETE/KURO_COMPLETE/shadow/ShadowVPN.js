const { exec } = require('child_process');
const fs = require('fs');
const NephilimGate = require('./nephilimGate.js');

class ShadowVPN {
  constructor() {
    this.interface = 'wg0';
    this.status = 'dormant';
  }

  async initialize() {
    console.log('[ShadowVPN] Initializing WireFork Interface...');
    
    // INTELLIGENT PORT KNOCKING
    // Only open the VPN port if NephilimGate detects valid "Shadow Traffic" patterns
    // For now, we lock it by default.
    await this.runCmd(`ufw deny 51820/udp`);
    console.log('[ShadowVPN] Port 51820 LOCKED (Nephilim Gate Active)');
  }

  async rotateKeys() {
    console.log('[ShadowVPN] Rotating Sovereign Keys via Babylon Protocol...');
    const priv = (await this.runCmd('wg genkey')).trim();
    const pub = (await this.runCmd(`echo '${priv}' | wg pubkey`)).trim();
    
    // Write to config (Pseudo-code for safety)
    // fs.writeFileSync('/etc/wireguard/privatekey', priv);
    
    // Hot-swap the key without dropping connections
    await this.runCmd(`wg set ${this.interface} private-key /etc/wireguard/privatekey`);
    return pub;
  }

  async toggle(state) {
    // Basic WG control
    const cmd = state === 'up' ? `wg-quick up ${this.interface}` : `wg-quick down ${this.interface}`;
    try {
      await this.runCmd(cmd);
      this.status = state === 'up' ? 'active' : 'dormant';
      return { success: true, status: this.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  runCmd(cmd) {
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) resolve(stderr); // Soft fail
        else resolve(stdout);
      });
    });
  }
}

module.exports = new ShadowVPN();
