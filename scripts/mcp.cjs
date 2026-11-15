'use strict';
/**
 * Minimal MCP (Model Context Protocol) client over stdio — lets the engine use any of
 * the thousands of MCP servers (GitHub, files, browsers, image/video tools, databases…).
 * Spawns the server, lists its tools, calls one, and closes it.
 */
const { spawn } = require('node:child_process');

class McpClient {
    constructor({ command, args = [], env = {}, cwd, timeoutMs = 60000 }) {
        this.proc = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
        this.timeoutMs = timeoutMs;
        this.nextId = 1;
        this.pending = new Map();
        this.buf = '';
        this.stderr = '';
        this.proc.stdout.on('data', (d) => this.onData(d));
        this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
        this.exited = new Promise((r) => this.proc.on('exit', r));
        this.proc.on('error', (e) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); });
        this.proc.on('exit', () => { for (const p of this.pending.values()) p.reject(new Error(`MCP server band ho gaya. ${this.stderr.slice(-300)}`)); this.pending.clear(); });
    }

    onData(d) {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, i).trim();
            this.buf = this.buf.slice(i + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.id !== undefined && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error.message || 'MCP error'));
                else p.resolve(msg.result);
            }
        }
    }

    request(method, params) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`MCP ${method}: time-out`)); }, this.timeoutMs);
            this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
            this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
    }

    notify(method, params) {
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }

    async start() {
        await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'arjun-agents', version: '1.0.0' } });
        this.notify('notifications/initialized', {});
        return this;
    }

    async listTools() {
        return (await this.request('tools/list', {})).tools || [];
    }

    async callTool(name, args) {
        const r = await this.request('tools/call', { name, arguments: args || {} });
        const text = (r.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}${c.uri ? ` ${c.uri}` : ''}]`)).join('\n');
        if (r.isError) throw new Error(text || 'MCP tool error');
        return text;
    }

    async close() {
        try { this.proc.stdin.end(); } catch { /* already closed */ }
        const t = setTimeout(() => this.proc.kill(), 2000);
        await this.exited;
        clearTimeout(t);
    }
}

async function withMcp(def, fn) {
    const c = new McpClient(def);
    try {
        await c.start();
        return await fn(c);
    } finally {
        await c.close();
    }
}

module.exports = { McpClient, withMcp };
