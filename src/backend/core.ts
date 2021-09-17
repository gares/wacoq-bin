import { EventEmitter } from 'events';
import { unzipSync } from 'fflate';

import { OCamlExecutable, OCamlCAPI } from './ocaml_exec';
import { WorkerInterrupts } from './interrupt';



class IcoqPod extends EventEmitter {

    core: OCamlExecutable
    intr: WorkerInterrupts

    binDir: string
    io: IO

    constructor(binDir?: string) {
        super();
        binDir = binDir || (typeof fetch === 'undefined'
                            || process.env.NODE_NOW ? './bin' : '../bin');
        this.binDir = binDir;

        this.core = new OCamlExecutable({stdin: false, tty: false, binDir});

        var utf8 = new TextDecoder();
        this.core.on('stream:out', ev => console.log(utf8.decode(ev.data)));

        this.io = new IO;
        this.intr = new WorkerInterrupts();
    }

    get fs() { return this.core.fs; }

    async boot() {
        await this.upload(`${this.binDir}/icoq.bc`, '/lib/icoq.bc');
    
        this._preloadStub();
    
        await this.core.run('/lib/icoq.bc', [], ['wacoq_post']);
    }

    async upload(fromUri: string, toPath: string) {
        var content = await this.io._fetch(fromUri);
        this.putFile(toPath, content);
    }

    loadPackage(uri: string, refresh: boolean = true) {
        return this.loadPackages([uri], refresh);
    }

    async loadPackages(uris: string | string[], refresh: boolean = true) {
        if (typeof uris == 'string') uris = [uris];
        
        await Promise.all(uris.map(async uri => {
            try {
                await this.unzip(uri, '/lib');
                this.answer([['LibLoaded', uri]]);
            }
            catch (e) {
                this.answer([['LibError', uri, e.toString()]]);
                throw e;
            }
        }));

        if (refresh)
            this.command(['RefreshLoadPath']);

        this.answer([['LoadedPkg', uris]]);
    }

    async loadSources(uri: string, dirpath: string) {
        var subdir = dirpath.replace(/[.]|([^/])$/g, '$1/');
        this.unzip(uri, `/src/${subdir}`);
    }

    unzip(uri: string, dir: string) {
        return this.io.unzip(this._pkgUri(uri),
                    (fn, ui8a) => this.putFile(`${dir}/${fn}`, ui8a),
                    p => this._progress(uri, p));
    }

    _pkgUri(uri: string) {
        return (uri[0] == '+') ?
            `${this.binDir}/coq/${uri.substring(1)}.coq-pkg` : uri;
    }

    _progress(uri: string, download: DownloadProgress) {
        this.emit('progress', {uri, download});
    }

    putFile(filename: string, content: Uint8Array | string) {
        if (!filename.startsWith('/')) filename = `/lib/${filename}`;
        // needs to be synchronous
        this.fs.mkdirpSync(filename.replace(/[/][^/]+$/, ''))
        this.fs.writeFileSync(filename, content);
    }

    getFile(filename: string) {
        if (!filename.startsWith('/')) filename = `/lib/${filename}`;
        var buf: Uint8Array = null;
        try { buf = <any>this.fs.readFileSync(filename); } catch { }
        this.answer([['Got', filename, buf]]);
    }

    command(cmd: any[]) {
        switch (cmd[0]) {
        case 'LoadPkg':        this.loadPackages(cmd[1]);          return;
        case 'Put':            this.putFile(cmd[1], cmd[2]);       return;
        case 'Get':            this.getFile(cmd[1]);               return;
        case 'InterruptSetup': this.intr.setup(cmd[1]);            return;
        }

        const wacoq_post = this.core.callbacks && this.core.callbacks.wacoq_post;
        if (!wacoq_post) return;

        var json = (typeof cmd === 'string') ? cmd : JSON.stringify(cmd),
            answer = wacoq_post(this.core.to_caml_string(json));
        this._answer(answer);
    }
    
    answer(msgs: any[][]) {
        for (let msg of msgs) this.emit('message', msg);
    }
    
    _answer(ptr: number) {
        var cstr = this.core.proc.userGetCString(ptr);
        this.answer(JSON.parse(<any>cstr));
    }

    _interrupt_pending() {
        return OCamlCAPI.Val_bool(this.intr.pending());
    }

    /**
     * (internal) Initializes the dllcoqrun_stub shared library.
     */
    _preloadStub() {
        this.core.proc.dyld.preload(
            'dllcoqrun_stubs.so', `${this.binDir}/coq/dllcoqrun_stubs.wasm`);
        this.core.proc.dyld.preload(
            'dlllib_stubs.so', `${this.binDir}/coq/dlllib_stubs.wasm`,
            {
                js: {
                    wacoq_emit: (s:number) => this._answer(s),
                    interrupt_pending: (_:number) => this._interrupt_pending()
                }
            }
        );
    }    
}


class IO {

    pending = new Set<ReadableStreamDefaultReader<Uint8Array>>()

    async unzip(uri: string, put: (filename: string, content: Uint8Array) => void, progress?: (p: any) => void) {
        var zip = unzipSync(await this._fetch(uri, progress));

        for (let [filename, data] of Object.entries(zip)) {
            put(filename, data);
        }
    }

    async _fetch(uri: string, progress?: (p: any) => void) : Promise<Uint8Array> {
        if (progress && typeof fetch !== 'undefined') {
            return this._toU8A(this._fetchWithProgress(uri, progress));
        }
        else return this._fetchSimple(uri);
    }

    async _toU8A(blob: Promise<Blob>) {
        return new Uint8Array(await (await blob).arrayBuffer());
    }

    async _fetchSimple(uri: string) {
        if (typeof fetch !== 'undefined') {
            return new Uint8Array(await (await fetch(uri)).arrayBuffer())
        }
        else {
            const fs = require('fs');
            return (0||fs.readFileSync)(uri);
        }
    }

    // boilerplate
    async _fetchWithProgress(uri: string, progress: (p: any) => void) {
        var response = await fetch(uri),
            total = +response.headers.get('Content-Length') || 1000,
            r = response.body.getReader(), chunks = [], downloaded = 0;
        this.pending.add(r); // prevent reader from being disposed
        try {
            for(;;) {
                var {value, done} = await r.read();
                if (done) break;
                chunks.push(value);
                downloaded += value.length;
                progress({total, downloaded})
            }
            return new Blob(chunks);
        }
        finally { this.pending.delete(r); }
    }

}


type DownloadProgress = { total: number, downloaded: number };



export  { IcoqPod, DownloadProgress }
