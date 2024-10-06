///<reference types="chrome"/>
//'use strict';
import { Injectable, NgZone } from '@angular/core';
import { EventsService } from './events.service';
import { GlobalsService } from './globals.service';
import { UtilsService } from './utils.service';
import * as gIF from './gIF';
import * as gConst from './gConst';

@Injectable({
    providedIn: 'root',
})
export class SerialService {

    public searchPortFlag = false;
    validPortFlag = false;
    portOpenFlag = false;
    private portIdx = 0;
    portPath = '';

    testPortTMO: any;
    findPortTMO: any;

    private crc = 0;
    private calcCRC = 0;
    private msgIdx = 0;
    private isEsc = false;

    private rxState = gIF.eRxState.E_STATE_RX_WAIT_START;

    private msgType = 0;
    private msgLen = 0;
    private seqNum = 0;

    private comFlag = false;
    private comPorts: chrome.serial.DeviceInfo[] = [];
    private connID = -1;

    rxBuf = new Uint8Array(1024);
    txBuf = new Uint8Array(1024);
    rwBuf = new gIF.rwBuf_t();

    slMsg = {} as gIF.slMsg_t;

    constructor(private events: EventsService,
                private globals: GlobalsService,
                private utils: UtilsService,
                private ngZone: NgZone) {
        setTimeout(()=>{
            this.checkCom();
        }, 8000);
        setTimeout(()=>{
            this.listComPorts();
        }, 1000);
        /*
        setInterval(()=>{
            this.readPartNum();
        }, 5000)
        */
        chrome.serial.onReceive.addListener((info)=>{
            if(info.connectionId === this.connID){
                this.slOnData(info.data);
            }
        });
        chrome.serial.onReceiveError.addListener((info: any)=>{
                this.rcvErrCB(info);
        });

        this.rwBuf.wrBuf = new DataView(this.txBuf.buffer);
    }

    /***********************************************************************************************
     * fn          checkCom
     *
     * brief
     *
     */
    async checkCom() {
        if(this.comFlag == false) {
            await this.closeComPort();
        }
        this.comFlag = false;
        setTimeout(()=>{
            this.checkCom();
        }, 8000);
    }

    /***********************************************************************************************
     * fn          closeComPort
     *
     * brief
     *
     */
    async closeComPort() {
        if(this.connID > -1){
            this.utils.sendMsg('close port', 'red');
            this.events.publish('closePort', 'close');

            const result = await this.closePortAsync(this.connID);
            if(result){
                this.connID = -1;
                this.portOpenFlag = false;
                this.validPortFlag = false;
                clearTimeout(this.findPortTMO);
                this.findPortTMO = setTimeout(() => {
                    this.findComPort();
                }, 300);
            }
        }
    }

    /***********************************************************************************************
     * fn          closePortAsync
     *
     * brief
     *
     */
    closePortAsync(id: number) {
        return new Promise((resolve)=>{
            chrome.serial.disconnect(id, (result)=>{
                resolve(result);
            });
        });
    }

    /***********************************************************************************************
     * fn          listComPorts
     *
     * brief
     *
     */
    listComPorts() {

        chrome.serial.getDevices((ports)=>{
            this.comPorts = ports;
            if(this.comPorts.length) {
                this.searchPortFlag = true;
                this.portIdx = 0;
                clearTimeout(this.findPortTMO);
                this.findPortTMO = setTimeout(()=>{
                    this.findComPort();
                }, 200);
            }
            else {
                this.searchPortFlag = false;
                setTimeout(()=>{
                    this.listComPorts();
                }, 2000);
                this.utils.sendMsg('no com ports', 'red', 7);
            }
        });
    }

