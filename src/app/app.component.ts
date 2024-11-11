import {
    AfterViewInit,
    Component,
    ElementRef,
    effect,
    inject,
    signal,
    viewChild,
    ChangeDetectionStrategy,
} from '@angular/core';

import { CommonModule } from '@angular/common';

import { SerialService } from './serial.service';
import { UtilsService } from './utils.service';

import Chart from 'chart.js/auto';

import * as gConst from './gConst';
import * as gIF from './gIF';
import { FormsModule } from '@angular/forms';

const INVALID_TEMP = -1000;
const BAD_CNT = 5;
const CHART_LEN = 54;

const T_IDX = 0;
const SP_IDX = 1;
const REG_IDX = 2;

const SP_MAX = 250;
const DUTY_MAX = 40;
const DUTY_MIN = 0;
const HIST_MAX = 2;
const HIST_MIN = 0;

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule
    ],
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    host: {
        '(window:beforeunload)': 'closeComms()',
        '(document:keyup)': 'keyEvent($event)'
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements AfterViewInit {

    cbRunRef = viewChild.required('cbRun', {read: ElementRef});
    spRef = viewChild.required('sp_ref', {read: ElementRef});
    histRef = viewChild.required('hist_ref', {read: ElementRef});
    dutyRef = viewChild.required('duty_ref', {read: ElementRef});
    rtdRef = viewChild.required('RTD', {read: ElementRef});

    t_rtd = signal('--.- degC');
    rtdTemp = 0;

    lastValid: number = INVALID_TEMP;
    badCnt = 0;

    runFlag = false;
    s_set_point = signal('27');
    setPoint = 27;
    prevSP = 0;
    workPoint = 0;

    s_ssr_duty = signal('10');
    ssrDuty = 10;

    s_hist = signal('0.5');
    hist = 0.5;

    ssrTMO: any;

    chart: any;
    chartTime: number[] = [];
    secTime: number[] = [];

    duration = signal('');

    trash = 0;

    new_temp = effect(()=>{
        const temp = this.serial.s_new_temp();
        setTimeout(() => {
            this.newTemp(temp);
        }, 0);
    });

    serial = inject(SerialService);
    utils = inject(UtilsService);

    constructor() {
        // ---
    }

    /***********************************************************************************************
     * fn          ngAfterViewInit
     *
     * brief
     *
     */
    ngAfterViewInit(): void {

        this.cbRunRef().nativeElement.checked = this.runFlag;
        this.spRef().nativeElement.value = `${this.setPoint}`;
        this.histRef().nativeElement.value = `${this.hist.toFixed(1)}`;
        this.dutyRef().nativeElement.value = `${this.ssrDuty}`;

        this.createChart();

        this.prevSP = this.setPoint;
        this.workPoint = this.setPoint - this.hist;
        setTimeout(()=>{
            this.ssr_tmo();
        }, 1000);
    }

    /***********************************************************************************************
     * fn          closeComms
     *
     * brief
     *
     */
    closeComms(){
        this.serial.closeComPort();
    };

    /***********************************************************************************************
     * fn          handleKeyboardEvent
     *
     * brief
     *
     */
    keyEvent(event: KeyboardEvent) {

        switch(event.key){
            case 'Escape': {
                this.runFlag = false;
                this.cbRunRef().nativeElement.checked = this.runFlag;

                this.setPoint = 27;
                this.spRef().nativeElement.value = `${this.setPoint}`;

                this.ssrDuty = 0;
                this.dutyRef().nativeElement.value = `${this.ssrDuty}`;
                break;
            }
            case 'Enter': {
                this.blurInputs();
                break;
            }
            case 'r': {
                this.blurInputs();

                this.runFlag = true;
                this.cbRunRef().nativeElement.checked = this.runFlag;
            }
        }
    }

    /***********************************************************************************************
     * fn          blurInputs
     *
     * brief
     *
     */
    blurInputs() {

        const activeEl = document.activeElement;

        if(activeEl instanceof HTMLElement){
            const id = activeEl.getAttribute('id');
            switch(id){
                case 'sp':
                case 'hist':
                case 'duty': {
                    console.log(`blured: ${id}`);
                    activeEl.blur();
                }
            }
        }
    }

    /***********************************************************************************************
     * fn          newTemp
     *
     * brief
     *
     */
    newTemp(temp: gIF.tempRsp_t){

        if(Number.isNaN(temp.rtd_adc)){
            return;
        }

        clearTimeout(this.ssrTMO);
        const setSSR = {} as gIF.setSSR_t;
        setSSR.duty = 0;

        const pga = 8;
        const r_ref = 1643;
        let rtd_ohm = (temp.rtd_adc / pga) * r_ref / 2**23;
        const A = 3.9083e-3;
        const B = -5.775e-7;
        const R0 = 100;
        this.rtdTemp = (-A + (A**2 - 4 * B * (1 - rtd_ohm / R0))**0.5) / (2 * B);

        this.updateGraph();

        if(this.runFlag){
            if(this.rtdTemp > this.workPoint){
                if(this.workPoint > this.setPoint){
                    this.workPoint = this.setPoint - this.hist;
                }
            }
            if(this.rtdTemp < this.workPoint){
                if(this.workPoint < this.setPoint){
                    this.workPoint = this.setPoint + this.hist;
                }
            }
            if(this.rtdTemp < this.workPoint){
                setSSR.duty = this.ssrDuty;
            }
        }

        this.serial.setSSR(setSSR);

        this.ssrTMO = setTimeout(()=>{
            this.ssr_tmo();
        }, 2000);

        this.rtdRef().nativeElement.style.color = 'orange';
        setTimeout(()=>{
            this.rtdRef().nativeElement.style.color = 'black';
        }, 200);
    }

    /***********************************************************************************************
     * fn          ssr_tmo
     *
     * brief
     *
     */
    ssr_tmo(){

        const setSSR = {} as gIF.setSSR_t;
        setSSR.duty = 0;
        this.serial.setSSR(setSSR);

        this.ssrTMO = setTimeout(()=>{
            this.ssr_tmo();
        }, 2000);
    }

    /***********************************************************************************************
     * fn          updateGraph
     *
     * brief
     *
     */
    updateGraph(){

        while(this.chartTime.length > CHART_LEN){
            this.chartTime.shift();
            this.chart.data.labels.shift();
            this.chart.data.datasets[T_IDX].data.shift();
            this.chart.data.datasets[SP_IDX].data.shift();
        }
        const now = Math.floor(Date.now() / 1000);
        this.chartTime.push(now);
        const timeSpan = now - this.chartTime[0];
        this.duration.set(`${this.utils.secToTime(timeSpan)}`);

        if(this.lastValid === INVALID_TEMP){
            this.lastValid = this.rtdTemp;
        }
        else {
            if(Math.abs(this.rtdTemp - this.lastValid) > 10){
                this.badCnt++;
                if(this.badCnt > BAD_CNT){
                    this.lastValid = this.rtdTemp;
                    this.badCnt = 0;
                }
            }
            else {
                this.lastValid = this.rtdTemp;
                this.badCnt = 0;
            }
        }

        this.chart.data.labels.push(timeSpan);
        if(this.badCnt == 0){
            this.chart.data.datasets[T_IDX].data.push(this.rtdTemp);
        }
        else {
            this.chart.data.datasets[T_IDX].data.push(null);
        }
        this.chart.data.datasets[SP_IDX].data.push(this.setPoint);

        if(this.badCnt == 0){
            this.t_rtd.set(`t_rtd: ${this.rtdTemp.toFixed(1)} degC`);
        }
        else {
            this.t_rtd.set(`t_rtd: --.- degC`);
        }

        setTimeout(() => {
            this.chart.update('none');
        }, 0);
    }

    /***********************************************************************************************
     * fn          createChart
     *
     * brief
     *
     */
    createChart() {

        this.chart = new Chart('canvas', {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        data: [],
                        label: 'temp',
                        fill: false,
                        borderColor: 'red',
                        borderWidth: 2,
                        cubicInterpolationMode: 'monotone'
                    },
                    {
                        data: [],
                        label: 'sp',
                        fill: false,
                        borderColor: 'black',
                        borderDash: [8, 4],
                        borderWidth: 2,
                        cubicInterpolationMode: 'monotone'
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        border: {
                            color: 'lightgray'
                        },
                        grid: {
                            display: false
                        },
                        ticks: {
                            autoSkip: false,
                            display: false,
                            maxRotation: 0,
                            font: {
                                size: 14,
                            }
                        }
                    },
                    y: {
                        position: 'right',
                        border: {
                            dash: [8, 4],
                            color: 'lightgray'
                        },
                        grid: {
                            color: 'lightgray',
                            display: true,
                        },
                        ticks:{
                            font: {
                                size: 14,
                            }
                        },

                        grace: 1,
                    }
                },
                elements: {
                    point:{
                        radius: 0
                    }
                },
                animation: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    /***********************************************************************************************
     * fn          runChanged
     *
     * brief
     *
     */
    runChanged(){

        if(this.cbRunRef().nativeElement.checked) {
            this.runFlag = true;
        }
        else {
            this.runFlag = false;
        }
    }

    /***********************************************************************************************
     * fn          spChanged
     *
     * brief
     *
     */
    spChanged(newVal: string){

        this.s_set_point.set(newVal);
    }

    /***********************************************************************************************
     * fn          spBlur
     *
     * brief
     *
     */
    spBlur(){

        let sp = parseInt(this.s_set_point());

        if(Number.isNaN(sp)){
            this.s_set_point.set(`${this.setPoint}`);
            return;
        }
        if(sp > SP_MAX){
            sp = SP_MAX;
        }
        this.setPoint = sp;
        this.prevSP = sp;
        this.workPoint = sp - this.hist;

        this.s_set_point.set(`${sp}`);
    }

    /***********************************************************************************************
     * fn          histChanged
     *
     * brief
     *
     */
    histChanged(newVal: string){

        this.s_hist.set(newVal);
    }

    /***********************************************************************************************
     * fn          histBlur
     *
     * brief
     *
     */
    histBlur(){

        let new_hist = parseFloat(this.s_hist());

        if(Number.isNaN(new_hist)){
            this.s_hist.set(`${this.hist}`);
            return;
        }
        if(new_hist < HIST_MIN){
            new_hist = HIST_MIN;
        }
        if(new_hist > HIST_MAX){
            new_hist = HIST_MAX;
        }
        new_hist = Math.round(new_hist * 10) / 10;

        this.hist = new_hist;

        if(this.workPoint > this.setPoint){
            this.workPoint = this.setPoint + this.hist;
        }
        else {
            this.workPoint = this.setPoint - this.hist;
        }
        this.s_hist.set(`${new_hist.toFixed(1)}`);
    }

    /***********************************************************************************************
     * fn          dutyChanged
     *
     * brief
     *
     */
    dutyChanged(newVal: string){

        this.s_ssr_duty.set(newVal);
    }

    /***********************************************************************************************
     * fn          dutyBlur
     *
     * brief
     *
     */
    dutyBlur(){

        let new_duty = parseInt(this.s_ssr_duty());

        if(Number.isNaN(new_duty)){
            this.s_ssr_duty.set(`${this.ssrDuty}`);
            return;
        }
        if(new_duty < DUTY_MIN){
            new_duty = DUTY_MIN;
        }
        if(new_duty > DUTY_MAX){
            new_duty = DUTY_MAX;
        }
        this.ssrDuty = new_duty;

        this.s_ssr_duty.set(`${new_duty}`);
    }

}
