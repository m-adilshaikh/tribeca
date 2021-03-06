import _ = require("lodash");
import Q = require("q");
import path = require("path");
import express = require('express');
import util = require('util');
import moment = require("moment");
import fs = require("fs");
import request = require('request');
import http = require("http");
import https = require('https');
import socket_io = require('socket.io');
import marked = require('marked');

import HitBtc = require("./gateways/hitbtc");
import Coinbase = require("./gateways/coinbase");
import NullGw = require("./gateways/nullgw");
import OkCoin = require("./gateways/okcoin");
import Bitfinex = require("./gateways/bitfinex");
import Utils = require("./utils");
import Config = require("./config");
import Broker = require("./broker");
import Monitor = require("./monitor");
import QuoteSender = require("./quote-sender");
import MarketTrades = require("./markettrades");
import Publish = require("./publish");
import Models = require("../share/models");
import Interfaces = require("./interfaces");
import Quoter = require("./quoter");
import Safety = require("./safety");
import compression = require("compression");
import Persister = require("./persister");
import Active = require("./active-state");
import FairValue = require("./fair-value");
import Web = require("./web");
import QuotingParameters = require("./quoting-parameters");
import MarketFiltration = require("./market-filtration");
import PositionManagement = require("./position-management");
import Statistics = require("./statistics");
import Backtest = require("./backtest");
import QuotingEngine = require("./quoting-engine");

let defaultQuotingParameters: Models.QuotingParameters = new Models.QuotingParameters(
  2                                  ,/* width */
  0.02                               ,/* buySize */
  0.01                               ,/* sellSize */
  Models.PingAt.BothSides            ,/* pingAt */
  Models.PongAt.ShortPingFair        ,/* pongAt */
  Models.QuotingMode.AK47            ,/* mode */
  Models.FairValueModel.BBO          ,/* fvModel */
  1                                  ,/* targetBasePosition */
  0.9                                ,/* positionDivergence */
  true                               ,/* ewmaProtection */
  Models.AutoPositionMode.EwmaBasic  ,/* autoPositionMode */
  Models.APR.Off                     ,/* aggressivePositionRebalancing */
  0.9                                ,/* tradesPerMinute */
  569                                ,/* tradeRateSeconds */
  false                              ,/* audio */
  2                                  ,/* bullets */
  0.5                                ,/* range */
  .095                               ,/* longEwma */
  2*.095                             ,/* shortEwma */
  .095                               ,/* quotingEwma */
  3                                  ,/* aprMultiplier */
  .1                                 ,/* stepOverSize */
  1                                   /* delayUI */
);

let exitingEvent: () => Q.Promise<boolean>;

const performExit = () => {
  Q.timeout(exitingEvent(), 2000).then(completed => {
    if (completed) Utils.log("main").info("All exiting event handlers have fired, exiting application.");
    else Utils.log("main").warn("Did not complete clean-up tasks successfully, still shutting down.");
    process.exit();
  }).catch(err => {
    Utils.log("main").error(err, "Error while exiting application.");
    process.exit(1);
  });
};

process.on("uncaughtException", err => {
  Utils.log("main").error(err, "Unhandled exception!");
  performExit();
});

process.on("unhandledRejection", (reason, p) => {
  Utils.log("main").error(reason, "Unhandled promise rejection!", p);
  performExit();
});

process.on("exit", (code) => {
  Utils.log("main").info("Exiting with code", code);
});

process.on("SIGINT", () => {
  Utils.log("main").info("Handling SIGINT");
  performExit();
});

