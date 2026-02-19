const crypto = require('crypto');
const config = require('../config.js');

const CUSTOM_ALPHABET = 'QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm0123456789+/';
const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const EMOJI_SET = '😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗☺😚😙🥲😋😛😜🤪😝🤑🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵🤯🤠🥳🥸😎🤓🧐😕😟🙁☹😮😯😲😳🥺😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾';

const BabylonProtocol = {
  name: 'Babylon Protocol', layer: 1.5, color: '#ea580c',
  
  encodeResponse(response, method = 'auto') {
    const data = typeof response === 'string' ? response : JSON.stringify(response);
    const encodings = config.shadow?.babylon?.encodings || ['customBase64', 'offsetHex', 'emojiEncode'];
    if (method === 'auto') method = encodings[Math.floor(Math.random() * encodings.length)];
    
    let encoded;
    switch (method) {
      case 'customBase64': encoded = this.encodings.customBase64.encode(data); break;
      case 'offsetHex': encoded = this.encodings.offsetHex.encode(data); break;
      case 'emojiEncode': encoded = this.encodings.emojiEncode.encode(data); break;
      case 'xorCipher': encoded = this.encodings.xorCipher.encode(data); break;
      default: encoded = data; method = 'none';
    }
    return { method, encoded };
  },
  
  decodeResponse(encoded, method) {
    if (!method || method === 'none') return encoded;
    switch (method) {
      case 'customBase64': return this.encodings.customBase64.decode(encoded);
      case 'offsetHex': return this.encodings.offsetHex.decode(encoded);
      case 'emojiEncode': return this.encodings.emojiEncode.decode(encoded);
      case 'xorCipher': return this.encodings.xorCipher.decode(encoded);
      default: return encoded;
    }
  },
  
  encodings: {
    customBase64: {
      encode(data) { let c = ''; for (const char of Buffer.from(data).toString('base64')) { const i = STANDARD_ALPHABET.indexOf(char); c += i >= 0 ? CUSTOM_ALPHABET[i] : char; } return { type: 'customBase64', data: c }; },
      decode(encoded) { let s = ''; for (const char of (encoded.data || encoded)) { const i = CUSTOM_ALPHABET.indexOf(char); s += i >= 0 ? STANDARD_ALPHABET[i] : char; } return Buffer.from(s, 'base64').toString('utf8'); },
    },
    offsetHex: {
      encode(data) { const hex = Buffer.from(data).toString('hex'), offset = Math.floor(Math.random() * 256); return { type: 'offsetHex', data: hex.split('').map(c => String.fromCharCode((c.charCodeAt(0) + offset) % 128)).join(''), offset }; },
      decode(encoded) { return Buffer.from(encoded.data.split('').map(c => { let code = c.charCodeAt(0) - encoded.offset; return String.fromCharCode(code < 0 ? code + 128 : code); }).join(''), 'hex').toString('utf8'); },
    },
    emojiEncode: {
      encode(data) { const emojis = [...EMOJI_SET]; return { type: 'emojiEncode', data: [...Buffer.from(data)].map(b => emojis[b % emojis.length]).join('') }; },
      decode(encoded) { const emojis = [...EMOJI_SET]; return Buffer.from([...(encoded.data || encoded)].map(c => emojis.indexOf(c)).filter(i => i >= 0)).toString('utf8'); },
    },
    xorCipher: {
      encode(data) { const key = crypto.randomBytes(32), buf = Buffer.from(data), enc = Buffer.alloc(buf.length); for (let i = 0; i < buf.length; i++) enc[i] = buf[i] ^ key[i % key.length]; return { type: 'xorCipher', data: enc.toString('base64'), key: key.toString('base64') }; },
      decode(encoded) { const key = Buffer.from(encoded.key, 'base64'), data = Buffer.from(encoded.data, 'base64'), dec = Buffer.alloc(data.length); for (let i = 0; i < data.length; i++) dec[i] = data[i] ^ key[i % key.length]; return dec.toString('utf8'); },
    },
  },
  
  getStats() { return { layer: this.layer, name: this.name, enabled: config.features?.babylonProtocol, encodings: config.shadow?.babylon?.encodings || [] }; },
};

module.exports = BabylonProtocol;
