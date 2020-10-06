import { Feeder } from './types';

interface Meta {
    magic : string,
    product : string,
    layout : number,
    variables : number,
    compression : number,
    weightIndex : number,
    cases : number,
    bias : number,
    createdDate : string,
    createdTime : string,
    label : string
}

interface Header {
    start : number,
    end : number,
    typeCode : number,
    printCode : number,
    writeCode : number,
    name : string,
    description : string,
    missing : {
        codes : Array<number>,
        strings : Array<string>,
        range : [number, number]
    }
}

interface Factor {
    map : Map<number, string>,
    indices : Set<number>
}

interface Display {
    type : 1 | 2 | 3,
    width : number,
    align : 0 | 1 | 2
}

interface Internal {
    float : {
        missing : number,
        high : number,
        low : number
    },
    integer : {
        major : number,
        minor : number,
        revision : number,
        machine : number,
        float : number,
        compression : number,
        endianness : number,
        character : number
    },
    display : Array<Display>,
    documents : Array<Array<string>>,
    labels : Map<string, string>,
    widths : Map<string, number>,
    factors : Array<Factor>,
    finished : number
}

interface Schema {
    meta : Meta,
    headers : Array<Header>,
    internal : Internal
}

export interface DataSet {
    n : number,
    fields : Array<string>,
    row(index : number) : {[key : string] : string | number | boolean},
    rows(indices : Array<number>) : DataSet,
    col(name : string) : Array<number> | Array<string> | Array<boolean>,
    cols(names : Array<string>) : DataSet
}

