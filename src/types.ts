export interface Meta {
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

export interface Header {
    start : number,
    code : number,
    name : string,
    description : string,
    missing : {
        codes : Array<number>,
        strings : Array<string>,
        range : [number, number]
    }
}

export interface Factor {
    map : Map<number, string>,
    indices : Set<number>
}

export interface Display {
    type : 1 | 2 | 3,
    width : number,
    align : 0 | 1 | 2
}

export interface Internal {
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
    longs : Map<string, number>,
    factors : Array<Factor>,
    extra : Array<ArrayBuffer>,
    unrecognized : Array<[number, Array<ArrayBuffer>]>,
    finished : number
}

export interface Schema {
    meta : Meta,
    headers : Array<Header>,
    internal : Internal
}

export type Row = Map<string, string | number | boolean>;

export interface Parsed extends Schema {
    rows : Array<Row>
}