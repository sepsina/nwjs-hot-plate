
export enum eRxState {
    E_STATE_RX_WAIT_START,
    E_STATE_RX_WAIT_TYPELSB,
    E_STATE_RX_WAIT_TYPEMSB,
    E_STATE_RX_WAIT_LENLSB,
    E_STATE_RX_WAIT_LENMSB,
    E_STATE_RX_WAIT_CRC,
    E_STATE_RX_WAIT_DATA,
}

export interface spCmd_t {
    type: number;
    retryCnt: number;
    param:string;
}

export interface tsSet_t {
    runFlag: number;
    tcTemp: number;
    setPoint: number;
    hist: number;
    duty: number;
}

export interface setSSR_t {
    duty: number;
}

export interface tempRsp_t {
    rtd_adc: number;
}

export interface rdKeys_t {
    status: number;
    nwkKey: string;
    panId: number;
    nwkCh: number;
}

export interface slMsg_t {
    type: number;
    data: number[];
}

export interface msgLogs_t {
    text: string;
    color: string;
    id: number;
}

export interface slMsg_t {
    type: number;
    msg: Uint8Array;
}

export class rwBuf_t {

    rdIdx = 0;
    wrIdx = 0;

    rdBuf!: DataView;
    wrBuf!: DataView;

    constructor(){

    }

    read_uint8(){
        const val = this.rdBuf.getUint8(this.rdIdx);
        this.rdIdx += 1;
        return val;
    }

    read_uint16_LE(){
        const val = this.rdBuf.getUint16(this.rdIdx, true);
        this.rdIdx += 2;
        return val;
    }

    read_uint32_LE(){
        const val = this.rdBuf.getUint32(this.rdIdx, true);
        this.rdIdx += 4;
        return val;
    }

    read_double_LE(){
        const val = this.rdBuf.getBigUint64(this.rdIdx, true);
        this.rdIdx += 8;
        return val;
    }

    write_uint8(val: number){
        this.wrBuf.setUint8(this.wrIdx, val);
        this.wrIdx += 1;
    }

    modify_uint8(val: number, idx: number){
        this.wrBuf.setUint8(idx, val);
    }

    write_uint16_LE(val: number){
        this.wrBuf.setUint16(this.wrIdx, val, true);
        this.wrIdx += 2;
    }

    write_int16_LE(val: number){
        this.wrBuf.setInt16(this.wrIdx, val, true);
        this.wrIdx += 2;
    }

    modify_uint16_LE(val: number, idx: number){
        this.wrBuf.setUint16(idx, val, true);

    }

    write_uint32_LE(val: number){
        this.wrBuf.setUint32(this.wrIdx, val, true);
        this.wrIdx += 4;
    }

    write_double_LE(val: bigint){
        this.wrBuf.setBigUint64(this.wrIdx, val, true);
        this.wrIdx += 8;
    }
}
