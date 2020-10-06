import * as fs from 'fs';
import { Feeder } from './types';

export class BlobFeeder implements Feeder {
    private blob : Blob;
    private feed : number; // chunk reload size
    private buffer : ArrayBuffer;
    private offset : number; // file offset of current buffer
    private cursor : number; // current offset within buffer
    private reload() : Promise<void> {
        return(
            this.blob.slice(
                this.offset + this.cursor,
                Math.min(this.offset + this.cursor + this.feed, this.blob.size)
            ).arrayBuffer().then(
                chunk => {
                    this.buffer = chunk;
                    this.offset = this.offset + this.cursor;
                    this.cursor = 0;
                }
            )
        )
    }
    private read(size : number) : Promise<ArrayBuffer> {
        if (this.cursor + size > this.buffer.byteLength){
            throw new Error(
                'Unexpected End of File'
            );
        }
        this.cursor += size;
        return(
            Promise.resolve(this.buffer.slice(
                this.cursor - size,
                this.cursor
            ))
        );
    }
    constructor(blob : Blob, feed : number = 1000) {
        this.blob = blob;
        this.feed = feed;
        this.offset = 0;
    }
    public jump(position : number) : Promise<void> {
        if (position < 0 || position > this.blob.size){
            throw new Error(
                'Jump to out-of-bounds position'
            )
        }
        return(
            this.blob.slice(
                position,
                Math.min(this.feed, this.blob.size)
            ).arrayBuffer().then(
                chunk => {
                    this.buffer = chunk;
                    this.offset = position;
                    this.cursor = 0;
                }
            )
        )
    }
    public next(size : number) : Promise<ArrayBuffer> {
        if (!this.buffer || this.cursor + size > this.buffer.byteLength){
            return(
                this.reload().then(() => this.read(size))
            );
        } else {
            return(this.read(size));
        }
    }
    public position() : number {
        return(this.offset + this.cursor);
    }
    public done() : boolean {
        return(this.offset + this.cursor === this.blob.size);
    }
}

export class BuffFeeder implements Feeder {
    private buffer : ArrayBuffer;
    private cursor : number;
    constructor(buffer : ArrayBuffer) {
        this.buffer = buffer;
        this.cursor = 0;
    }
    public jump(position : number) : Promise<void> {
        if (position < 0 || position > this.buffer.byteLength){
            throw new Error(
                'Jump to out-of-bounds position'
            )
        }
        this.cursor = position;
        return(Promise.resolve());
    }
    public next(size : number) : Promise<ArrayBuffer> {
        if (!this.buffer || this.cursor + size > this.buffer.byteLength){
            throw new Error(
                'Unexpected End of File'
            );
        } else {
            this.cursor += size;
            return(
                Promise.resolve(this.buffer.slice(
                    this.cursor - size,
                    this.cursor
                ))
            );
        }
    }
    public position() : number {
        return(this.cursor);
    }
    public done() : boolean {
        return(this.cursor === this.buffer.byteLength);
    }
}

export class FileFeeder implements Feeder {
    private connection : number;
    private cursor : number;
    private size : number;
    constructor(path : string) {
        this.connection = fs.openSync(path, 'r');
        this.size = fs.statSync(path).size;
        this.cursor = 0;
    }
    public jump(position : number) : Promise<void> {
        if (position < 0 || position > this.size){
            throw new Error(
                'Jump to out-of-bounds position'
            )
        }
        this.cursor = position;
        return(Promise.resolve());
    }
    public next(size : number) : Promise<ArrayBuffer> {
        const buffer = Buffer.alloc(size);
        return(new Promise((resolve, reject) => {
            fs.read(
                this.connection,
                buffer,
                0,
                size,
                this.cursor,
                (error, bytes) => {
                    if (error){
                        reject(error)
                    } else {
                        this.cursor += bytes;
                        resolve(buffer.buffer);
                    }
                }
            )
        }));
    }
    public position() : number {
        return(this.cursor);
    }
    public done() : boolean {
        return(this.cursor === this.size);
    }
}