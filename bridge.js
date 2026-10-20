
'use strict';

const io = require('socket.io-client');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

const CNC_URL = process.env.CNC_URL || 'http://127.0.0.1:8000';
const HA_URL = (process.env.HA_URL || '').replace(/\/$/, '');
const HA_TOKEN = process.env.HA_TOKEN || '';
const PORT = process.env.CNC_PORT || '/dev/ttyUSB0';
const REFRESH_MS = 24 * 60 * 60 * 1000;

if (!HA_URL || !HA_TOKEN) {
  console.error('Missing HA_URL or HA_TOKEN');
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

let state = 'idle';
let detail = 'Starting';
let socketConnected = false;
let portConnected = false;
let attached = false;
let jobActive = false;
let alarm = false;
let grblState = '';
let workflow = '';
let sender = {};
let finishTimer = null;
let joinPending = false;
let token = '';
let tokenAt = 0;
let refreshing = null;
let authRetry = null;
let lastJoin = 0;

// --------------------------------------------------
// LED WS2812
// --------------------------------------------------

function led(s) {
  const color = s === 'stopped' ? 'idle' : s;

  const p = spawn(
    '/usr/bin/python3',
    [path.join(__dirname, 'led_spi.py'), color],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  p.stderr.on('data', d => log('LED:', String(d).trim()));
  p.on('error', e => log('LED launch:', e.message));
}

// --------------------------------------------------
// Home Assistant
// --------------------------------------------------

function ha(d = detail) {
  const payload = JSON.stringify({
    state,
    attributes: {
      friendly_name: 'CNCjs Status',
      detail: d,
      source: 'cncjs_bridge',
      job_active: jobActive,
      serial_connected: portConnected,
      socket_connected: socketConnected,
      attached,
      workflow,
      grbl_state: grblState
    }
  });

  const u = new URL(HA_URL + '/api/states/sensor.cncjs_status');
  const client = u.protocol === 'https:' ? https : http;

  const req = client.request(
    u,
    {
      method: 'POST',
      timeout: 5000,
      headers: {
        Authorization: 'Bearer ' + HA_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    },
    res => {
      res.resume();
      if (res.statusCode >= 300) {
        log('HA HTTP', res.statusCode);
      }
    }
  );

  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', e => log('HA:', e.message));
  req.end(payload);
}

function setState(s, d = '') {
  if (state !== s) {
    log('STATE', state, '->', s, d);
    state = s;
    led(s);
  }

  if (d) detail = d;
  ha();
}

// --------------------------------------------------
// Job handling
// --------------------------------------------------

function cancelFinish() {
  if (finishTimer) clearTimeout(finishTimer);
  finishTimer = null;
}

function fault(d, realAlarm = false) {
  cancelFinish();
  if (realAlarm) alarm = true;
  setState('error', d);
}

function startJob() {
  cancelFinish();

  if (
    alarm ||
    !attached ||
    !portConnected ||
    /^alarm/i.test(grblState)
  ) {
    return;
  }

  jobActive = true;
  setState('running', 'CNCjs workflow running');
}

function endJob() {
  finishTimer = null;

  if (!jobActive || alarm || !attached || !portConnected) {
    return;
  }

  if (grblState && !/^idle/i.test(grblState)) {
    fault('Workflow idle but GRBL is not confirmed idle');
    return;
  }

  log('END JOB DEBUG:', JSON.stringify({
    workflow,
    grblState,
    sender
  }));
  jobActive = false;

  const total = Number(sender.total || 0);
  const received = Number(sender.received || 0);
  const sent = Number(sender.sent || 0);

  if (
    sender.finishTime &&
    total > 0 &&
    (received >= total || sent >= total)
  ) {
    setState(
      'finished',
      'Sender finished; verify laser is stopped'
    );
  } else {
    setState(
      'stopped',
      'Job interrupted or completion not confirmed'
    );
  }
}

// --------------------------------------------------
// CNCjs authentication
// --------------------------------------------------

function fetchToken() {
  if (refreshing) return refreshing;

  refreshing = new Promise((resolve, reject) => {
    const u = new URL('/api/signin', CNC_URL);
    const client = u.protocol === 'https:' ? https : http;

    const req = client.request(
      u,
      {
        method: 'POST',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': 2
        }
      },
      res => {
        let body = '';
        res.setEncoding('utf8');

        res.on('data', chunk => {
          body += chunk;

          if (body.length > 65536) {
            req.destroy(new Error('Large signin response'));
          }
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error('Signin HTTP ' + res.statusCode)
            );
          }

          try {
            const data = JSON.parse(body);

            if (!data.token) {
              throw new Error('No token from CNCjs');
            }

            resolve(data.token);
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end('{}');
  }).finally(() => {
    refreshing = null;
  });

  return refreshing;
}

// --------------------------------------------------
// Socket.IO connection
// --------------------------------------------------

const socket = io(CNC_URL, {
  autoConnect: false,
  transports: ['polling'],
  reconnection: true,
  timeout: 10000
});

function retryAuth(delay = 10000) {
  if (authRetry) return;

  authRetry = setTimeout(() => {
    authRetry = null;
    connectWithToken(true);
  }, delay);
}

async function connectWithToken(force = false) {
  if (socket.connected) return;

  try {
    if (
      force ||
      !token ||
      Date.now() - tokenAt >= REFRESH_MS
    ) {
      token = await fetchToken();
      tokenAt = Date.now();

      log('CNCjs token obtained');
    }

    socket.io.opts.query = { token };
    socket.connect();
  } catch (e) {
    log('Token fetch error:', e.message);
    retryAuth(30000);
  }
}

// --------------------------------------------------
// Ray5 serial port
// --------------------------------------------------

function joinPort() {
  if (
    !socketConnected ||
    attached ||
    joinPending ||
    Date.now() - lastJoin < 3000
  ) {
    return;
  }

  joinPending = true;
  lastJoin = Date.now();

  // Important:
  // CNCjs "open" can open a closed serial port.
  // Do not retry automatically on a timer.

  socket.emit(
    'open',
    PORT,
    { controllerType: 'Grbl' },
    err => {
      joinPending = false;

      if (err) {
        log('Port join failed:', String(err));
        return;
      }

      attached = true;
      portConnected = true;

      log('Joined Ray5 port:', PORT);

      if (
        workflow === 'running' &&
        !alarm &&
        !/^alarm/i.test(grblState)
      ) {
        startJob();
      } else {
        ha('Joined Ray5 port; waiting for state');
      }
    }
  );
}

// --------------------------------------------------
// Connection events
// --------------------------------------------------

socket.on('connect', () => {
  socketConnected = true;
  attached = false;
  portConnected = false;

  log('Connected to CNCjs');
  socket.emit('list');
  joinPort();
});

socket.on('disconnect', reason => {
  socketConnected = false;
  attached = false;
  portConnected = false;
  joinPending = false;

  cancelFinish();
  fault('CNCjs connection lost: ' + reason);
});

socket.on('connect_error', e => {
  log('CNCjs connection error:', e.message);
});

socket.on('error', e => {
  log(
    'CNCjs socket error:',
    (e && e.code) ||
    (e && e.message) ||
    String(e)
  );

  if (
    e &&
    (
      e.type === 'UnauthorizedError' ||
      e.code === 'credentials_required' ||
      e.code === 'invalid_token'
    )
  ) {
    socket.disconnect();
    retryAuth(1000);
  }
});

// --------------------------------------------------
// Serial port events
// --------------------------------------------------

socket.on('serialport:open', info => {
  log('PORT OPEN EVENT:', JSON.stringify(info));

  portConnected = true;
  log('Serial port opened');

  if (!attached) {
    joinPort();
  } else {
    ha('Serial connected');
  }
});

socket.on('serialport:list', ports => {
  log('PORT LIST:', JSON.stringify(ports));
});

socket.on('serialport:change', info => {
  log('PORT CHANGE:', JSON.stringify(info));

  if (!info || info.port !== PORT) return;

  if (info.inuse === true) {
    log('Ray5 port opened in CNCjs - joining');

    if (!attached) {
      // Poczekaj, aż CNCjs zakończy otwieranie portu.
      setTimeout(() => {
        if (socketConnected && !attached) {
          joinPort();
        }
      }, 1000);
    }
  } else if (info.inuse === false) {
    log('Ray5 port closed in CNCjs');
    portConnected = false;
    attached = false;
  }
});
socket.on('serialport:close', () => {
  log('Serial port closed');

  attached = false;
  portConnected = false;
  joinPending = false;

  fault('Laser serial port closed');
});

socket.on('serialport:error', e => {
  fault(
    'Serial error: ' + JSON.stringify(e).slice(0, 120)
  );
});

// --------------------------------------------------
// Sender status
// --------------------------------------------------

socket.on('sender:status', s => {
  if (!s || typeof s !== 'object') return;

  const previous = sender;

  if (
    s.finishTime !== previous.finishTime ||
    s.sent !== previous.sent ||
    s.received !== previous.received
  ) {
    log('SENDER:', JSON.stringify({
      total: s.total,
      sent: s.sent,
      received: s.received,
      finishTime: s.finishTime,
      remainingTime: s.remainingTime,
      hold: s.hold
    }));
  }

  sender = s;
});
// --------------------------------------------------
// GRBL controller status
// --------------------------------------------------

socket.on('controller:state', raw => {
  if (!raw || typeof raw !== 'object') return;

  const nested =
    raw.status && typeof raw.status === 'object'
      ? raw.status
      : {};

  const next = String(
    raw.state ||
    nested.activeState ||
    nested.state ||
    raw.activeState ||
    ''
  ).trim();

  if (!next) return;

  if (next !== grblState) {
    log('GRBL', grblState, '->', next);
  }

  grblState = next;

  if (/^alarm/i.test(next)) {
    fault('GRBL Alarm', true);
    return;
  }

  if (alarm) {
    if (/^idle/i.test(next)) {
      alarm = false;
      jobActive = false;

      setState(
        'idle',
        'GRBL idle after alarm; inspect laser before use'
      );
    }

    return;
  }

  if (
    /^run/i.test(next) &&
    workflow === 'running' &&
    attached &&
    portConnected
  ) {
    startJob();
  } else if (/^hold/i.test(next) && jobActive) {
    cancelFinish();
    setState('paused', 'GRBL hold');
  }
});

// --------------------------------------------------
// Workflow status
// --------------------------------------------------

socket.on('workflow:state', raw => {
  const w = (
    typeof raw === 'string'
      ? raw
      : String((raw && raw.state) || '')
  ).toLowerCase();

  workflow = w;
  log('workflow', w);

  if (w === 'running') {
    startJob();
  } else if (w === 'paused' || w === 'hold') {
    cancelFinish();

    if (jobActive && !alarm) {
      setState('paused', 'Paused');
    }
  } else if (w === 'idle') {
    if (jobActive && !alarm) {
      cancelFinish();
      finishTimer = setTimeout(endJob, 1500);
    } else if (
      !alarm &&
      state !== 'finished' &&
      state !== 'stopped' &&
      state !== 'error'
    ) {
      setState('idle', 'Ready');
    }
  }
});

// --------------------------------------------------
// Heartbeat
// --------------------------------------------------

setInterval(() => {
  if (socketConnected) {
    ha('Heartbeat');
  }
}, 30000);

// --------------------------------------------------
// Token refresh every 24h
// --------------------------------------------------

setInterval(async () => {
  if (
    Date.now() - tokenAt < REFRESH_MS ||
    jobActive ||
    workflow === 'running' ||
    workflow === 'paused'
  ) {
    return;
  }

  try {
    const next = await fetchToken();

    token = next;
    tokenAt = Date.now();

    log('CNCjs token refreshed');

    // Reconnect only when no job is active.
    socket.disconnect();
    socket.io.opts.query = { token };
    socket.connect();
  } catch (e) {
    log('Token refresh error:', e.message);
  }
}, 60 * 60 * 1000);

// --------------------------------------------------
// Start
// --------------------------------------------------

led('idle');
ha('Bridge started');

log('Bridge started; awaiting CNCjs events');

connectWithToken(true);