    /***********************************************************************************************
     * fn          findComPort
     *
     * brief
     *
     */
    async findComPort() {

        if(this.validPortFlag === true){
            return;
        }
        if(this.searchPortFlag === false){
            setTimeout(()=>{
                this.listComPorts();
            }, 1000);
            return;
        }
        this.portPath = this.comPorts[this.portIdx].path;
        this.utils.sendMsg(`testing: ${this.portPath}`, 'blue');
        let connOpts = {
            bitrate: 115200
        };
        const connInfo: any = await this.serialConnectAsync(connOpts);
        if(connInfo){
            this.utils.sendMsg(`opened: ${this.portPath}`, 'blue');
            this.connID = connInfo.connectionId;
            this.portOpenFlag = true;
            this.testPortTMO = setTimeout(()=>{
                this.closeComPort();
            }, 2000);
            setTimeout(() => {
                this.testPortReq();
            }, 10);
        }
        else {
            this.utils.sendMsg(`err: ${chrome.runtime.lastError?.message}`, 'red');
            clearTimeout(this.findPortTMO);
            this.findPortTMO = setTimeout(() => {
                this.findComPort();
            }, 300);
        }
        this.portIdx++;
        if(this.portIdx >= this.comPorts.length) {
            this.searchPortFlag = false;
        }
    }

