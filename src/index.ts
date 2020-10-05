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
    magic : number,
    typeCode : number,
    printCode : number,
    writeCode : number,
    name : string,
    description : string,
    missing : {
        codes : Array<number>,
        strings : Array<string>,
        range : Array<number>
    },
    padding : Array<{
        magic : number,
        typeCode : number
    }>
}

interface Factor {
    map : Map<number, string>,
    indices : Set<number>
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
    display : Array<number>,
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
    private readField(chunker : Feeder) : Promise<Header> {
        this.log.push('Reading Field');
        const start = chunker.position();
        return(
            chunker.next(32).then(
                chunk => {
                    const dview = new DataView(chunk);
                    const magic = dview.getFloat32(0, true);
                    if (magic !== 2){
                        throw new Error(
                            'Variable magic code Expected: 2 ' +
                            'Actual: ' + magic
                        )
                    }
                    return({
                        magic : magic,
                        typeCode : dview.getInt32(4, true),
                        labeled : dview.getInt32(8, true),
                        missings : dview.getInt32(12, true),
                        printCode : dview.getInt32(16, true),
                        writeCode : dview.getInt32(20, true),
                        name : this.decoder.decode(chunk.slice(24, 32))
                    })
                }
            ).then(
                partial => {
                    if (partial.labeled) {
                        return(
                            chunker.next(4).then(
                                chunk => {
                                    const length = new DataView(chunk).getInt32(0, true);
                                    if (length % 4){
                                        return(length + (4 - (length % 4)));
                                    } else {
                                        return(length);
                                    }
                                }
                            ).then(
                                length => chunker.next(length)
                            ).then(
                                chunk => {
                                    return({
                                        ...partial,
                                        description : this.decoder.decode(chunk)
                                    })
                                }
                            )
                        )
                    } else {
                        return({...partial, description : ''})
                    }
                }
            ).then(
                partial => chunker.next(8 * Math.abs(partial.missings)).then(
                    chunk => {
                        const dview = new DataView(chunk);
                        const readArray = new Array(Math.abs(partial.missings));
                        return({
                            ...partial,
                            missingCodes : (partial.typeCode === 0 && partial.missings > 0
                                ? readArray.map((_, idx) => dview.getFloat64(8 * idx, true))
                                : []
                            ),
                            missingRange : (partial.typeCode === 0 && partial.missings < 0
                                ? readArray.map((_, idx) => dview.getFloat64(8 * idx, true))
                                : []
                            ),
                            missingStrings : (partial.typeCode !== 0
                                ? readArray.map((_, idx) => this.decoder.decode(
                                    chunk.slice(8 * idx, 8 * idx + 8))
                                )
                                : []
                            )
                        })
                    }
                )
            ).then(
                partial => {
                    if (partial.typeCode > 8){
                        const padding = Math.ceil(partial.typeCode / 8) - 1;
                        const padArray = new Array(padding);
                        return(
                            chunker.next(28 * padding).then(
                                chunk => {
                                    const dview = new DataView(chunk);
                                    return({
                                        ...partial,
                                        padding : padArray.map((_, idx) => {
                                            return({
                                                magic : dview.getInt32(0, true),
                                                typeCode : dview.getInt32(8, true)
                                            })
                                        })
                                    })
                                }
                            )
                        )
                    } else {
                        return({
                            ...partial,
                            padding : [] as Array<{magic : number, typeCode : number}>
                        });
                    }
                }
            ).then(
                partial => ({
                    start : start,
                    magic : partial.magic,
                    typeCode : partial.typeCode,
                    printCode : partial.printCode,
                    writeCode : partial.writeCode,
                    name : partial.name,
                    description : partial.description,
                    missing : {
                        codes : partial.missingCodes,
                        strings : partial.missingStrings,
                        range : partial.missingRange
                    },
                    padding : partial.padding
                })
            )
        )
    }
    private readLevel(chunker : Feeder) : Promise<{level : number, label : string}> {
        return(
            chunker.next(9).then(
                chunk => {
                    const dview = new DataView(chunk);
                    const length = dview.getUint8(8);
                    return({
                        level : dview.getFloat64(0, true),
                        length : dview.getUint8(8),
                        read : ((length + 1) % 8
                            ? length + (8 - ((length + 1) % 8))
                            : length
                        )
                    });
                }
            ).then(
                parsed => chunker.next(parsed.read).then(
                    chunk => ({
                        level : parsed.level,
                        label : this.decoder.decode(chunk.slice(0, parsed.length))
                    })
                )
            )
        )
    }
    private readFactor(chunker : Feeder) : Promise<Factor> {
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk)).getInt32(0, true)
            ).then(
                count => {
                    const factorArray = new Array(count);
                    return(
                        factorArray.reduce(
                            (acc : Promise<Map<number, string>>) => acc.then(
                                cum => this.readLevel(chunker).then(
                                    result => {
                                        cum.set(result.level, result.label);
                                        return(cum)
                                    }
                                )
                            ),
                            Promise.resolve(new Map() as Map<number, string>)
                        ) as Promise<Map<number, string>>
                    )
                }
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
                        const indexArray = new Array(chunk.byteLength / 4);
                        return(
                            indexArray.map(
                                (_, idx) => dview.getInt32(idx * 4, true)
                            )
                        )
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
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk)).getInt32(0, true)
            ).then(
                count => chunker.next(count * 80)
            ).then(
                chunk => {
                    const docArray = new Array(chunk.byteLength / 80);
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
                    character : dview.getInt32(30, true)
                })
            })
        )
    }
    private readSysFloat(chunker : Feeder) : Promise<Internal['float']> {
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
    private readSysDisplay(chunker : Feeder, count : number) : Promise<Array<number>> {
        return(
            chunker.next(count * 4).then(chunk => {
                const dview = new DataView(chunk);
                const dispArray = new Array(count);
                return(
                    dispArray.map(
                        (_, idx) => dview.getInt32(idx * 4, true)
                    )
                )
            })
        )
    }
    private readLabels(chunker : Feeder, size : number) : Promise<Map<string, string>> {
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
        // need to figure out how this works
        return(
            chunker.next(size).then(() => Promise.resolve())
        )
    }
    private readSpecial(chunker : Feeder) : Promise<Partial<Internal>> {
        return(
            chunker.next(12).then(
                chunk => {
                    const dview = new DataView(chunk);
                    const code = dview.getInt32(0, true);
                    const length = dview.getInt32(0, true);
                    const count = dview.getInt32(0, true);
                    switch(code){
                        case 3:
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
                            if (length !== 4) {
                                throw new Error(
                                    'Special code 11 ' +
                                    'Expected: 4 bytes; ' +
                                    'Actual: ' + length
                                )
                            }
                            return(
                                this.readSysDisplay(chunker, count).then(
                                    sysDisplay => ({
                                        display : sysDisplay
                                    })
                                )
                            );
                        case 13:
                            return(
                                this.readLabels(chunker, count * length).then(
                                    labels => ({
                                        labels : labels
                                    })
                                )
                            );
                        case 14:
                            return(
                                this.readLongWidths(chunker, count * length).then(
                                    widths => ({
                                        widths : widths
                                    })
                                )
                            );
                        case 21:
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
            factors : (left.factors ?? []).concat(right.factors ?? []),
            finished : left.finished || right.finished || 0
        })
    }
    private recurseInternal(chunker : Feeder) : Promise<Partial<Internal>> {
        return(
            chunker.next(4).then(
                chunk => (new DataView(chunk).getInt32(0, true))
            ).then(
                code => {
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
    private readInternal(chunker : Feeder) : Promise<Internal> {
        return(
            this.recurseInternal(chunker).then(
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
                    widths : partial.labels ?? new Map(),
                    factors : partial.factors ?? [],
                    finished : partial.finished
                })
            )
        )
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
            chunker.jump(0).then(
                () => this.meta(chunker).then(
                    meta => {
                        this.log.push('Parsing Headers');
                        const fieldArray = new Array(meta.variables);
                        return(Promise.all(
                            fieldArray.map(() => this.readField(chunker))
                        ))
                    }
                )
            ).finally(() => chunker.jump(position))
        );
    }
    public schema(chunker : Feeder) : Promise<Schema> {
        this.log.splice(0, this.log.length);
        const position = chunker.position();
        return(
            chunker.jump(0).then(
                () => this.meta(chunker).then(
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
                    partial => this.readInternal(chunker).then(
                        internal => ({
                            ...partial,
                            internal : internal
                        })
                    )
                )
            ).finally(() => chunker.jump(position))
        );
    }
}

export {BlobFeeder, BuffFeeder, FileFeeder} from './feeders'