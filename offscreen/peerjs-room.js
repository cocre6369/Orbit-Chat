/* Orbit PeerJS transport adapter.
 * One room owner holds the five-letter PeerJS ID; joiners connect to that owner.
 * The owner forwards Orbit envelopes to other room members. Password-protected content is
 * end-to-end encrypted; PeerServer only brokers WebRTC connections.
 */
import { Peer } from '../lib/peerjs-client.js';

const SYS = '__orbitPeerJS';
// Namespace the server-side PeerJS ID; the user-facing room code remains exactly five letters.
const ROOM_ID_PREFIX = 'orbit-chat-v1-';
function makeGuestPeerId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'orbit-client-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
const toBuffer = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return data;
};

export function joinRoom(config, roomCode, options = {}) {
  const role = options.role === 'host' ? 'host' : 'join';
  const code = String(roomCode || '').toLowerCase();
  if (!/^[a-z]{5}$/.test(code)) return Promise.reject(new Error('Room codes must be exactly five letters.'));
  const hostPeerId = ROOM_ID_PREFIX + code;

  return new Promise((resolve, reject) => {
    let settled = false;
    // Supplying a random guest ID skips PeerJS's extra HTTP ID-allocation request before WebSocket setup.
    const PeerType = options.PeerCtor || Peer;
    const server = options.server || { host: '0.peerjs.com', port: 443, path: '/', secure: true, key: 'peerjs' };
    const peer = new PeerType(role === 'host' ? hostPeerId : makeGuestPeerId(), {
      host: server.host, port: server.port, path: server.path || '/', secure: !!server.secure, key: server.key || 'peerjs', debug: 0,
      config: config && config.rtcConfig || undefined
    });
    const channels = new Map();
    const notified = new Set();
    const virtual = new Set();
    const actions = new Map();
    let joinCb = null, leaveCb = null;
    let room = null, hostChannel = null, closed = false;
    let lostCb = null, hostLost = false, hostLossDelivered = false;
    function signalLoss(info) { if (info && info.type === 'host') { hostLost = true; if (hostLossDelivered) return; hostLossDelivered = true; } if (lostCb) { try { lostCb(info || {}); } catch (e) { /* noop */ } } }

    function notifyJoin(id) {
      if (!id || notified.has(id)) return;
      notified.add(id);
      if (joinCb) { try { joinCb(id); } catch (e) { console.warn('[Orbit/PeerJS] join callback', e); } }
    }
    function notifyLeave(id) {
      if (!id || !notified.delete(id)) return;
      if (leaveCb) { try { leaveCb(id); } catch (e) { console.warn('[Orbit/PeerJS] leave callback', e); } }
    }
    function dispatch(action, data, peerId, metadata) {
      const a = actions.get(action);
      if (a && a.callback) { try { a.callback(data, { peerId, metadata: metadata || null }); } catch (e) { console.warn('[Orbit/PeerJS] action callback', e); } }
    }
    function rawSend(conn, frame) {
      if (conn && conn.open) { try { conn.send(frame); return true; } catch (e) { /* channel closed */ } }
      return false;
    }
    function announceLeft(id) {
      if (role === 'host') {
        for (const [otherId, conn] of channels) if (otherId !== id && otherId !== peer.id) rawSend(conn, { [SYS]: 'left', id });
      }
      notifyLeave(id);
      virtual.delete(id);
      channels.delete(id);
    }
    function addVirtual(id) {
      if (!id || id === peer.id || id === hostPeerId || virtual.has(id)) return;
      virtual.add(id);
      // Guest-side IDs are routed through the room owner; they need no PeerJS connection.
      if (role === 'join') channels.set(id, { peer: id, open: true, _orbitVirtual: true });
      notifyJoin(id);
    }
    function routeData(conn, frame) {
      const origin = role === 'host' ? conn.peer : frame.origin;
      if (!origin) return;
      dispatch(frame.action, frame.data, origin, frame.metadata);
      if (role !== 'host') return;
      const target = frame.target || null;
      if (target) {
        if (target !== peer.id) rawSend(channels.get(target), { [SYS]: 'data', origin, action: frame.action, data: frame.data, metadata: frame.metadata || null });
      } else {
        for (const [id, other] of channels) {
          if (id !== origin && id !== peer.id && !other._orbitVirtual) rawSend(other, { [SYS]: 'data', origin, action: frame.action, data: frame.data, metadata: frame.metadata || null });
        }
      }
    }
    function onFrame(conn, data) {
      if (!data || typeof data !== 'object') return;
      if (data[SYS] === 'roster' && role === 'join') { (data.peers || []).forEach(addVirtual); return; }
      if (data[SYS] === 'joined' && role === 'join') { addVirtual(data.id); return; }
      if (data[SYS] === 'left' && role === 'join') { notifyLeave(data.id); virtual.delete(data.id); channels.delete(data.id); return; }
      if (data[SYS] === 'data') { routeData(conn, data); return; }
      if (data[SYS] === 'ping') {
        if (role === 'host' && data.target && data.target !== peer.id) {
          rawSend(channels.get(data.target), { [SYS]: 'ping', nonce: data.nonce, origin: data.origin, at: data.at });
        } else if (role === 'join' && data.target && data.target !== hostPeerId) {
          rawSend(hostChannel, { [SYS]: 'ping', nonce: data.nonce, origin: peer.id, target: data.target, at: data.at });
        } else {
          const response = { [SYS]: 'pong', nonce: data.nonce, target: data.origin, at: data.at };
          if (role === 'host') rawSend(channels.get(conn.peer), response);
          else rawSend(hostChannel, response);
        }
        return;
      }
      if (data[SYS] === 'pong') {
        if (role === 'host' && data.target && data.target !== peer.id) rawSend(channels.get(data.target), data);
        else { const resolvePing = pings.get(data.nonce); if (resolvePing) { pings.delete(data.nonce); resolvePing(Date.now() - data.at); } }
        return;
      }
      if (data[SYS]) return;
    }
    const pings = new Map();

    function attachChannel(conn, isRoomChannel) {
      conn.on('open', () => {
        if (closed) { try { conn.close(); } catch (e) { /* noop */ } return; }
        channels.set(conn.peer, conn);
        if (role === 'host') {
          const existing = Array.from(channels.keys()).filter((id) => id !== conn.peer && id !== peer.id);
          rawSend(conn, { [SYS]: 'roster', peers: existing });
          for (const [id, other] of channels) if (id !== conn.peer && id !== peer.id) rawSend(other, { [SYS]: 'joined', id: conn.peer });
          notifyJoin(conn.peer);
        } else if (isRoomChannel) {
          hostChannel = conn;
          notifyJoin(hostPeerId);
          rawSend(conn, { [SYS]: 'register', id: peer.id });
        } else notifyJoin(conn.peer);
      });
      conn.on('data', (data) => onFrame(conn, data));
      conn.on('close', () => {
        if (role === 'host') announceLeft(conn.peer);
        else if (conn.peer === hostPeerId) {
          signalLoss({ type: 'host' });
          for (const id of Array.from(notified)) notifyLeave(id);
          channels.clear(); virtual.clear(); hostChannel = null;
        } else announceLeft(conn.peer);
      });
      conn.on('error', (err) => {
        if (role === 'join' && isRoomChannel && err && ['peer-unavailable', 'unavailable-id'].includes(err.type)) signalLoss({ type: 'host' });
        if (role === 'host' && err && /unavailable|not found/i.test(String(err.type || err.message || ''))) announceLeft(conn.peer);
      });
    }

    peer.on('connection', (conn) => {
      if (role !== 'host') { try { conn.close(); } catch (e) { /* noop */ } return; }
      attachChannel(conn, false);
    });
    peer.on('open', (id) => {
      if (settled) return;
      if (role === 'join') {
        const conn = peer.connect(hostPeerId, { reliable: true, metadata: { orbitRoom: true } });
        attachChannel(conn, true);
      }
      const api = {
        peer,
        hostPeerId,
        makeAction(name) {
          if (!actions.has(name)) actions.set(name, { callback: null });
          const item = actions.get(name);
          return {
            send(data, opts = {}) {
              const target = opts && opts.target || null;
              const metadata = opts && opts.metadata || null;
              const payload = toBuffer(data);
              if (role === 'host') {
                const frame = { [SYS]: 'data', origin: peer.id, action: name, data: payload, metadata };
                if (target) rawSend(channels.get(target), frame);
                else for (const [pid, conn] of channels) if (pid !== peer.id && !conn._orbitVirtual) rawSend(conn, frame);
              } else {
                rawSend(hostChannel, { [SYS]: 'data', origin: peer.id, action: name, data: payload, metadata, target });
              }
            },
            get onMessage() { return item.callback; },
            set onMessage(fn) { item.callback = fn; }
          };
        },
        getPeers() {
          const out = {};
          for (const [pid, conn] of channels) {
            const pc = conn && (conn.peerConnection || conn._peerConnection);
            out[pid] = pc || { connectionState: 'connected', iceConnectionState: 'connected', getStats: async () => new Map() };
          }
          return out;
        },
        ping(target) {
          const nonce = Math.random().toString(36).slice(2);
          return new Promise((res) => { const timer = setTimeout(() => { pings.delete(nonce); res(NaN); }, 2500); pings.set(nonce, (ms) => { clearTimeout(timer); res(ms); });
            if (role === 'host') rawSend(channels.get(target), { [SYS]: 'ping', nonce, origin: peer.id, at: Date.now() });
            else rawSend(hostChannel, { [SYS]: 'ping', nonce, origin: peer.id, target, at: Date.now() });
          });
        },
        leave() {
          closed = true;
          for (const conn of channels.values()) { try { if (conn && !conn._orbitVirtual) conn.close(); } catch (e) { /* noop */ } }
          channels.clear(); virtual.clear();
          try { peer.destroy(); } catch (e) { /* noop */ }
        },
        get onTransportLost() { return true; },
        set onTransportLost(fn) { lostCb = fn; if (hostLost && fn && !hostLossDelivered) { hostLossDelivered = true; try { fn({ type: 'host' }); } catch (e) { /* noop */ } } },
        set onPeerJoin(fn) { joinCb = fn; for (const id of notified) { try { fn(id); } catch (e) { /* noop */ } } },
        get onPeerJoin() { return joinCb; },
        set onPeerLeave(fn) { leaveCb = fn; },
        get onPeerLeave() { return leaveCb; }
      };
      room = api;
      if (role === 'join') {
        // room-code connection may open after this return; Room waits for onPeerJoin.
      }
      settled = true;
      resolve(api);
    });
    peer.on('error', (err) => {
      if (!settled) {
        const e = new Error(err && err.message || 'PeerJS signaling failed');
        e.code = err && err.type === 'unavailable-id' ? 'unavailable-id' : (err && err.type || 'peerjs-error');
        settled = true;
        try { peer.destroy(); } catch (ignored) { /* noop */ }
        reject(e);
      } else if (!closed && role === 'host' && room && room.onTransportLost && err && ['network', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
        signalLoss({ type: 'signal' });
      }
    });
    peer.on('disconnected', () => {
      if (!closed && role === 'host' && room && room.onTransportLost) signalLoss({ type: 'signal' });
    });
  });
}
