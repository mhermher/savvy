import { Display, Factor, Header, Internal, Meta, Parsed, Row, Schema } from './types';

export class Feeder {
    private buffer : ArrayBuffer;
    private cursor : number;
    constructor(buffer : ArrayBuffer) {
        this.buffer = buffer;
        this.cursor = 0;
    }
    public jump(position : number) : void {
        if (position < 0 || position > this.buffer.byteLength){
            throw new Error(
                'Jump to out-of-bounds position'
            )
        }
        this.cursor = position;
    }
    public next(size : number) : ArrayBuffer {
        if (!this.buffer || this.cursor + size > this.buffer.byteLength){
            throw new Error(
                'Unexpected End of File'
            );
        } else {
            this.cursor += size;
            return(
                this.buffer.slice(
                    this.cursor - size,
                    this.cursor
                )
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

class Instructor {
    private feeder : Feeder;
    private instructions : DataView;
    private cursor : number;
    private bias : number;
    private decoder : TextDecoder;
    constructor(feeder : Feeder, bias : number) {
        this.feeder = feeder;
        this.bias = bias;
        this.cursor = 8;
        this.decoder = new TextDecoder();
    }
    private instruct() : number {
        if (this.cursor > 7){
            this.instructions = new DataView(this.feeder.next(8));
            this.cursor = 0;
        }
        let instruction : number;
        do {
            instruction = this.instructions.getUint8(this.cursor++);
        } while (instruction === 0);
        return(instruction);
    }
    public nextNumber() : number {
        const code = this.instruct();
        switch(code){
            case 252: throw new Error('Unexpected end of records.');
            case 253: return(new DataView(this.feeder.next(8)).getFloat64(0, true));
            case 254: throw new Error('Cell code type mismatch');
            case 255: return(null);
            default: return(code - this.bias);
        }
    }
    public nextString() : string {
        const code = this.instruct();
        switch(code){
            case 252: throw new Error('Unexpected end of records.');
            case 253: return(this.decoder.decode(this.feeder.next(8)));
            case 254: return('');
            case 255: return(null);
            default: throw new Error('Default code not supported for strings.')
        }
    }
}

export class FileReader {
    private decoder : TextDecoder;
    private log : Array<string>;
    private readFieldDesc(feeder : Feeder) : string {
        let length = new DataView(feeder.next(4)).getInt32(0, true);
        if (length % 4){
            length = length + (4 - (length % 4));
        }
        return(this.decoder.decode(feeder.next(length)).trim());
    }
    private readFieldMissingCodes(view : DataView, count : number) : Array<number> {
        const readArray = new Array(count).fill(0);
        return(
            readArray.map((_, idx) => view.getFloat64(8 * idx))
        );
    }
    private readFieldMissingStrings(chunk : ArrayBuffer, count : number) : Array<string> {
        const readArray = new Array(count).fill(0);
        return(
            readArray.map((_, idx) => this.decoder.decode(
                chunk.slice(8 * idx, 8 * idx + 8)
            ))
        );
    }
    private readFieldMissingRange(view : DataView) : [number, number] {
        return([
            view.getFloat64(0, true),
            view.getFloat64(8, true)
        ]);
    }
    private readFieldMissing(feeder : Feeder, numeric : boolean, code : number) : Header['missing'] {
        const chunk = feeder.next(8 * Math.abs(code));
        const view = new DataView(chunk);
        return({
            codes : (numeric && code > 0
                ? this.readFieldMissingCodes(view, code)
                : (numeric && code === -3
                    ? this.readFieldMissingCodes(view, 3).slice(2)
                    : []
                )
            ),
            range : (numeric && code < 0
                ? this.readFieldMissingRange(view)
                : [undefined, undefined]
            ),
            strings : (!numeric && code > 0
                ? this.readFieldMissingStrings(chunk, code)
                : []
            )
        })
    }
    private readField(feeder : Feeder) : Header {
        this.log.push('Reading Field at ' + feeder.position());
        const start = feeder.position();
        const chunk = feeder.next(28);
        const view = new DataView(chunk);
        const code = view.getInt32(0, true);
        const labeled = view.getInt32(4, true);
        const missings = view.getInt32(8, true);
        const name = this.decoder.decode(chunk.slice(20, 28));
        const description = (labeled
            ? this.readFieldDesc(feeder)
            : ''
        );
        const missing = (missings
            ? this.readFieldMissing(feeder, code === 0, missings)
            : {
                codes : [],
                range : [undefined, undefined] as [number, number],
                strings : []
            }
        );
        return({
            start : start,
            code : code,
            name : name,
            description : description,
            missing : missing
        });
    }
    private getLevel(feeder : Feeder) : [number, string] {
        this.log.push('Factor level at ' + feeder.position());
        const view = new DataView(feeder.next(9));
        const length = view.getInt8(8);
        const size = ((length + 1) % 8
            ? length + (8 - ((length + 1) % 8))
            : length
        );
        return([
            view.getFloat64(0, true),
            this.decoder.decode(feeder.next(size)).substring(0, length)
        ]);
    }
    private readFactor(feeder : Feeder) : Factor {
        this.log.push('Factor definition at ' + feeder.position());
        const count = (new DataView(feeder.next(4))).getInt32(0, true);
        const readArray = new Array(count).fill(0);
        const levels = new Map(readArray.map(() => this.getLevel(feeder)));
        const view = new DataView(feeder.next(8));
        const magic = view.getInt32(0, true);
        const icount = view.getInt32(4, true);
        if (magic !== 4){
            throw new Error(
                'Labels read error. ' +
                'Magic value Expected: 4 ' +
                'Actual: ' + magic
            )
        }
        const iview = new DataView(feeder.next(4 * icount));
        const indices = new Set((new Array(icount).fill(0)).map(
            (_, idx) => iview.getInt32(idx * 4, true)
        ));
        return({
            map : levels,
            indices : indices
        });
    }
    private readDocument(feeder : Feeder) : Array<string> {
        this.log.push('Sys Document at ' + feeder.position());
        const count = new DataView(feeder.next(4)).getInt32(0, true);
        const chunk = feeder.next(count * 80);
        const docArray = new Array(count).fill(0);
        return(
            docArray.map(
                (_, idx) => this.decoder.decode(
                    chunk.slice(idx * 80, idx * 80 + 80)
                )
            )
        );
    }
    private readSysInteger(feeder : Feeder) : Internal['integer'] {
        this.log.push('Sys Integer at ' + feeder.position());
        const view = new DataView(feeder.next(32));
        return({
            major : view.getInt32(0, true),
            minor : view.getInt32(4, true),
            revision : view.getInt32(8, true),
            machine : view.getInt32(12, true),
            float : view.getInt32(16, true),
            compression : view.getInt32(20, true),
            endianness : view.getInt32(24, true),
            character : view.getInt32(28, true)
        });
    }
    private readSysFloat(feeder : Feeder) : Internal['float'] {
        this.log.push('Sys Float at ' + feeder.position());
        const view = new DataView(feeder.next(24));
        return({
            missing : view.getFloat64(0, true),
            high : view.getFloat64(8, true),
            low : view.getFloat64(16, true)
        });
    }
    private readSysDisplay(feeder : Feeder, count : number) : Array<Display> {
        this.log.push('Sys Display at ' + feeder.position());
        const view = new DataView(feeder.next(count * 12));
        const dispArray = new Array(count).fill(0);
        return(
            dispArray.map(
                (_, idx) => ({
                    type : view.getInt32(idx * 12, true) as 1 | 2 | 3,
                    width : view.getInt32(idx * 12 + 4, true),
                    align : view.getInt32(idx * 12 + 8, true) as 0 | 1 | 2
                })
            )
        );
    }
    private readLabels(feeder : Feeder, size : number) : Map<string, string> {
        this.log.push('Labels at ' + feeder.position());
        const raw = this.decoder.decode(feeder.next(size));
        return(
            new Map(
                raw.split('\t').map(
                    str => str.split('=') as [string, string]
                )
            )
        );
    }
    private readLongWidths(feeder : Feeder, size : number) : Map<string, number> {
        this.log.push('Long Widths at ' + feeder.position());
        const raw = this.decoder.decode(feeder.next(size));
        const rows = raw.split('\t');
        return(
            new Map(
                rows.slice(0, rows.length - 1).map(
                    str => str.split('=') as [string, string]
                ).map(
                    ([name, length]) => [name, parseInt(length, 10)]
                )
            )
        );
    }
    private readLongLabels(feeder : Feeder, size : number) : ArrayBuffer {
        this.log.push('Long Labels at ' + feeder.position());
        // need to figure out how this works
        return(feeder.next(size));
    }
    private readUnrecognized(feeder : Feeder, count : number, length : number) : Array<ArrayBuffer> {
        const chunk = feeder.next(count * length);
        const readArray = (new Array(count)).fill(0);
        return(
            readArray.map((_, idx) => chunk.slice(idx * length, idx * length + length))
        );
    }
    private readInternal(feeder : Feeder) : Internal {
        this.log.push('Reading Internal');
        const partial : Partial<Internal> = {};
        let code : number;
        let subcode : number;
        let subview : DataView;
        let length : number;
        let count : number;
        while(!partial.finished){
            code = (new DataView(feeder.next(4))).getInt32(0, true);
            switch(code){
                case 3:
                    partial.factors = (partial.factors ?? []).concat(
                        this.readFactor(feeder)
                    );
                    break;
                case 6:
                    partial.documents = (partial.documents ?? []).concat(
                        this.readDocument(feeder)
                    );
                    break;
                case 7:
                    subview = new DataView(feeder.next(12));
                    subcode = subview.getInt32(0, true);
                    length = subview.getInt32(4, true);
                    count = subview.getInt32(8, true);
                    switch(subcode){
                        case 3:
                            this.log.push('Subcode 3');
                            if (length * count !== 32){
                                throw new Error(
                                    'Special code 3 ' +
                                    'Expected: 32 bytes; ' +
                                    'Actual: ' + (length * count)
                                )
                            }
                            partial.integer = this.readSysInteger(feeder);
                            break;
                        case 4:
                            this.log.push('Subcode 4');
                            if (length * count !== 24){
                                throw new Error(
                                    'Special code 4 ' +
                                    'Expected: 24 bytes; ' +
                                    'Actual: ' + (length * count)
                                )
                            }
                            partial.float = this.readSysFloat(feeder);
                            break;
                        case 11:
                            this.log.push('Subcode 11');
                            if (length !== 4) {
                                throw new Error(
                                    'Special code 11 ' +
                                    'Expected: 4 bytes; ' +
                                    'Actual: ' + length
                                )
                            }
                            if (count % 3) {
                                throw new Error(
                                    'Special code 11 ' +
                                    'Expected: Length factor of 3; ' +
                                    'Actual: ' + length
                                )
                            }
                            partial.display = (partial.display ?? []).concat(
                                this.readSysDisplay(feeder, count / 3)
                            );
                            break;
                        case 13:
                            this.log.push('Subcode 13');
                            partial.labels = new Map([
                                ...(partial.labels ?? []),
                                ...this.readLabels(feeder, count * length)
                            ]);
                            break;
                        case 14:
                            this.log.push('Subcode 14');
                            partial.longs = new Map([
                                ...(partial.longs ?? []),
                                ...this.readLongWidths(feeder, count * length)
                            ]);
                            break;
                        case 21:
                            this.log.push('Subcode 21');
                            partial.extra = (partial.extra ?? []).concat(
                                this.readLongLabels(feeder, count * length)
                            );
                            break;
                        default:
                            this.log.push('Unrecognized Subcode');
                            partial.unrecognized = (partial.unrecognized ?? []).concat(
                                [[code, this.readUnrecognized(feeder, count, length)]]
                            );
                            break;
                    }
                    break;
                case 999:
                    feeder.next(4);
                    partial.finished = feeder.position();
                    break;
                default:
                    throw new Error(
                        'Internal Code Expected : [3, 6, 7, 999]; Actual : ' +
                        code
                    );
            }
        }
        return({
            float : partial.float ?? {
                missing : undefined,
                high : undefined,
                low : undefined
            },
            integer : partial.integer ?? {
                major : undefined,
                minor : undefined,
                revision : undefined,
                machine : undefined,
                float : undefined,
                compression : undefined,
                endianness : undefined,
                character : undefined
            },
            display : partial.display ?? [],
            documents : partial.documents ?? [],
            labels : partial.labels ?? new Map(),
            longs : partial.longs ?? new Map(),
            factors : partial.factors ?? [],
            extra : partial.extra ?? [],
            unrecognized : partial.unrecognized ?? [],
            finished : partial.finished
        });
    }
    private readFields(feeder : Feeder) : Array<Header> {
        this.log.push('Reading Field at ' + feeder.position());
        let code : number;
        const fields : Array<Header> = [];
        let field : Header;
        while(true){
            code = (new DataView(feeder.next(4))).getInt32(0, true);
            if (code !== 2){
                feeder.jump(feeder.position() - 4);
                break;
            }
            field = this.readField(feeder);
            if (field.code > -1){
                fields.push(field);
            }
        }
        return(fields);
    }
    private readCells(instructor : Instructor, header : Header) : number | string {
        if (header.code){
            return(instructor.nextString());
        } else {
            return(instructor.nextNumber());
        }
    }
    private readRow(instructor : Instructor, schema : Schema) : Row {
        return(
            new Map(
                schema.headers.map(header => [
                    header.name,
                    this.readCells(instructor, header)
                ])
            )
        );
    }
    private readData(chunker : Feeder, schema : Schema) : Promise<Array<Row>> {
        return(
            new Promise<Array<Row>>((resolve, reject) => {
                const readArray = new Array(schema.meta.cases).fill(0);
                const instructor = new Instructor(chunker, schema.meta.bias);
                resolve(
                    readArray.map(
                        () => this.readRow(instructor, schema)
                    )
                )
            })
        );
    }
    constructor(log : Array<string> = []) {
        this.decoder = new TextDecoder();
        this.log = log;
    }
    public meta(feeder : Feeder) : Promise<Meta> {
        this.log.splice(0, this.log.length);
        const position = feeder.position();
        feeder.jump(0);
        return(
            new Promise<Meta>((resolve, reject) => {
                const chunk = feeder.next(176);
                const view = new DataView(chunk);
                const magic = this.decoder.decode(chunk.slice(0, 4));
                if (magic !== '$FL2'){
                    reject(new Error(
                        'File is not a sav. ' +
                        'Magic key Expected: "$FL2"; ' +
                        'Actual: ' + magic
                    ))
                }
                resolve({
                    product : this.decoder.decode(chunk.slice(4, 64)).trim(),
                    layout : view.getInt32(64, true),
                    variables : view.getInt32(68, true),
                    compression : view.getInt32(72, true),
                    weightIndex : view.getInt32(76, true),
                    cases : view.getInt32(80, true),
                    bias : view.getFloat64(84, true),
                    createdDate : this.decoder.decode(chunk.slice(92, 101)),
                    createdTime : this.decoder.decode(chunk.slice(101, 109)),
                    label : this.decoder.decode(chunk.slice(109, 173)).trim()
                })
            }).finally(() => feeder.jump(position))
        )
    }
    public headers(feeder : Feeder) : Promise<Array<Header>> {
        this.log.splice(0, this.log.length);
        const position = feeder.position();
        feeder.jump(176);
        return(
            Promise.resolve(
                this.readFields(feeder)
            ).finally(() => feeder.jump(position))
        );
    }
    public schema(feeder : Feeder) : Promise<Schema> {
        this.log.splice(0, this.log.length);
        const position = feeder.position();
        return(
            this.meta(feeder).then(
                meta => ({
                    meta : meta
                })
            ).then(
                partial => {
                    feeder.jump(176);
                    return({
                        ...partial,
                        headers : this.readFields(feeder)
                    })
                }
            ).then(
                partial => ({
                    ...partial,
                    internal : this.readInternal(feeder)
                })
            ).finally(() => feeder.jump(position))
        );
    }
    public all(feeder : Feeder) : Promise<Parsed> {
        this.log.splice(0, this.log.length);
        const position = feeder.position();
        return(
            this.schema(feeder).then(
                schema => this.readData(feeder, schema).then(
                    rows => ({
                        ...schema,
                        rows : rows
                    })
                )
            ).finally(() => feeder.jump(position))
        );
    }
}