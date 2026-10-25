'use strict';
// LAN command API for existing bridge.js; CNCjs remains owned by the existing socket.
const http = require('http');
const crypto = require('crypto');
const MAX_BODY = 5 * 1024 * 1024 + 8192;
module.exports = function startBridgeApi({socket, port, snapshot}) {
  const secret = process.env.BRIDGE_API_TOKEN || '';
  const host = process.env.BRIDGE_API_HOST || '127.0.0.1';
  const listenPort = Number(process.env.BRIDGE_API_PORT || 8765);
  if (!secret || secret.length < 24) {
    console.error('Bridge API disabled: set BRIDGE_API_TOKEN (min 24 chars)');
    return;
  }
  const respond = (res, status, body) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(JSON.stringify(body));
  };
  http.createServer((req,res) => {
    const a = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const b = Buffer.from(secret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return respond(res,401,{error:'Unauthorized'});
    if (req.method === 'GET' && req.url === '/v1/status') return respond(res,200,snapshot());
    if (req.method !== 'POST' || req.url !== '/v1/command') return respond(res,404,{error:'Not found'});
    let body = '', size = 0, rejected = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { rejected = true; respond(res,413,{error:'Payload too large'}); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => {
      if (rejected) return;
      let data;
      try { data = JSON.parse(body); } catch (_) { return respond(res,400,{error:'Invalid JSON'}); }
      const s = snapshot();
      if (!s.socket_connected || !s.serial_connected || !s.attached || !socket.connected) return respond(res,409,{error:'CNCjs/USB not connected'});
      if (s.alarm || /^alarm/i.test(s.grbl_state)) return respond(res,409,{error:'GRBL alarm'});
      const action = data.action;
      if (action === 'pause' && s.state !== 'running') return respond(res,409,{error:'Not running'});
      if (action === 'stop' || action === 'pause') {
        const cmd = action === 'stop' ? 'gcode:stop' : 'gcode:pause';
        if (action === 'stop') socket.emit('command',cmd,port,{force:true});
        else socket.emit('command',cmd,port);
        return respond(res,202,{result:'sent_not_acknowledged',action});
      }
      if (action === 'load') {
        if (s.job_active || ['running','paused','hold'].includes(s.state)) return respond(res,409,{error:'Job active'});
        if (typeof data.filename !== 'string' || !/^[^\\/\x00-\x1f]+\.(nc|gcode|gc|tap)$/i.test(data.filename) || data.filename.length > 200) return respond(res,400,{error:'Invalid filename'});
        if (typeof data.gcode !== 'string' || Buffer.byteLength(data.gcode,'utf8') > 5*1024*1024) return respond(res,413,{error:'G-code too large'});
        socket.emit('command','gcode:load',port,data.filename,data.gcode,{});
        return respond(res,202,{result:'sent_not_acknowledged',action});
      }
      return respond(res,400,{error:'Action disabled or unknown'});
    });
  }).listen(listenPort,host,()=>console.log('Bridge API listening on',host+':'+listenPort));
};
