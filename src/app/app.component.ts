import {
    AfterViewInit,
    Component,
    ElementRef,
    HostListener,
    NgZone,
    OnInit,
    ViewChild
} from '@angular/core';

import { CommonModule } from '@angular/common';

import { SerialService } from './serial.service';
import { EventsService } from './events.service';
import { UtilsService } from './utils.service';

import Chart from 'chart.js/auto';

import * as gConst from './gConst';
import * as gIF from './gIF';

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
        CommonModule
    ],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, AfterViewInit {

    @ViewChild('cbRun') cbRunRef!: ElementRef;
    @ViewChild('sp') spRef!: ElementRef;
    @ViewChild('hist') histRef!: ElementRef;
    @ViewChild('duty') dutyRef!: ElementRef;
    @ViewChild('RTD') rtdRef!: ElementRef;

    t_rtd = '--.- degC';
    rtdTemp = 0;
    //rtdValid = true;

    lastValid: number = INVALID_TEMP;
    badCnt = 0;

    runFlag = false;
    setPoint = 27;
    prevSP = 0;
    workPoint = 0;
    ssrDuty = 10;
    hist = 0.5;
    ssrTMO: any;

    chart: any;
    chartTime: number[] = [];
    secTime: number[] = [];

    duration = '';

    trash = 0;

    constructor(
        public serial: SerialService,
        public events: EventsService,
        public utils: UtilsService,
        public ngZone: NgZone
    ) {
        // ---
    }

    /***********************************************************************************************
     * fn          ngAfterViewInit
     *
     * brief
     *
     */
    ngAfterViewInit(): void {

        this.cbRunRef.nativeElement.checked = this.runFlag;
        this.spRef.nativeElement.value = `${this.setPoint}`;
        this.histRef.nativeElement.value = `${this.hist.toFixed(1)}`;
        this.dutyRef.nativeElement.value = `${this.ssrDuty}`;
    }

    /***********************************************************************************************
     * fn          ngOnInit
     *
     * brief
     *
     */
    ngOnInit() {

        this.events.subscribe('newTemp', (msg: gIF.tempRsp_t)=>{
            this.newTemp(msg);
        });

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
    @HostListener('window:beforeunload')
    closeComms(){
        this.serial.closeComPort();
    };

    /***********************************************************************************************
     * fn          handleKeyboardEvent
     *
     * brief
     *
     */
    @HostListener('document:keyup', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent) {
        switch(event.key){
            case 'Escape': {
                console.log(`escape pressed`);

                this.runFlag = false;
                this.cbRunRef.nativeElement.checked = this.runFlag;

                this.setPoint = 27;
                this.spRef.nativeElement.value = `${this.setPoint}`;

                this.ssrDuty = 0;
                this.dutyRef.nativeElement.value = `${this.ssrDuty}`;
                break;
            }
        }
    }

    /***********************************************************************************************
     * fn          newTemp
     *
     * brief
     *
     */
    newTemp(msg: gIF.tempRsp_t){

        clearTimeout(this.ssrTMO);
        const setSSR = {} as gIF.setSSR_t;
        setSSR.duty = 0;

        const pga = 8;
        const r_ref = 1643;
        let rtd_ohm = (msg.rtd_adc / pga) * r_ref / 2**23;
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

        this.rtdRef.nativeElement.style.color = 'orange';
        setTimeout(()=>{
            this.rtdRef.nativeElement.style.color = 'black';
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
        this.duration = `${this.utils.secToTime(timeSpan)}`;

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

        this.ngZone.run(()=>{
            if(this.badCnt == 0){
                this.t_rtd = `t_rtd: ${this.rtdTemp.toFixed(1)} degC`;
            }
            else {
                this.t_rtd = `t_rtd: --.- degC`;
            }
        });
        setTimeout(() => {
            this.chart?.update('none');
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

        if(this.cbRunRef.nativeElement.checked) {
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

        let sp = parseInt(newVal);

        if(Number.isNaN(sp)){
            return;
        }
        if(sp > SP_MAX){
            sp = SP_MAX;
        }
        this.spRef.nativeElement.value = `${sp}`;
        console.log(`new sp: ${sp}`);

        this.setPoint = sp;

        this.prevSP = this.setPoint;
        this.workPoint = this.setPoint - this.hist;
    }

    /***********************************************************************************************
     * fn          spBlur
     *
     * brief
     *
     */
    spBlur(newVal: string){

        let sp = parseInt(newVal);

        if(Number.isNaN(sp)){
            this.spRef.nativeElement.value = `${this.setPoint}`;
        }
    }

    /***********************************************************************************************
     * fn          histChanged
     *
     * brief
     *
     */
    histChanged(newVal: string){

        let new_hist = parseFloat(newVal);

        if(Number.isNaN(new_hist) || (new_hist < HIST_MIN)){
            return;
        }
        if(new_hist > HIST_MAX){
            new_hist = HIST_MAX;
        }
        new_hist = Math.round(new_hist * 10) / 10;
        console.log(`new hist: ${new_hist}`);
        this.histRef.nativeElement.value = `${new_hist.toFixed(1)}`;

        this.hist = new_hist;

        if(this.workPoint > this.setPoint){
            this.workPoint = this.setPoint + this.hist;
        }
        else {
            this.workPoint = this.setPoint - this.hist;
        }

    }

    /***********************************************************************************************
     * fn          histBlur
     *
     * brief
     *
     */
    histBlur(newVal: string){

        let new_hist = parseFloat(newVal);

        if(Number.isNaN(new_hist) || (new_hist < HIST_MIN)){
            this.histRef.nativeElement.value = `${this.hist.toFixed(1)}`;
        }
    }

    /***********************************************************************************************
     * fn          dutyChanged
     *
     * brief
     *
     */
    dutyChanged(newVal: string){

        let new_duty = parseInt(newVal);

        if(Number.isNaN(new_duty) || (new_duty < DUTY_MIN)){
            return;
        }
        if(new_duty > DUTY_MAX){
            new_duty = DUTY_MAX;
        }
        console.log(`new hist: ${new_duty}`);
        this.dutyRef.nativeElement.value = `${new_duty}`;

        this.ssrDuty = new_duty;
    }

    /***********************************************************************************************
     * fn          dutyBlur
     *
     * brief
     *
     */
    dutyBlur(newVal: string){

        let new_duty = parseInt(newVal);

        if(Number.isNaN(new_duty) || (new_duty < DUTY_MIN)){
            this.dutyRef.nativeElement.value = `${this.ssrDuty}`;
        }
    }

}