var backTestSimulationSetup = (
  inputData: Array<Models.Market | Models.MarketTrade>,
  parameters: Backtest.BacktestParameters
) => {
    var timeProvider: Utils.ITimeProvider = new Backtest.BacktestTimeProvider(_.first(inputData).time, _.last(inputData).time);

    var getExchange = (orderCache: Broker.OrderStateCache): Interfaces.CombinedGateway => new Backtest.BacktestExchange(
      new Backtest.BacktestGateway(
        inputData,
        parameters.startingBasePosition,
        parameters.startingQuotePosition,
        <Backtest.BacktestTimeProvider>timeProvider
      )
    );

    var getPublisher = <T>(topic: string, monitor?: Monitor.ApplicationState, persister?: Persister.ILoadAll<T>): Publish.IPublish<T> => {
        return new Publish.NullPublisher<T>();
    };

    var getReceiver = <T>(topic: string): Publish.IReceive<T> => new Publish.NullReceiver<T>();

    var getPersister = <T>(collectionName: string): Persister.ILoadAll<T> => new Backtest.BacktestPersister<T>();

    var getRepository = <T>(defValue: T, collectionName: string): Persister.ILoadLatest<T> => new Backtest.BacktestPersister<T>([defValue]);

    return {
        config: null,
        pair: null,
        exchange: Models.Exchange.Null,
        startingActive: true,
        startingParameters: parameters.quotingParameters,
        timeProvider: timeProvider,
        getExchange: getExchange,
        getReceiver: getReceiver,
        getPersister: getPersister,
        getRepository: getRepository,
        getPublisher: getPublisher
    };
};

var liveTradingSetup = (config: Config.ConfigProvider) => {
    var timeProvider: Utils.ITimeProvider = new Utils.RealTimeProvider();

    var app = express();

    var web_server;
    try {
      web_server = https.createServer({
        key: fs.readFileSync('./etc/sslcert/server.key', 'utf8'),
        cert: fs.readFileSync('./etc/sslcert/server.crt', 'utf8')
      }, app);
    } catch (e) {
      web_server = http.createServer(app)
    }

    var io = socket_io(web_server);

    var username = config.GetString("WebClientUsername");
    var password = config.GetString("WebClientPassword");
    if (username !== "NULL" && password !== "NULL") {
        Utils.log("main").info("Requiring authentication to web client");
        var basicAuth = require('basic-auth-connect');
        app.use(basicAuth((u, p) => u === username && p === password));
    }

    app.use(compression());
    app.use(express.static(path.join(__dirname, "..", "pub")));

    var webport = config.GetNumber("WebClientListenPort");
    web_server.listen(webport, () => Utils.log("main").info('Listening to admins on *:', webport));

    app.get("/view/*", (req: express.Request, res: express.Response) => {
      try {
        res.send(marked(fs.readFileSync('./'+req.path.replace('/view/','').replace('/','').replace('..',''), 'utf8')));
      } catch (e) {
        res.send('Document Not Found, but today is a beautiful day.');
      }
    });

    let pair = ((raw: string): Models.CurrencyPair => {
      let split = raw.split("/");
      if (split.length !== 2) throw new Error("Invalid currency pair! Must be in the format of BASE/QUOTE, eg BTC/EUR");
      return new Models.CurrencyPair(Models.Currency[split[0]], Models.Currency[split[1]]);
    })(config.GetString("TradedPair"));

    var exchange = ((): Models.Exchange => {
      let ex: string = config.GetString("EXCHANGE").toLowerCase();
      switch (ex) {
        case "hitbtc": return Models.Exchange.HitBtc;
        case "coinbase": return Models.Exchange.Coinbase;
        case "okcoin": return Models.Exchange.OkCoin;
        case "null": return Models.Exchange.Null;
        case "bitfinex": return Models.Exchange.Bitfinex;
        default: throw new Error("unknown configuration env variable EXCHANGE " + ex);
      }
    })();

    var getExchange = (orderCache: Broker.OrderStateCache): Interfaces.CombinedGateway => {
      switch (exchange) {
        case Models.Exchange.HitBtc: return <Interfaces.CombinedGateway>(new HitBtc.HitBtc(config, pair));
        case Models.Exchange.Coinbase: return <Interfaces.CombinedGateway>(new Coinbase.Coinbase(config, orderCache, timeProvider, pair));
        case Models.Exchange.OkCoin: return <Interfaces.CombinedGateway>(new OkCoin.OkCoin(config, pair));
        case Models.Exchange.Null: return <Interfaces.CombinedGateway>(new NullGw.NullGateway());
        case Models.Exchange.Bitfinex: return <Interfaces.CombinedGateway>(new Bitfinex.Bitfinex(timeProvider, config, pair));
        default: throw new Error("no gateway provided for exchange " + exchange);
      }
    };

    var getPublisher = <T>(topic: string, monitor?: Monitor.ApplicationState, persister?: Persister.ILoadAll<T>): Publish.IPublish<T> => {
      if (monitor && !monitor.io) monitor.io = io;
      var socketIoPublisher = new Publish.Publisher<T>(topic, io, monitor, null);
      if (persister) return new Web.StandaloneHttpPublisher<T>(socketIoPublisher, topic, app, persister);
      else return socketIoPublisher;
    };

    var getReceiver = <T>(topic: string): Publish.IReceive<T> => new Publish.Receiver<T>(topic, io);

    var db = Persister.loadDb(config);

    var loaderSaver = new Persister.LoaderSaver(exchange, pair);

    var getPersister = <T>(collectionName: string): Persister.ILoadAll<T> => {
        let ls = collectionName === "mt" ? new MarketTrades.MarketTradesLoaderSaver(loaderSaver) : loaderSaver;
        return new Persister.Persister<T>(db, collectionName, exchange, pair, (collectionName === "trades"), ls.loader, ls.saver);
    };

    var getRepository = <T>(defValue: T, collectionName: string): Persister.ILoadLatest<T> =>
        new Persister.RepositoryPersister<T>(db, defValue, collectionName, exchange, pair, loaderSaver.loader, loaderSaver.saver);

    return {
        config: config,
        pair: pair,
        exchange: exchange,
        startingActive: config.GetString("TRIBECA_MODE").indexOf('auto')>-1,
        startingParameters: defaultQuotingParameters,
        timeProvider: timeProvider,
        getExchange: getExchange,
        getReceiver: getReceiver,
        getPersister: getPersister,
        getRepository: getRepository,
        getPublisher: getPublisher
    };
};

