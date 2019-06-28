/**
 * Created by Anton on 06.12.2015.
 */
"use strict";
const debug = require('debug')('app:index');
const PushApi = require('./pushApi');
const Checker = require('./checker');
const Chat = require('./chat');
const Quote = require('./tools/quote');
const bluebird = require('bluebird');
bluebird.config({
  cancellation: true,
});
process.env.NTBA_FIX_319 = true;
const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const Daemon = require('./daemon');
const Tracker = require('./tracker');
const MsgStack = require('./msgStack');
const MsgSender = require('./msgSender');
const Users = require('./users');
const Db = require('./db');
const Locale = require('./locale');
const Channels = require('./channels');
const loadConfig = require('./tools/loadConfig');

const config = {
  token: '',
  interval: 360,
  gaId: '',
  ytToken: '',
  checkOnRun: false,
  botName: 'ytWatchBot',
  push: {
    port: 80,
    secret: '',
    callbackUrl: '',
    leaseSeconds: 86400
  },
  db: {
    host: 'localhost',
    port: 3306,
    database: 'ytWatchBot',
    user: '',
    password: ''
  }
};

class Main {
  constructor() {
    this.events = new EventEmitter();
    this.config = config;
    this.locale = null;
    this.language = null;
    // this.db = null;
    this.channels = null;
    this.users = null;
    this.msgStack = null;
    this.services = {};
    this.serviceList = ['youtube'];
    this.serviceToTitle = {
      youtube: 'Youtube'
    };
    this.daemon = null;
    this.bot = null;
    this.tracker = null;
    this.msgSender = null;
    this.chat = null;
    this.checker = null;
    this.pushApi = null;

    this.init();
  }

  async init() {
    this.config = loadConfig();

    const locale = this.locale = new Locale(this);
    this.language = locale.language;

    const db = this.db = new Db(this);
    await db.init();

    this.channels = new Channels(this);

    const Youtube = require('./services/youtube');
    this.services.youtube = new Youtube(this);

    this.users = new Users(this);

    this.msgStack = new MsgStack(this);

    this.daemon = new Daemon(this);

    this.initBot();

    this.tracker = new Tracker(this);
    this.msgSender = new MsgSender(this);
    this.chat = new Chat(this);
    this.checker = new Checker(this);

    this.pushApi = new PushApi(this);
    await this.pushApi.onReady;
  }

  initBot() {
    let request = null;
    if (this.config.proxy) {
      const tunnel = require('tunnel');
      request = {
        agent: tunnel.httpsOverHttp({
          proxy: this.config.proxy
        })
      };
    }

    const bot = this.bot = new TelegramBot(this.config.token, {
      polling: true,
      request: request
    });
    bot.on('polling_error', function (err) {
      debug('pollingError %o', err.message);
    });

    const quote = new Quote(30);
    bot.sendMessage = quote.wrap(bot.sendMessage.bind(bot));
    bot.sendPhotoQuote = quote.wrap(bot.sendPhoto.bind(bot));
  }
}

module.exports = new Main();