export class FileReader {
    private decoder : TextDecoder;
    private log : Array<string>;
    private readFieldDesc(chunker : Feeder) : Promise<string> {
        return(
            chunker.next(4).then(chunk => {
                const length = new DataView(chunk).getInt32(0, true);
                if (length % 4){
                    return(length + (4 - (length % 4)));
                } else {
                    return(length);
                }
            }).then(
                length => chunker.next(length)
            ).then(
                chunk => this.decoder.decode(chunk).trim()
            )
        )
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
    private readFieldMissing(chunker : Feeder, numeric : boolean, code : number) : Promise<Header['missing']> {
        return(
            chunker.next(8 * Math.abs(code)).then(chunk => {
                const dview = new DataView(chunk);
                return({
                    codes : (numeric && code > 0
                        ? this.readFieldMissingCodes(dview, code)
                        : (numeric && code === -3
                            ? this.readFieldMissingCodes(dview, 3).slice(2)
                            : []
                        )
                    ),
                    range : (numeric && code < 0
                        ? this.readFieldMissingRange(dview)
                        : [undefined, undefined]
                    ),
                    strings : (!numeric && code > 0
                        ? this.readFieldMissingStrings(chunk, code)
                        : []
                    )
                })
            })
        )
    }
    private readField(chunker : Feeder) : Promise<Header> {
        this.log.push('Reading Field at ' + chunker.position());
        const start = chunker.position();
        return(
            chunker.next(28).then(
                chunk => {
                    const dview = new DataView(chunk);
                    return({
                        typeCode : dview.getInt32(0, true),
                        labeled : dview.getInt32(4,  true),
                        missings : dview.getInt32(8, true),
                        printCode : dview.getInt32(12, true),
                        writeCode : dview.getInt32(16, true),
                        name : this.decoder.decode(chunk.slice(20, 28)).trim()
                    })
                }
            ).then(
                partial => {
                    if (partial.labeled) {
                        return(
                            this.readFieldDesc(chunker).then(
                                description => ({
                                    ...partial,
                                    description : description
                                })
                            )
                        )
                    } else {
                        return({...partial, description : ''})
                    }
                }
            ).then(
                partial => {
                    if (partial.missings){
                        return(
                            this.readFieldMissing(
                                chunker,
                                partial.typeCode === 0,
                                partial.missings
                            ).then(
                                missing => ({
                                    ...partial,
                                    missing : missing
                                })
                            )
                        )
                    } else {
                        return({
                            ...partial,
                            missing : {
                                codes : [],
                                range : [undefined, undefined] as [number, number],
                                strings : []
                            }
                        })
                    }
                }
            ).then(
                partial => ({
                    start : start,
                    end : chunker.position(),
                    typeCode : partial.typeCode,
                    printCode : partial.printCode,
                    writeCode : partial.writeCode,
                    name : partial.name,
                    description : partial.description,
                    missing : partial.missing
                })
            )
        )
    }
    private recurseLevel(chunker : Feeder, count : number) : Promise<Array<[number, string]>> {
        this.log.push('Factor level at ' + chunker.position());
        if (count){
            return(
                chunker.next(9).then(chunk => {
                    const dview = new DataView(chunk);
                    const length = dview.getInt8(8);
                    return({
                        level : dview.getFloat64(0, true),
                        length : length,
                        read : ((length + 1) % 8
                            ? length + (8 - ((length + 1) % 8))
                            : length
                        )
                    });
                }).then(
                    parsed => chunker.next(parsed.read).then(chunk => [
                        parsed.level,
                        this.decoder.decode(chunk.slice(0, parsed.length))
                    ] as [number, string])
                ).then(
                    level => this.recurseLevel(chunker, count - 1).then(
                        result => [level].concat(result)
                    )
                )
            );
        } else {
            return(Promise.resolve([]))
        }
    }
    private readFactor(chunker : Feeder) : Promise<Factor> {
        this.log.push('Factor definition at ' + chunker.position());
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk)).getInt32(0, true)
            ).then(
                count => this.recurseLevel(chunker, count)
            ).then(
                levels => new Map(levels)
            ).then(
                map => chunker.next(8).then(
                    chunk => {
                        const dview = new DataView(chunk);
                        const magic = dview.getInt32(0, true);
                        const count = dview.getInt32(4, true);
                        if (magic !== 4){
                            throw new Error(
                                'Labels read error. ' +
                                'Magic value Expected: 4 ' +
                                'Actual: ' + magic
                            )
                        }
                        return(count);
                    }
                ).then(
                    count => chunker.next(count * 4)
                ).then(
                    chunk => {
                        const dview = new DataView(chunk);
                        const indices = new Array(chunk.byteLength / 4).fill(0).map(
                            (_, idx) => dview.getInt32(idx * 4, true)
                        );
                        return(indices)
                    }
                ).then(
                    indices => ({
                        map : map,
                        indices : new Set(indices)
                    })
                )
            )
        )
    }
    private readDocument(chunker : Feeder) : Promise<Array<string>> {
        this.log.push('Sys Document at ' + chunker.position());
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk)).getInt32(0, true)
            ).then(
                count => chunker.next(count * 80)
            ).then(
                chunk => {
                    const docArray = new Array(chunk.byteLength / 80).fill(0);
                    return(
                        docArray.map((_, idx) => this.decoder.decode(
                            chunk.slice(idx * 80, idx * 80 + 80)
                        ))
                    )
                }
            )
        )
    }
    private readSysInteger(chunker : Feeder) : Promise<Internal['integer']> {
        this.log.push('Sys Integer at ' + chunker.position());
        return(
            chunker.next(32).then(chunk => {
                const dview = new DataView(chunk);
                return({
                    major : dview.getInt32(0, true),
                    minor : dview.getInt32(4, true),
                    revision : dview.getInt32(8, true),
                    machine : dview.getInt32(12, true),
                    float : dview.getInt32(16, true),
                    compression : dview.getInt32(20, true),
                    endianness : dview.getInt32(24, true),
                    character : dview.getInt32(28, true)
                })
            })
        )
    }
    private readSysFloat(chunker : Feeder) : Promise<Internal['float']> {
        this.log.push('Sys Float at ' + chunker.position());
        return(
            chunker.next(24).then(chunk => {
                const dview = new DataView(chunk);
                return({
                    missing : dview.getFloat64(0, true),
                    high : dview.getFloat64(8, true),
                    low : dview.getFloat64(16, true)
                })
            })
        )
    }
    private readSysDisplay(chunker : Feeder, count : number) : Promise<Array<Display>> {
        this.log.push('Sys Display at ' + chunker.position());
        return(
            chunker.next(count * 12).then(chunk => {
                const dview = new DataView(chunk);
                const dispArray = new Array(count).fill(0);
                return(
                    dispArray.map((_, idx) => ({
                        type : dview.getInt32(idx * 12, true) as 1 | 2 | 3,
                        width : dview.getInt32(idx * 12 + 4, true),
                        align : dview.getInt32(idx * 12 + 8, true) as 0 | 1 | 2
                    }))
                )
            })
        )
    }
    private readLabels(chunker : Feeder, size : number) : Promise<Map<string, string>> {
        this.log.push('Labels at ' + chunker.position());
        return(
            chunker.next(size).then(chunk => {
                const raw = this.decoder.decode(chunk);
                return(
                    new Map(
                        raw.split('\t').map(
                            str => str.split('=') as [string, string]
                        )
                    )
                )
            })
        )
    }
    private readLongWidths(chunker : Feeder, size : number) : Promise<Map<string, number>> {
        this.log.push('Long Widths at ' + chunker.position());
        return(
            chunker.next(size).then(chunk => {
                const raw = this.decoder.decode(chunk);
                const rows = raw.split('\t');
                return(
                    new Map(
                        rows.slice(0, rows.length - 1).map(
                            str => str.split('=') as [string, string]
                        ).map(
                            ([name, length]) => [name, parseInt(length, 10)]
                        )
                    )
                )
            })
        )
    }
    private readLongLabels(chunker : Feeder, size : number) : Promise<void> {
        this.log.push('Long Labels at ' + chunker.position());
        // need to figure out how this works
        return(
            chunker.next(size).then(() => Promise.resolve())
        )
    }
    private readSpecial(chunker : Feeder) : Promise<Partial<Internal>> {
        this.log.push('Special Code at ' + chunker.position())
        return(
            chunker.next(12).then(
                chunk => {
                    const dview = new DataView(chunk);
                    const code = dview.getInt32(0, true);
                    const length = dview.getInt32(4, true);
                    const count = dview.getInt32(8, true);
                    switch(code){
                        case 3:
                            this.log.push('Subcode 3');
                            if (length * count !== 32){
                                throw new Error(
                                    'Special code 3 ' +
                                    'Expected: 32 bytes; ' +
                                    'Actual: ' + (length * count)
                                )
                            }
                            return(
                                this.readSysInteger(chunker).then(
                                    sysInteger => ({
                                        integer : sysInteger
                                    })
                                )
                            );
                        case 4:
                            this.log.push('Subcode 4');
                            if (length * count !== 24){
                                throw new Error(
                                    'Special code 4 ' +
                                    'Expected: 24 bytes; ' +
                                    'Actual: ' + (length * count)
                                )
                            }
                            return(
                                this.readSysFloat(chunker).then(
                                    sysFloat => ({
                                        float : sysFloat
                                    })
                                )
                            );
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
                            return(
                                this.readSysDisplay(chunker, count / 3).then(
                                    sysDisplay => ({
                                        display : sysDisplay
                                    })
                                )
                            );
                        case 13:
                            this.log.push('Subcode 13');
                            return(
                                this.readLabels(chunker, count * length).then(
                                    labels => ({
                                        labels : labels
                                    })
                                )
                            );
                        case 14:
                            this.log.push('Subcode 14');
                            return(
                                this.readLongWidths(chunker, count * length).then(
                                    widths => ({
                                        widths : widths
                                    })
                                )
                            );
                        case 21:
                            this.log.push('Subcode 21');
                            return(
                                this.readLongLabels(chunker, count * length).then(
                                    () => ({})
                                )
                            )
                        default:
                            return(
                                chunker.next(count * length).then(() => ({}))
                            )
                    }
                }
            )
        )
    }
    private mergeInternal(left : Partial<Internal>, right : Partial<Internal>) : Partial<Internal> {
        return({
            ...left,
            ...right,
            display : (left.display ?? []).concat(right.display ?? []),
            documents : (left.documents ?? []).concat(right.documents ?? []),
            labels : new Map([
                ...(left.labels ?? []),
                ...(right.labels ?? [])
            ]),
            widths : new Map([
                ...(left.widths ?? []),
                ...(right.widths ?? [])
            ]),
            factors : (left.factors ?? []).concat(right.factors ?? []),
            finished : left.finished || right.finished || 0
        })
    }
    private recurseInternal(chunker : Feeder) : Promise<Partial<Internal>> {
        this.log.push('Internal setting at position:' + chunker.position());
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk).getInt32(0, true))
            ).then(
                code => {
                    this.log.push('Code:' + code);
                    switch(code){
                        case 3:
                            return(
                                this.readFactor(chunker).then(
                                    factor => ({
                                        factors : [factor]
                                    })
                                )
                            )
                        case 6:
                            return(
                                this.readDocument(chunker).then(
                                    document => ({
                                        documents : [document]
                                    })
                                )
                            )
                        case 7:
                            return(this.readSpecial(chunker));
                        case 999:
                            return(
                                chunker.next(4).then(() => ({
                                    finished : chunker.position()
                                }))
                            )
                        default:
                            throw new Error(
                                'Internal Code Expected : [3, 6, 7, 999]; Actual : ' +
                                code
                            );
                    }
                }
            ).then(
                partial => {
                    if (partial.finished){
                        return(partial)
                    } else {
                        return(
                            this.recurseInternal(chunker).then(
                                result => this.mergeInternal(partial, result)
                            )
                        )
                    }
                }
            )
        );
    }
    private readInternal(chunker : Feeder, start : number) : Promise<Internal> {
        this.log.push('Reading Internal');
        return(
            chunker.jump(start).then(
                () => this.recurseInternal(chunker).then(
                    partial => ({
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
                        widths : partial.widths ?? new Map(),
                        factors : partial.factors ?? [],
                        finished : partial.finished
                    })
                )
            )
        )
    }
    private recurseField(chunker : Feeder) : Promise<Array<Header>> {
        this.log.push('Reading Field at ' + chunker.position());
        return(
            chunker.next(4).then(chunk => {
                const magic = (new DataView(chunk)).getInt32(0, true);
                if (magic !== 2){
                    return(
                        chunker.jump(chunker.position() - 4).then(() => [])
                    )
                } else {
                    return(
                        this.readField(chunker).then(
                            header => this.recurseField(chunker).then(
                                result => [header].concat(result)
                            )
                        )
                    )
                }
            })
        )
    }
    private headerEnd(headers : Array<Header>) : number {
        return(headers[headers.length - 1].end);
    }
    constructor(log : Array<string> = []) {
        this.decoder = new TextDecoder();
        this.log = log;
    }
    public meta(chunker : Feeder) : Promise<Meta> {
        this.log.splice(0, this.log.length);
        const position = chunker.position();
        return(
            chunker.jump(0).then(
                () => chunker.next(176).then(
                    chunk => {
                        this.log.push('Parsing Meta Fields');
                        const dview = new DataView(chunk);
                        const magic = this.decoder.decode(chunk.slice(0, 4));
                        if (magic !== '$FL2'){
                            throw new Error(
                                'File is not a sav. ' +
                                'Magic key Expected: "$FL2"; ' +
                                'Actual: ' + magic
                            );
                        }
                        return({
                            magic : magic,
                            product : this.decoder.decode(chunk.slice(4, 64)).trim(),
                            layout : dview.getInt32(64, true),
                            variables : dview.getInt32(68, true),
                            compression : dview.getInt32(72, true),
                            weightIndex : dview.getInt32(76, true),
                            cases : dview.getInt32(80, true),
                            bias : dview.getFloat64(84, true),
                            createdDate : this.decoder.decode(chunk.slice(92, 101)),
                            createdTime : this.decoder.decode(chunk.slice(101, 109)),
                            label : this.decoder.decode(chunk.slice(109, 173)).trim()
                        })
                    }
                )
            ).finally(() => chunker.jump(position))
        );
    }
    public headers(chunker : Feeder) : Promise<Array<Header>> {
        this.log.splice(0, this.log.length);
        const position = chunker.position();
        return(
            chunker.jump(176).then(
                () => this.recurseField(chunker)
            ).finally(() => chunker.jump(position))
        );
    }
    public schema(chunker : Feeder) : Promise<Schema> {
        this.log.splice(0, this.log.length);
        const position = chunker.position();
        return(
            this.meta(chunker).then(
                meta => ({
                    meta : meta
                })
            ).then(
                partial => this.headers(chunker).then(
                    headers => ({
                        ...partial,
                        headers : headers
                    })
                )
            ).then(
                partial => this.readInternal(
                    chunker,
                    this.headerEnd(partial.headers)
                ).then(
                    internal => ({
                        ...partial,
                        internal : internal
                    })
                )
            ).finally(() => chunker.jump(position))
        );
    }
}

export {BlobFeeder, BuffFeeder, FileFeeder} from './feeders'