interface TradingSystem {
    config: Config.ConfigProvider;
    pair: Models.CurrencyPair;
    exchange: Models.Exchange;
    startingActive: boolean;
    startingParameters: Models.QuotingParameters;
    timeProvider: Utils.ITimeProvider;
    getExchange(orderCache: Broker.OrderStateCache): Interfaces.CombinedGateway;
    getReceiver<T>(topic: string): Publish.IReceive<T>;
    getPersister<T>(collectionName: string): Persister.ILoadAll<T>;
    getRepository<T>(defValue: T, collectionName: string): Persister.ILoadLatest<T>;
    getPublisher<T>(topic: string, monitor?: Monitor.ApplicationState, persister?: Persister.ILoadAll<T>): Publish.IPublish<T>;
}

var runTradingSystem = (system: TradingSystem) : Q.Promise<boolean> => {
    var tradesPersister = system.getPersister("trades");

    var paramsPersister = system.getRepository(system.startingParameters, Models.Topics.QuotingParametersChange);

    var completedSuccessfully = Q.defer<boolean>();

    Q.all<any>([
      paramsPersister.loadLatest(),
      tradesPersister.loadAll(10000)
    ]).spread((
      initParams: Models.QuotingParameters,
      initTrades: Models.Trade[]
    ) => {
        _.defaults(initParams, defaultQuotingParameters);

        system.getPublisher(Models.Topics.ProductAdvertisement)
          .registerSnapshot(() => [new Models.ProductAdvertisement(
            system.exchange,
            system.pair,
            system.config.GetString("TRIBECA_MODE").replace('auto','')
          )]);

        let paramsRepo = new QuotingParameters.QuotingParametersRepository(
          system.getPublisher(Models.Topics.QuotingParametersChange),
          system.getReceiver(Models.Topics.QuotingParametersChange),
          initParams,
          paramsPersister
        );

        let monitor = new Monitor.ApplicationState(
          system.timeProvider,
          paramsRepo,
          system.getPublisher(Models.Topics.ApplicationState),
          system.getPublisher(Models.Topics.Notepad),
          system.getReceiver(Models.Topics.Notepad),
          system.getPublisher(Models.Topics.ToggleConfigs),
          system.getReceiver(Models.Topics.ToggleConfigs)
        );

        var orderCache = new Broker.OrderStateCache();
        var gateway = system.getExchange(orderCache);

        var broker = new Broker.ExchangeBroker(
          system.pair,
          gateway.md,
          gateway.base,
          gateway.oe,
          system.getPublisher(Models.Topics.ExchangeConnectivity)
        );

        var orderBroker = new Broker.OrderBroker(
          system.timeProvider,
          paramsRepo,
          broker,
          gateway.oe,
          tradesPersister,
          system.getPublisher(Models.Topics.OrderStatusReports, monitor),
          system.getPublisher(Models.Topics.Trades, null, tradesPersister),
          system.getReceiver(Models.Topics.SubmitNewOrder),
          system.getReceiver(Models.Topics.CancelOrder),
          system.getReceiver(Models.Topics.CancelAllOrders),
          system.getReceiver(Models.Topics.CleanAllClosedOrders),
          system.getReceiver(Models.Topics.CleanAllOrders),
          orderCache,
          initTrades
        );

        var marketDataBroker = new Broker.MarketDataBroker(
          gateway.md,
          system.getPublisher(Models.Topics.MarketData, monitor)
        );

        var positionBroker = new Broker.PositionBroker(
          system.timeProvider,
          broker,
          orderBroker,
          gateway.pg,
          system.getPublisher(Models.Topics.Position, monitor),
          marketDataBroker
        );

        var quoter = new Quoter.Quoter(paramsRepo, orderBroker, broker);
        var filtration = new MarketFiltration.MarketFiltration(quoter, marketDataBroker);
        var fvEngine = new FairValue.FairValueEngine(
          system.timeProvider,
          filtration,
          paramsRepo,
          system.getPublisher(Models.Topics.FairValue, monitor)
        );

        var quotingEngine = new QuotingEngine.QuotingEngine(
          system.timeProvider,
          filtration,
          fvEngine,
          paramsRepo,
          orderBroker,
          positionBroker,
          new Statistics.ObservableEWMACalculator(
            system.timeProvider,
            fvEngine,
            initParams.quotingEwma
          ),
          new PositionManagement.TargetBasePositionManager(
            system.timeProvider,
            new PositionManagement.PositionManager(
              system.timeProvider,
              fvEngine,
              new Statistics.EwmaStatisticCalculator(initParams.shortEwma, null),
              new Statistics.EwmaStatisticCalculator(initParams.longEwma, null)
            ),
            paramsRepo,
            positionBroker,
            system.getPublisher(Models.Topics.TargetBasePosition, monitor)
          ),
          new Safety.SafetyCalculator(
            system.timeProvider,
            fvEngine,
            paramsRepo,
            orderBroker,
            system.getPublisher(Models.Topics.TradeSafetyValue, monitor)
          )
        );

        new QuoteSender.QuoteSender(
          system.timeProvider,
          paramsRepo,
          quotingEngine,
          system.getPublisher(Models.Topics.QuoteStatus, monitor),
          quoter,
          positionBroker,
          fvEngine,
          marketDataBroker,
          broker,
          new Active.ActiveRepository(
            system.startingActive,
            broker,
            system.getPublisher(Models.Topics.ActiveChange),
            system.getReceiver(Models.Topics.ActiveChange)
          )
        );

        new MarketTrades.MarketTradeBroker(
          gateway.md,
          system.getPublisher(Models.Topics.MarketTrade),
          marketDataBroker,
          quotingEngine,
          broker
        );

        if (system.config.inBacktestMode) {
            var t = Utils.date();
            console.log("starting backtest");
            try {
                (<Backtest.BacktestExchange>gateway).run();
            }
            catch (err) {
                console.error("exception while running backtest!", err.message, err.stack);
                completedSuccessfully.reject(err);
                return completedSuccessfully.promise;
            }

            var results = [paramsRepo.latest, positionBroker.latestReport, {
                trades: orderBroker._trades.map(t => [t.time.valueOf(), t.price, t.quantity, t.side]),
                volume: orderBroker._trades.reduce((p, c) => p + c.quantity, 0)
            }];
            console.log("sending back results, took: ", Utils.date().diff(t, "seconds"));

            request({url: ('BACKTEST_SERVER_URL' in process.env ? process.env['BACKTEST_SERVER_URL'] : "http://localhost:5001")+"/result",
                     method: 'POST',
                     json: results}, (err, resp, body) => { });

            completedSuccessfully.resolve(true);
            return completedSuccessfully.promise;
        }

        exitingEvent = () => {
            orderBroker.cancelOpenOrders().then(n_cancelled => {
                Utils.log("main").info("Cancelled all", n_cancelled, "open orders");
                completedSuccessfully.resolve(true);
            }).done();

            system.timeProvider.setTimeout(() => {
                if (completedSuccessfully.promise.isFulfilled) return;
                Utils.log("main").error("Could not cancel all open orders!");
                completedSuccessfully.resolve(false);
            }, moment.duration(1000));
            return completedSuccessfully.promise;
        };

        var start = process.hrtime();
        var interval = 500;
        setInterval(() => {
            var delta = process.hrtime(start);
            var ms = (delta[0] * 1e9 + delta[1]) / 1e6;
            var n = ms - interval;
            if (n > 121)
                Utils.log("main").info("Event loop delay " + Utils.roundFloat(n) + "ms");
            start = process.hrtime();
        }, interval).unref();

    }).done();

    return completedSuccessfully.promise;
};

