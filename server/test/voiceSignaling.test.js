import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRoom, deleteRoom } from '../src/services/roomManager.js';
import { handleConnection } from '../src/ws/handler.js';

function startTestWsServer() {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', handleConnection);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        wss,
        port: address.port,
        close: () =>
          new Promise((done) => {
            for (const client of wss.clients) {
              try {
                client.terminate();
              } catch {}
            }
            wss.close(() => server.close(done));
          }),
      });
    });
  });
}

function connectClient(port, roomId, name, clientId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws?room=${roomId}&name=${encodeURIComponent(name)}&clientId=${encodeURIComponent(clientId)}`
    );
    const messages = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      messages.push(parsed);
      while (waiters.length > 0) {
        const idx = waiters.findIndex((w) => w.predicate(parsed));
        if (idx === -1) break;
        const [waiter] = waiters.splice(idx, 1);
        waiter.resolve(parsed);
      }
    });

    ws.once('open', () => {
      resolve({
        ws,
        messages,
        send: (type, payload = {}) => ws.send(JSON.stringify({ type, ...payload })),
        waitFor: (predicate, timeoutMs = 2000) => {
          const existing = messages.find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error('Timed out waiting for WebSocket message'));
            }, timeoutMs);
            waiters.push({
              predicate,
              resolve: (msg) => {
                clearTimeout(timer);
                res(msg);
              },
            });
          });
        },
        close: () =>
          new Promise((res) => {
            if (ws.readyState === WebSocket.CLOSED) {
              res();
              return;
            }
            ws.once('close', res);
            ws.close();
          }),
      });
    });

    ws.once('error', reject);
  });
}

test('voice_join, voice_state, voice_signal, and voice_leave relay properly between room peers', async () => {
  const srv = await startTestWsServer();
  const room = createRoom('sample.mp4', 'Sample Movie', 'Voice Test Room', 'user-a');

  const alice = await connectClient(srv.port, room.id, 'Alice', 'user-a');
  await alice.waitFor((m) => m.type === 'room_state');

  const bob = await connectClient(srv.port, room.id, 'Bob', 'user-b');
  await bob.waitFor((m) => m.type === 'room_state');
  await alice.waitFor((m) => m.type === 'user_joined' && m.user.id === 'user-b');

  alice.send('voice_join', { muted: false, deafened: false });
  const aliceVoiceJoinOnBob = await bob.waitFor(
    (m) => m.type === 'voice_state' && m.userId === 'user-a' && m.inVoice === true
  );
  assert.equal(aliceVoiceJoinOnBob.muted, false);
  assert.equal(aliceVoiceJoinOnBob.deafened, false);

  bob.send('voice_join', { muted: true, deafened: false });
  const bobVoiceJoinOnAlice = await alice.waitFor(
    (m) => m.type === 'voice_state' && m.userId === 'user-b' && m.inVoice === true
  );
  assert.equal(bobVoiceJoinOnAlice.muted, true);

  alice.send('voice_signal', {
    targetUserId: 'user-b',
    signal: { type: 'offer', sdp: 'v=0-test-sdp' },
  });
  const relayedOffer = await bob.waitFor(
    (m) => m.type === 'voice_signal' && m.senderId === 'user-a'
  );
  assert.equal(relayedOffer.signal.type, 'offer');
  assert.equal(relayedOffer.signal.sdp, 'v=0-test-sdp');

  bob.send('voice_state', { muted: true, deafened: true });
  const bobDeafenedOnAlice = await alice.waitFor(
    (m) => m.type === 'voice_state' && m.userId === 'user-b' && m.deafened === true
  );
  assert.equal(bobDeafenedOnAlice.muted, true);

  alice.send('voice_leave', {});
  const aliceLeftOnBob = await bob.waitFor(
    (m) => m.type === 'voice_state' && m.userId === 'user-a' && m.inVoice === false
  );
  assert.equal(aliceLeftOnBob.inVoice, false);

  await alice.close();
  await bob.close();
  deleteRoom(room.id);
  await srv.close();
});

test('reconnecting user resets active voice state and notifies room peers', async () => {
  const srv = await startTestWsServer();
  const room = createRoom('sample.mp4', 'Sample Movie', 'Reconnect Test', 'user-a');

  const alice = await connectClient(srv.port, room.id, 'Alice', 'user-a');
  await alice.waitFor((m) => m.type === 'room_state');

  const bob = await connectClient(srv.port, room.id, 'Bob', 'user-b');
  await bob.waitFor((m) => m.type === 'room_state');

  bob.send('voice_join', { muted: false, deafened: false });
  await alice.waitFor((m) => m.type === 'voice_state' && m.userId === 'user-b' && m.inVoice === true);

  const bobReconnected = await connectClient(srv.port, room.id, 'Bob', 'user-b');
  const bobRoomState = await bobReconnected.waitFor((m) => m.type === 'room_state');
  const bobEntry = bobRoomState.room.users.find((u) => u.id === 'user-b');
  assert.equal(bobEntry.inVoice, false);

  const aliceSawVoiceReset = await alice.waitFor(
    (m) => m.type === 'voice_state' && m.userId === 'user-b' && m.inVoice === false
  );
  assert.equal(aliceSawVoiceReset.inVoice, false);

  await alice.close();
  await bob.close();
  await bobReconnected.close();
  deleteRoom(room.id);
  await srv.close();
});
