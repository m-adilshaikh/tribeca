import Models = require("../share/models");
import Monitor = require("./monitor");

export interface IPublish<T> {
    publish: (msg: T) => void;
    registerSnapshot: (generator: () => T[]) => IPublish<T>;
}

export class Publisher<T> implements IPublish<T> {
    private _snapshot: () => T[] = null;
    constructor(private topic: string,
                private _io: SocketIO.Server,
                private _monitor: Monitor.ApplicationState,
                private snapshot: () => T[]) {
        this.registerSnapshot(snapshot || null);

        var onConnection = s => {
            s.on(Models.Prefixes.SUBSCRIBE + topic, () => {
                if (this._snapshot !== null) {
                  let snap: T[] = this._snapshot();
                  if (this.topic === Models.Topics.MarketData)
                    snap = this.compressSnapshot(this._snapshot(), this.compressMarketDataInc);
                  else if (this.topic === Models.Topics.OrderStatusReports)
                    snap = this.compressSnapshot(this._snapshot(), this.compressOSRInc);
                  else if (this.topic === Models.Topics.Position)
                    snap = this.compressSnapshot(this._snapshot(), this.compressPositionInc);
                  s.emit(Models.Prefixes.SNAPSHOT + topic, snap);
                }
            });
        };

        this._io.on("connection", onConnection);

        Object.keys(this._io.sockets.connected).forEach(s => {
            onConnection(this._io.sockets.connected[s]);
        });
    }

    public publish = (msg: T) => {
      if (this.topic === Models.Topics.MarketData)
        msg = this.compressMarketDataInc(msg);
      else if (this.topic === Models.Topics.OrderStatusReports)
        msg = this.compressOSRInc(msg);
      else if (this.topic === Models.Topics.Position)
        msg = this.compressPositionInc(msg);
      if (this._monitor && this._monitor.io)
        this._monitor.delay(Models.Prefixes.MESSAGE, this.topic, msg)
      else this._io.emit(Models.Prefixes.MESSAGE + this.topic, msg);
    };

    public registerSnapshot = (generator: () => T[]) => {
        if (this._snapshot === null) this._snapshot = generator;
        else throw new Error("already registered snapshot generator for topic " + this.topic);
        return this;
    }

    private compressSnapshot = (data: T[], compressIncremental:(data: any) => T): T[] => {
      let ret: T[] = [];
      data.forEach(x => ret.push(compressIncremental(x)));
      return ret;
    };

    private compressMarketDataInc = (data: any): T => {
      let ret: any = new Models.Timestamped([[],[]], data.time);
      let diffPrice: number = 0;
      let prevPrice: number = 0;
      data.bids.map(bid => {
        diffPrice = Math.abs(prevPrice - bid.price);
        prevPrice = bid.price;
        ret.data[0].push(Math.round(diffPrice * 1e2) / 1e1, Math.round(bid.size * 1e3) / 1e2)
      });
      diffPrice = 0;
      prevPrice = 0;
      data.asks.map(ask => {
        diffPrice = Math.abs(prevPrice - ask.price);
        prevPrice = ask.price;
        ret.data[1].push(Math.round(diffPrice * 1e2) / 1e1, Math.round(ask.size * 1e3) / 1e2)
      });
      return ret;
    };

    private compressOSRInc = (data: any): T => {
      return <any>new Models.Timestamped(
        (data.orderStatus == Models.OrderStatus.Cancelled
        || data.orderStatus == Models.OrderStatus.Complete
        || data.orderStatus == Models.OrderStatus.Rejected)
      ? [
        data.orderId,
        data.orderStatus
      ] : [
        data.orderId,
        data.orderStatus,
        data.exchange,
        data.price,
        data.quantity,
        data.side,
        data.type,
        data.timeInForce,
        data.latency,
        data.leavesQuantity,
        data.pair.quote
      ], data.time);
    };

    private compressPositionInc = (data: any): T => {
      return <any>new Models.Timestamped([
        Math.round(data.baseAmount * 1e3) / 1e3,
        Math.round(data.quoteAmount * 1e2) / 1e2,
        Math.round(data.baseHeldAmount * 1e3) / 1e3,
        Math.round(data.quoteHeldAmount * 1e2) / 1e2,
        Math.round(data.value * 1e5) / 1e5,
        Math.round(data.quoteValue * 1e2) / 1e2,
        data.pair.base,
        data.pair.quote
      ], data.time);
    };
}

export class NullPublisher<T> implements IPublish<T> {
  public publish = (msg: T) => {};
  public registerSnapshot = (generator: () => T[]) => this;
}


export interface IReceive<T> {
    registerReceiver(handler: (msg: T) => void) : void;
}

export class NullReceiver<T> implements IReceive<T> {
    registerReceiver = (handler: (msg: T) => void) => {};
}

export class Receiver<T> implements IReceive<T> {
    private _handler: (msg: T) => void = null;
    constructor(private topic: string, io: SocketIO.Server) {
        var onConnection = (s: SocketIO.Socket) => {
            // this._log("socket", s.id, "connected for Receiver", topic);
            s.on(Models.Prefixes.MESSAGE + this.topic, msg => {
                if (this._handler !== null)
                    this._handler(msg);
            });
            // s.on("error", e => {
                // _log("error in Receiver", e.stack, e.message);
            // });
        };

        io.on("connection", onConnection);
        Object.keys(io.sockets.connected).forEach(s => {
            onConnection(io.sockets.connected[s]);
        });
    }

    registerReceiver = (handler : (msg : T) => void) => {
        if (this._handler === null) {
            this._handler = handler;
        }
        else {
            throw new Error("already registered receive handler for topic " + this.topic);
        }
    };
}
