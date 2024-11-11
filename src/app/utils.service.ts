import { Injectable, signal } from '@angular/core';
import * as gIF from './gIF';

@Injectable({
    providedIn: 'root',
})
export class UtilsService {

    msgLogs = signal<gIF.msgLogs_t[]>([]);

    constructor() {
        // ---
    }

    public secToTime(sec: number) {
        const hours = (Math.floor(sec / 3600)).toString(10).padStart(2, '0');
        sec %= 3600;
        const minutes = (Math.floor(sec / 60)).toString(10).padStart(2, '0');
        const seconds = (sec % 60).toString(10).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    public timeStamp() {
        const now = new Date();
        const hours = now.getHours().toString(10).padStart(2, '0');
        const minutes = now.getMinutes().toString(10).padStart(2, '0');
        const seconds = now.getSeconds().toString(10).padStart(2, '0');
        return `<${hours}:${minutes}:${seconds}>`;
    }

    public sendMsg(msg: string, color: string = 'black', id: number = 1000){
        const log = `${this.timeStamp()} ${msg}`;
        console.log(log);
        const msgLog: gIF.msgLogs_t = {
            text: log,
            color: color,
            id: id
        };
        const logs  = [...this.msgLogs()];
        const last_idx = logs.length - 1;
        const last = logs.slice(-1)[0];
        if(logs.length && (last.id === id) && (id === 7)){
            logs[last_idx] = msgLog;
        }
        else {
            while(logs.length >= 20) {
                logs.shift();
            }
            logs.push(msgLog);
        }
        this.msgLogs.set(logs);
    }
}
