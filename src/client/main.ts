import 'zone.js';
import 'reflect-metadata';

(<any>global).jQuery = require("jquery");

import {NgModule, NgZone, Component, Inject, OnInit, enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';
import {FormsModule} from '@angular/forms';
import {BrowserModule} from '@angular/platform-browser';
import {AgGridModule} from 'ag-grid-ng2/main';
import {PopoverModule} from "ngx-popover";

import moment = require("moment");

import Models = require('../share/models');
import Subscribe = require('./subscribe');
import {SharedModule, FireFactory, SubscriberFactory, BaseCurrencyCellComponent, QuoteCurrencyCellComponent} from './shared_directives';
import Pair = require('./pair');
import {WalletPositionComponent} from './wallet-position';
import {MarketQuotingComponent} from './market-quoting';
import {MarketTradesComponent} from './market-trades';
import {TradeSafetyComponent} from './trade-safety';
import {OrdersComponent} from './orders';
import {TradesComponent} from './trades';

class DisplayOrder {
  side : string;
  price : number;
  quantity : number;
  timeInForce : string;
  orderType : string;

  availableSides : string[];
  availableTifs : string[];
  availableOrderTypes : string[];

  private static getNames<T>(enumObject : T) {
    var names: string[] = [];
    for (var mem in enumObject) {
      if (!enumObject.hasOwnProperty(mem)) continue;
      if (parseInt(mem, 10) >= 0) {
        names.push(String(enumObject[mem]));
      }
    }
    return names;
  }

  private _fire: Subscribe.IFire<Models.OrderRequestFromUI>;

  constructor(
    fireFactory: FireFactory
  ) {
    this.availableSides = DisplayOrder.getNames(Models.Side);
    this.availableTifs = DisplayOrder.getNames(Models.TimeInForce);
    this.availableOrderTypes = DisplayOrder.getNames(Models.OrderType);
    this._fire = fireFactory.getFire(Models.Topics.SubmitNewOrder);
  }

  public submit = () => {
    if (!this.side || !this.price || !this.quantity || !this.timeInForce || !this.orderType) return;
    var msg = new Models.OrderRequestFromUI(this.side, this.price, this.quantity, this.timeInForce, this.orderType);
    this._fire.fire(msg);
  };
}

@Component({
  selector: 'ui',
  template: `<div>
    <div *ngIf="!connected">
        <h4 class="text-danger">&nbsp;Not connected</h4>
    </div>
    <div *ngIf="connected">
        <div class="container-fluid">
            <div>
                <div style="padding: 5px;padding-top:10px;margin-top:7px;" [ngClass]="pair.connected ? 'bg-success img-rounded' : 'bg-danger img-rounded'">
                    <div class="row" [hidden]="!showConfigs">
                        <div class="col-md-9 col-xs-12">
                            <div class="row">
                                <table class="table table-responsive table-bordered" style="margin-bottom:0px;">
                                    <thead>
                                        <tr class="active">
                                            <th>mode</th>
                                            <th *ngIf="pair.quotingParameters.display.mode==7">bullets</th>
                                            <th *ngIf="pair.quotingParameters.display.mode==7">range</th>
                                            <th *ngIf="[5,6,7].indexOf(pair.quotingParameters.display.mode)>-1">pingAt</th>
                                            <th *ngIf="[5,6,7].indexOf(pair.quotingParameters.display.mode)>-1">pongAt</th>
                                            <th>width</th>
                                            <th>bidSz</th>
                                            <th>askSz</th>
                                            <th>fv</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr class="active">
                                            <td style="width:121px;">
                                                <select class="form-control input-sm"
                                                  [(ngModel)]="pair.quotingParameters.display.mode">
                                                  <option *ngFor="let option of pair.quotingParameters.availableQuotingModes" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                            <td style="width:78px;" *ngIf="pair.quotingParameters.display.mode==7">
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.bullets">
                                            </td>
                                            <td *ngIf="pair.quotingParameters.display.mode==7">
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.range">
                                            </td>
                                            <td style="width:142px;" *ngIf="[5,6,7].indexOf(pair.quotingParameters.display.mode)>-1">
                                                <select class="form-control input-sm"
                                                   [(ngModel)]="pair.quotingParameters.display.pingAt">
                                                   <option *ngFor="let option of pair.quotingParameters.availablePingAt" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                            <td style="width:148px;" *ngIf="[5,6,7].indexOf(pair.quotingParameters.display.mode)>-1">
                                                <select class="form-control input-sm"
                                                   [(ngModel)]="pair.quotingParameters.display.pongAt">
                                                   <option *ngFor="let option of pair.quotingParameters.availablePongAt" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                            <td>
                                                <input class="width-option form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.width">
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.buySize">
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.sellSize">
                                            </td>
                                            <td style="width:88px;">
                                                <select class="form-control input-sm"
                                                    [(ngModel)]="pair.quotingParameters.display.fvModel">
                                                   <option *ngFor="let option of pair.quotingParameters.availableFvModels" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                                <table class="table table-responsive table-bordered">
                                    <thead>
                                        <tr class="active">
                                            <th>apMode</th>
                                            <th>tbp</th>
                                            <th>pDiv</th>
                                            <th>ewma?</th>
                                            <th>apr</th>
                                            <th>trds</th>
                                            <th>/sec</th>
                                            <th>audio?</th>
                                            <th>delayUI</th>
                                            <th colspan="2">
                                                <span *ngIf="!pair.quotingParameters.pending && pair.quotingParameters.connected" class="text-success">
                                                    Applied
                                                </span>
                                                <span *ngIf="pair.quotingParameters.pending && pair.quotingParameters.connected" class="text-warning">
                                                    Pending
                                                </span>
                                                <span *ngIf="!pair.quotingParameters.connected" class="text-danger">
                                                    Not Connected
                                                </span>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr class="active">
                                            <td style="width:121px;">
                                                <select class="form-control input-sm"
                                                    [(ngModel)]="pair.quotingParameters.display.autoPositionMode">
                                                   <option *ngFor="let option of pair.quotingParameters.availableAutoPositionModes" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.targetBasePosition">
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.positionDivergence">
                                            </td>
                                            <td>
                                                <input type="checkbox"
                                                   [(ngModel)]="pair.quotingParameters.display.ewmaProtection">
                                            </td>
                                            <td style="width:121px;">
                                                <select class="form-control input-sm"
                                                    [(ngModel)]="pair.quotingParameters.display.aggressivePositionRebalancing">
                                                   <option *ngFor="let option of pair.quotingParameters.availableAggressivePositionRebalancings" [ngValue]="option.val">{{option.str}}</option>
                                                </select>
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.tradesPerMinute">
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.tradeRateSeconds">
                                            </td>
                                            <td>
                                                <input type="checkbox"
                                                   [(ngModel)]="pair.quotingParameters.display.audio">
                                            </td>
                                            <td>
                                                <input class="form-control input-sm"
                                                   type="number"
                                                   onClick="this.select()"
                                                   [(ngModel)]="pair.quotingParameters.display.delayUI">
                                            </td>
                                            <td>
                                                <input class="btn btn-default btn col-md-1 col-xs-6"
                                                    style="width:55px"
                                                    type="button"
                                                    (click)="pair.quotingParameters.reset()"
                                                    value="Reset" />
                                            </td>
                                            <td>
                                                <input class="btn btn-default btn col-md-1 col-xs-6"
                                                    style="width:50px"
                                                    type="submit"
                                                    (click)="pair.quotingParameters.submit()"
                                                    value="Save" />
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="col-md-3 col-xs-12">
                          <textarea [(ngModel)]="notepad" (ngModelChange)="changeNotepad(notepad)" placeholder="ephemeral notepad" class="ephemeralnotepad" style="height:114px;width: 100%;max-width: 100%;"></textarea>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-1 col-xs-12 text-center" style="padding-right:0px;">
                            <div class="row img-rounded exchange">
                                <button style="font-size:16px;" class="col-md-12 col-xs-3" [ngClass]="pair.active.getClass()" (click)="pair.active.submit()">
                                    {{ exchange_name }}<br/>{{ pair_name }}
                                </button>
                                <wallet-position></wallet-position>
                                <a [hidden]="!exchange_market" href="{{ exchange_market }}" target="_blank">Market</a><span [hidden]="!exchange_market || !exchange_orders ">,</span>
                                <a [hidden]="!exchange_orders" href="{{ exchange_orders }}" target="_blank">Orders</a>
                            </div>
                        </div>

                        <div class="col-md-9 col-xs-12" style="padding-left:0px;padding-bottom:0px;">
                          <div class="row">
                            <trade-safety [tradeFreq]="tradeFreq" [showConfigs]="showConfigs" (toggleConfigs)="toggleConfigs(showConfigs = !showConfigs)"></trade-safety>
                          </div>
                          <div class="row" style="padding-top:0px;">
                            <div class="col-md-4 col-xs-12" style="padding-left:0px;padding-top:0px;padding-right:0px;">
                                <market-quoting [connected]="!!pair.active.display"></market-quoting>
                            </div>
                            <div class="col-md-8 col-xs-12" style="padding-left:0px;padding-right:0px;padding-top:0px;">
                              <div class="row">
                                <div class="exchangeActions col-md-2 col-xs-12 text-center img-rounded">
                                  <div>
                                      <button type="button"
                                              class="btn btn-primary navbar-btn"
                                              id="order_form"
                                              [popover]="myPopover">Submit Order
                                      </button>
                                      <popover-content #myPopover
                                              placement="bottom"
                                              [animation]="true"
                                              [closeOnClickOutside]="true">
                                              <div class="text-center">
                                                <div class="form-group">
                                                    <label>Side</label>
                                                    <select class="form-control input-sm" [(ngModel)]="order.side">
                                                      <option *ngFor="let option of order.availableSides" [ngValue]="option">{{option}}</option>
                                                    </select>
                                                </div>
                                                <div class="form-group">
                                                    <label>Price</label>
                                                    <input class="form-control input-sm" type="number" [(ngModel)]="order.price" />
                                                </div>
                                                <div class="form-group">
                                                    <label>Size</label>
                                                    <input class="form-control input-sm" type="number" [(ngModel)]="order.quantity" />
                                                </div>
                                                <div class="form-group">
                                                    <label>TIF</label>
                                                    <select class="form-control input-sm" [(ngModel)]="order.timeInForce">
                                                      <option *ngFor="let option of order.availableTifs" [ngValue]="option">{{option}}</option>
                                                    </select>
                                                </div>
                                                <div class="form-group">
                                                    <label>Type</label>
                                                    <select class="form-control input-sm" [(ngModel)]="order.orderType">
                                                      <option *ngFor="let option of order.availableOrderTypes" [ngValue]="option">{{option}}</option>
                                                    </select>
                                                </div>
                                                <button type="button"
                                                    class="btn btn-success"
                                                    (click)="myPopover.hide()"
                                                    (click)="order.submit()">Submit</button>
                                              </div>
                                      </popover-content>
                                  </div>
                                  <div style="padding-top: 2px;padding-bottom: 2px;">
                                      <button type="button"
                                              class="btn btn-danger navbar-btn"
                                              (click)="cancelAllOrders()"
                                              data-placement="bottom">Cancel Orders
                                      </button>
                                  </div>
                                  <div style="padding-bottom: 2px;">
                                      <button type="button"
                                              class="btn btn-info navbar-btn"
                                              (click)="cleanAllClosedOrders()"
                                              *ngIf="[6,7].indexOf(pair.quotingParameters.display.mode)>-1"
                                              data-placement="bottom">Clean Pongs
                                      </button>
                                  </div>
                                  <div>
                                      <button type="button"
                                              class="btn btn-danger navbar-btn"
                                              (click)="cleanAllOrders()"
                                              *ngIf="[5,6,7].indexOf(pair.quotingParameters.display.mode)>-1"
                                              data-placement="bottom">Clean Pings
                                      </button>
                                  </div>
                                </div>
                                <div class="col-md-10 col-xs-12" style="padding-right:0px;padding-top:4px;">
                                  <order-list [connected]="!!pair.active.display"></order-list>
                                </div>
                              </div>
                              <div class="row">
                                <trade-list></trade-list>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="col-md-2 col-xs-12" style="padding-left:0px;">
                            <market-trades></market-trades>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <address class="text-center">
      <small>
        <a href="/view/README.md" target="_blank">README</a> - <a href="/view/MANUAL.md" target="_blank">MANUAL</a> - <a href="https://github.com/ctubio/tribeca" target="_blank">SOURCE</a> - <a href="#" (click)="changeTheme()">changeTheme(<span [hidden]="!system_theme">LIGHT</span><span [hidden]="system_theme">DARK</span>)</a> - <span title="Server used RAM" style="margin-top: 6px;display: inline-block;">{{ server_memory }}</span> - <span title="Client used RAM" style="margin-top: 6px;display: inline-block;">{{ client_memory }}</span> - <a href="https://github.com/ctubio/tribeca/issues/new?title=%5Btopic%5D%20short%20and%20sweet%20description&body=description%0Aplease,%20consider%20to%20add%20all%20possible%20details%20%28if%20any%29%20about%20your%20new%20feature%20request%20or%20bug%20report%0A%0A%2D%2D%2D%0A%60%60%60%0Aapp%20exchange%3A%20{{ exchange_name }}/{{ pair_name }}%0Aapp%20version%3A%20undisclosed%0A%60%60%60%0A![300px-spock_vulcan-salute3](https://cloud.githubusercontent.com/assets/1634027/22077151/4110e73e-ddb3-11e6-9d84-358e9f133d34.png)" target="_blank">CREATE ISSUE</a> - <a title="irc://irc.domirc.net:6667/##tradingBot" href="irc://irc.domirc.net:6667/##tradingBot">IRC</a>
      </small>
    </address>
  </div>`
})
class ClientComponent implements OnInit {

  public server_memory: string;
  public client_memory: string;
  public notepad: string;
  public connected: boolean;
  public showConfigs: boolean = false;
  public order: DisplayOrder;
  public pair: Pair.DisplayPair;
  public exchange_name: string;
  public exchange_market: string;
  public exchange_orders: string;
  public pair_name: string;
  public cancelAllOrders = () => {};
  public cleanAllClosedOrders = () => {};
  public cleanAllOrders = () => {};
  public toggleConfigs = (showConfigs:boolean) => {};
  public changeNotepad = (content: string) => {};

  private user_theme: string = null;
  private system_theme: string = null;
  public tradeFreq: number = 0;

  constructor(
    @Inject(NgZone) private zone: NgZone,
    @Inject(SubscriberFactory) private subscriberFactory: SubscriberFactory,
    @Inject(FireFactory) private fireFactory: FireFactory
  ) {}

  ngOnInit() {
    this.cancelAllOrders = () => this.fireFactory
      .getFire(Models.Topics.CancelAllOrders)
      .fire(new Models.CancelAllOrdersRequest());

    this.cleanAllClosedOrders = () => this.fireFactory
      .getFire(Models.Topics.CleanAllClosedOrders)
      .fire(new Models.CleanAllClosedOrdersRequest());

    this.cleanAllOrders = () => this.fireFactory
      .getFire(Models.Topics.CleanAllOrders)
      .fire(new Models.CleanAllOrdersRequest());

    this.changeNotepad = (content:string) => this.fireFactory
      .getFire(Models.Topics.Notepad)
      .fire(content);

    this.toggleConfigs = (showConfigs:boolean) => this.fireFactory
      .getFire(Models.Topics.ToggleConfigs)
      .fire(showConfigs);

    this.notepad = null;
    this.pair = null;
    this.reset();

    this.order = new DisplayOrder(this.fireFactory);

    this.subscriberFactory
      .getSubscriber(this.zone, Models.Topics.ProductAdvertisement)
      .registerSubscriber(this.onAdvert)
      .registerDisconnectedHandler(() => this.reset());

    this.subscriberFactory
      .getSubscriber(this.zone, Models.Topics.ApplicationState)
      .registerSubscriber(this.onAppState);

    this.subscriberFactory
      .getSubscriber(this.zone, Models.Topics.Notepad)
      .registerSubscriber(this.onNotepad);

    this.subscriberFactory
      .getSubscriber(this.zone, Models.Topics.ToggleConfigs)
      .registerSubscriber(this.onToggleConfigs);
  }

  private onNotepad = (notepad : string) => {
    this.notepad = notepad;
  }

  private onToggleConfigs = (showConfigs: boolean) => {
    this.showConfigs = showConfigs;
  }

  private reset = () => {
    this.connected = false;
    this.pair_name = null;
    this.exchange_name = null;
    this.exchange_market = null;
    this.exchange_orders = null;
    this.pair = null;
  }

  private bytesToSize = (input:number, precision:number) => {
    let unit = ['', 'K', 'M', 'G', 'T', 'P'];
    let index = Math.floor(Math.log(input) / Math.log(1024));
    if (index >= unit.length) return input + 'B';
    return (input / Math.pow(1024, index)).toFixed(precision) + unit[index] + 'B'
  }

  private onAppState = (as : Models.ApplicationState) => {
    this.server_memory = this.bytesToSize(as.memory, 0);
    this.client_memory = this.bytesToSize((<any>window.performance).memory.usedJSHeapSize, 0);
    this.system_theme = this.getTheme(as.hour);
    this.tradeFreq = (as.freq);
    this.setTheme();
  }

  private setTheme = () => {
    if (jQuery('#daynight').attr('href')!='/css/bootstrap-theme'+this.system_theme+'.min.css')
      jQuery('#daynight').attr('href', '/css/bootstrap-theme'+this.system_theme+'.min.css');
  }

  public changeTheme = () => {
    this.user_theme = this.user_theme!==null?(this.user_theme==''?'-dark':''):(this.system_theme==''?'-dark':'');
    this.system_theme = this.user_theme;
    this.setTheme();
  }

  private getTheme = (hour: number) => {
    return this.user_theme!==null?this.user_theme:((hour<9 || hour>=21)?'-dark':'');
  }

  private onAdvert = (pa : Models.ProductAdvertisement) => {
    this.connected = true;
    window.document.title = 'tribeca ['+pa.environment+']';
    this.system_theme = this.getTheme(moment.utc().hours());
    this.setTheme();
    this.pair_name = Models.Currency[pa.pair.base] + "/" + Models.Currency[pa.pair.quote];
    this.exchange_name = Models.Exchange[pa.exchange];
    this.exchange_market = this.exchange_name=='OkCoin'
      ? 'https://www.okcoin.'+(Models.Currency[pa.pair.quote]=='CNY'?'cn':'com')+'/market.html'
      : (this.exchange_name=='Coinbase'
        ? 'https://gdax.com/trade'
        : null
      );
    this.exchange_orders = this.exchange_name=='OkCoin'
      ? 'https://www.okcoin.'+(Models.Currency[pa.pair.quote]=='CNY'?'cn':'com')+'/trade/entrust.do'
      : (this.exchange_name=='Coinbase'
        ? 'https://www.gdax.com/orders/'+this.pair_name.replace('/','-')
        : null
      );

    this.pair = new Pair.DisplayPair(this.zone, this.subscriberFactory, this.fireFactory);
  }
}

@NgModule({
  imports: [
    SharedModule,
    BrowserModule,
    FormsModule,
    PopoverModule,
    AgGridModule.withComponents([
      BaseCurrencyCellComponent,
      QuoteCurrencyCellComponent
    ])
  ],
  declarations: [
    ClientComponent,
    OrdersComponent,
    TradesComponent,
    MarketQuotingComponent,
    MarketTradesComponent,
    WalletPositionComponent,
    TradeSafetyComponent,
    BaseCurrencyCellComponent,
    QuoteCurrencyCellComponent
  ],
  bootstrap: [ClientComponent]
})
class ClientModule {}

enableProdMode();
platformBrowserDynamic().bootstrapModule(ClientModule);