    /***********************************************************************************************
     * fn          serialConnectAsync
     *
     * brief
     *
     */
    serialConnectAsync(connOpt: any) {
        return new Promise((resolve)=>{
            chrome.serial.connect(this.portPath, connOpt, (connInfo)=>{
                resolve(connInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          slOnData
     *
     * brief
     *
     */
    private slOnData(msg: any) {

        let pkt = new Uint8Array(msg);

        for(let i = 0; i < pkt.length; i++) {
            let rxByte = pkt[i];
            switch(rxByte) {
                case gConst.SL_START_CHAR: {
                    this.msgIdx = 0;
                    this.isEsc = false;
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPELSB;
                    break;
                }
                case gConst.SL_ESC_CHAR: {
                    this.isEsc = true;
                    break;
                }
                case gConst.SL_END_CHAR: {
                    if(this.crc == this.calcCRC) {
                        this.slMsg.type = this.msgType;
                        this.slMsg.msg = this.rxBuf.slice(0, this.msgLen);
                        this.processMsg(this.slMsg);
                    }
                    this.rxState = gIF.eRxState.E_STATE_RX_WAIT_START;
                    break;
                }
                default: {
                    if(this.isEsc == true) {
                        rxByte ^= 0x10;
                        this.isEsc = false;
                    }
                    switch(this.rxState) {
                        case gIF.eRxState.E_STATE_RX_WAIT_START: {
                            // ---
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPELSB: {
                            this.msgType = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB;
                            this.calcCRC = rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_TYPEMSB: {
                            this.msgType += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENLSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENLSB: {
                            this.msgLen = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_LENMSB;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_LENMSB: {
                            this.msgLen += rxByte << 8;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_CRC;
                            this.calcCRC ^= rxByte;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_CRC: {
                            this.crc = rxByte;
                            this.rxState = gIF.eRxState.E_STATE_RX_WAIT_DATA;
                            break;
                        }
                        case gIF.eRxState.E_STATE_RX_WAIT_DATA: {
                            if(this.msgIdx < this.msgLen) {
                                this.rxBuf[this.msgIdx++] = rxByte;
                                this.calcCRC ^= rxByte;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          processMsg
     *
     * brief
     *
     */
    private processMsg(slMsg: gIF.slMsg_t) {

        this.comFlag = true;

        this.rwBuf.rdBuf = new DataView(slMsg.msg.buffer);
        this.rwBuf.rdIdx = 0;

        switch(slMsg.type) {
            case gConst.SL_MSG_TEST_PORT: {
                const idNum = this.rwBuf.read_uint32_LE();
                if(idNum === gConst.ID_NUM) {
                    clearTimeout(this.testPortTMO);
                    this.validPortFlag = true;
                    this.searchPortFlag = false;
                    this.utils.sendMsg('port valid', 'green');
                }
                break;
            }
            case gConst.SL_MSG_SEND_TEMP: {
                const tempRsp = {} as gIF.tempRsp_t;
                tempRsp.rtd_adc = this.rwBuf.read_uint32_LE();
                this.events.publish('newTemp', tempRsp);
                break;
            }
            case gConst.SL_MSG_LOG: {
                let log_msg = '';
                let chrCode: number
                for(let i = 0; i < slMsg.msg.byteLength; i++) {
                    chrCode = this.rwBuf.read_uint8();
                    if(chrCode != 0) {
                        log_msg += String.fromCharCode(chrCode);
                    }
                }
                this.utils.sendMsg(log_msg, 'orange');
                break;
            }
        }
    }

    /***********************************************************************************************
     * fn          testPortReq
     *
     * brief
     *
     */
    async testPortReq() {

        this.seqNum = ++this.seqNum % 256;
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_TEST_PORT);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint32_LE(gConst.ID_NUM);

        let msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }

    /*******************************************************************************************
     * fn          setSSR
     *
     * brief
     *
     */
    async setSSR(setSSR: gIF.setSSR_t) {

        if(this.validPortFlag === false){
            return;
        }
        this.rwBuf.wrIdx = 0;

        this.rwBuf.write_uint16_LE(gConst.SL_MSG_SET_SSR);
        this.rwBuf.write_uint16_LE(0); // len
        this.rwBuf.write_uint8(0);     // CRC
        // cmd data
        this.rwBuf.write_uint8(setSSR.duty);

        const msgLen = this.rwBuf.wrIdx;
        let dataLen = msgLen - gConst.HEAD_LEN;
        this.rwBuf.modify_uint16_LE(dataLen, gConst.LEN_IDX);
        let crc = 0;
        for(let i = 0; i < msgLen; i++) {
            crc ^= this.txBuf[i];
        }
        this.rwBuf.modify_uint8(crc, gConst.CRC_IDX);

        await this.serialSend(msgLen);
    }


    /***********************************************************************************************
     * fn          serialSend
     *
     * brief
     *
     */
    async serialSend(msgLen: number) {

        let slMsgBuf = new Uint8Array(128);
        let msgIdx = 0;

        slMsgBuf[msgIdx++] = gConst.SL_START_CHAR;
        for(let i = 0; i < msgLen; i++) {
            if(this.txBuf[i] < 0x10) {
                this.txBuf[i] ^= 0x10;
                slMsgBuf[msgIdx++] = gConst.SL_ESC_CHAR;
            }
            slMsgBuf[msgIdx++] = this.txBuf[i];
        }
        slMsgBuf[msgIdx++] = gConst.SL_END_CHAR;

        let slMsgLen = msgIdx;
        let slMsg = slMsgBuf.slice(0, slMsgLen);

        const sendInfo: any = await this.serialSendAsync(slMsg);
        if(sendInfo.error){
            this.utils.sendMsg(`send err: ${sendInfo.error}`, 'red');
        }
    }

    /***********************************************************************************************
     * fn          serialSendAsync
     *
     * brief
     *
     */
    serialSendAsync(slMsg: any) {
        return new Promise((resolve)=>{
            chrome.serial.send(this.connID, slMsg.buffer, (sendInfo: any)=>{
                resolve(sendInfo);
            });
        });
    }

    /***********************************************************************************************
     * fn          rcvErrCB
     *
     * brief
     *
     */
    async rcvErrCB(info: any) {
        if(info.connectionId === this.connID){
            switch(info.error){
                case 'disconnected': {
                    this.utils.sendMsg(`${this.portPath} disconnected`);
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'device_lost': {
                    this.utils.sendMsg(`${this.portPath} lost`, 'red');
                    setTimeout(()=>{
                        this.closeComPort();
                    }, 10);
                    break;
                }
                case 'system_error': {
                    break;
                }
                case 'timeout':
                case 'break':
                case 'frame_error':
                case 'overrun':
                case 'buffer_overflow':
                case 'parity_error': {
                    // ---
                    break;
                }
            }
        }
    }

}
