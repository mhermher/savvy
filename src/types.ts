export interface Feeder {
    jump : (position : number) => Promise<void>,
    next : (size : number) => Promise<ArrayBuffer>,
    position : () => number
}