((): Q.Promise<any> => {
  let config = new Config.ConfigProvider();
  if (!config.inBacktestMode) return runTradingSystem(liveTradingSetup(config));

  console.log("enter backtest mode");

  var getFromBacktestServer = (ep: string) : Q.Promise<any> => {
      var d = Q.defer<any>();
      request.get(('BACKTEST_SERVER_URL' in process.env ? process.env['BACKTEST_SERVER_URL'] : "http://localhost:5001")+"/"+ep, (err, resp, body) => {
        if (err) d.reject(err);
        else d.resolve(body);
      });
      return d.promise;
  };

  var inputDataPromise = getFromBacktestServer("inputData").then(body => {
    var inp: Array<Models.Market | Models.MarketTrade> = (typeof body ==="string") ? eval(body) : body;

    for (var i = 0; i < inp.length; i++) {
      var d = inp[i];
      d.time = moment(d.time);
    }

    return inp;
  });

  var nextParameters = () : Q.Promise<Backtest.BacktestParameters> => getFromBacktestServer("nextParameters").then(body => {
    var p = (typeof body ==="string") ? <string|Backtest.BacktestParameters>JSON.parse(body) : body;
    console.log("Recv'd parameters", util.inspect(p));
    return (typeof p === "string") ? null : p;
  });

  var promiseWhile = <T>(body : () => Q.Promise<boolean>) => {
    var done = Q.defer<any>();

    var loop = () => {
      body().then(possibleResult => {
        if (!possibleResult) return done.resolve(null);
        else Q.when(possibleResult, loop, done.reject);
      });
    };

    Q.nextTick(loop);
    return done.promise;
  };

  return inputDataPromise.then(
    (inputMarketData: Array<Models.Market | Models.MarketTrade>): Q.Promise<any> => {
      return promiseWhile(() => {
        return nextParameters().then((p: Backtest.BacktestParameters) => {
          return p !== null
            ? runTradingSystem(backTestSimulationSetup(inputMarketData, p))
            : false;
        });
      });
    }
  );
})().done();
