/**
 * Created by Anton on 06.12.2015.
 */
var path = require('path');
var Promise = require('bluebird');
var debug = require('debug')('base');
var Storage = require('./storage');

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadConfig = function() {
    "use strict";
    return Promise.resolve().then(function() {
        var fs = require('fs');
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json')));
    });
};

/**
 *
 * @returns {bluebird|exports|module.exports}
 */
module.exports.loadLanguage = function() {
    "use strict";
    return Promise.resolve().then(function() {
        var fs = require('fs');

        var language = JSON.parse(fs.readFileSync(path.join(__dirname, 'language.json')));

        for (var key in language) {
            var item = language[key];
            if (Array.isArray(item)) {
                item = item.join('\n');
            }
            language[key] = item;
        }

        return language;
    });
};

module.exports.storage = new Storage();

/**
 * @param {string} type
 * @param {string} [text]
 * @param {string} [url]
 */
module.exports.htmlSanitize = function (type, text, url) {
    if (!text) {
        text = type;
        type = '';
    }

    var sanitize = function (text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    var sanitizeAttr = function (text) {
        return sanitize(text).replace(/"/g, '&quot;');
    };

    switch (type) {
        case '':
            return sanitize(text);
        case 'a':
            return '<a href="'+sanitizeAttr(url)+'">'+sanitize(text)+'</a>';
        case 'b':
            return '<b>'+sanitize(text)+'</b>';
        case 'strong':
            return '<strong>'+sanitize(text)+'</strong>';
        case 'i':
            return '<i>'+sanitize(text)+'</i>';
        case 'em':
            return '<em>'+sanitize(text)+'</em>';
        case 'pre':
            return '<pre>'+sanitize(text)+'</pre>';
        case 'code':
            return '<code>'+sanitize(text)+'</code>';
    }

    throw "htmlSanitize error! Type: " + type + " is not found!"
};

module.exports.markDownSanitize = function(text, char) {
    "use strict";
    if (char === '*') {
        text = text.replace(/\*/g, String.fromCharCode(735));
    }
    if (char === '_') {
        text = text.replace(/_/g, String.fromCharCode(717));
    }
    if (char === '[') {
        text = text.replace(/\[/g, '(');
        text = text.replace(/\]/g, ')');
    }
    if (!char) {
        text = text.replace(/([*_\[])/g, '\\$1');
    }

    return text;
};

module.exports.getDate = function() {
    "use strict";
    var today = new Date();
    var h = today.getHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    if (h < 10) {
        h = '0' + h;
    }
    if (m < 10) {
        m = '0' + m;
    }
    if (s < 10) {
        s = '0' + s;
    }
    return today.getDate() + "/"
        + (today.getMonth()+1)  + "/"
        + today.getFullYear() + " @ "
        + h + ":"
        + m + ":"
        + s;
};

module.exports.getNowStreamPhotoText = function(gOptions, videoItem) {
    "use strict";
    var getText = function (stripLen) {
        var textArr = [];

        var title = '';

        var descPart = [];
        if (videoItem.title) {
            descPart.push(title = videoItem.title);
        }
        if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
            descPart.push(videoItem.channel.title);
        }
        if (descPart.length) {
            var desc = descPart.join(', ');
            if (stripLen) {
                desc = desc.substr(0, desc.length - stripLen - 3) + '...';
            }
            textArr.push(desc);
        }

        if (videoItem.url) {
            textArr.push(videoItem.url);
        }

        return textArr.join('\n');
    };

    var text = getText();
    if (text.length > 200) {
        text = getText(text.length - 200);
    }

    return text;
};

module.exports.getNowStreamText = function(gOptions, videoItem) {
    "use strict";
    var textArr = [];

    var title = '';

    var line = [];
    if (videoItem.title) {
        line.push(this.htmlSanitize(title = videoItem.title));
    }
    if (videoItem.channel.title && title.indexOf(videoItem.channel.title) === -1) {
        line.push(this.htmlSanitize('i', videoItem.channel.title));
    }
    if (line.length) {
        textArr.push(line.join(', '));
    }

    if (videoItem.url) {
        textArr.push(this.htmlSanitize(videoItem.url));
    }

    return textArr.join('\n');
};

module.exports.extend = function() {
    "use strict";
    var obj = arguments[0];
    for (var i = 1, len = arguments.length; i < len; i++) {
        var item = arguments[i];
        for (var key in item) {
            obj[key] = item[key];
        }
    }
    return obj;
};

module.exports.getChannelTitle = function(gOptions, service, channelName) {
    "use strict";
    var title = channelName;

    var services = gOptions.services;
    if (services[service].getChannelTitle) {
        title = services[service].getChannelTitle(channelName);
    }

    return title;
};

module.exports.getChannelLocalTitle = function(gOptions, service, channelName) {
    "use strict";
    var title = channelName;

    var services = gOptions.services;
    if (services[service].getChannelLocalTitle) {
        title = services[service].getChannelLocalTitle(channelName);
    } else
    if (services[service].getChannelTitle) {
        title = services[service].getChannelTitle(channelName);
    }

    return title;
};

module.exports.getChannelUrl = function(service, channelName) {
    "use strict";
    var url = '';
    if (service === 'youtube') {
        url = 'https://youtube.com/';
        if (/^UC/.test(channelName)) {
            url += 'channel/';
        } else {
            url += 'user/';
        }
        url += channelName;
    }

    return url;
};

/**
 * @param {number} callPerSecond
 * @constructor
 */
module.exports.Quote = function (callPerSecond) {
    "use strict";
    var getTime = function() {
        return parseInt(Date.now() / 1000);
    };

    var sendTime = {};
    var cbQuote = [];

    var next = function () {
        var promiseList = cbQuote.slice(0, callPerSecond).map(function(item, index) {
            cbQuote[index] = null;

            var cb = item[0];
            var args = item[1];
            var resolve = item[2];
            var reject = item[3];

            return Promise.try(function() {
                return cb.apply(null, args);
            }).then(resolve, reject).catch(function (err) {
                debug('Quote error', err);
            });
        });

        var count = promiseList.length;

        var now = getTime();
        if (!sendTime[now]) {
            for (var key in sendTime) {
                delete sendTime[key];
            }
            sendTime[now] = 0;
        }
        sendTime[now] += count;

        return Promise.all(promiseList).then(function() {
            var now = getTime();
            if (!sendTime[now] || sendTime[now] < callPerSecond) {
                return;
            }

            return new Promise(function(resolve) {
                return setTimeout(resolve, 1000);
            });
        }).then(function() {
            cbQuote.splice(0, count);
            if (cbQuote.length) {
                next();
            }
        });
    };

    /**
     * @param {Function} cb
     * @returns {Function}
     */
    this.wrapper = function(cb) {
        return function () {
            var args = [].slice.call(arguments);

            return new Promise(function(resolve, reject) {
                cbQuote.push([cb, args, resolve, reject]);

                if (cbQuote.length > 1) {
                    return;
                }

                next();
            });
        };
    };
};

module.exports.getRandomInt = function (min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
};

module.exports.arrToParts = function (arr, quote) {
    arr = arr.slice(0);

    var arrList = [];
    do {
        arrList.push(arr.splice(0, quote));
    } while (arr.length);

    return arrList;
};

module.exports.getNow = function () {
    return parseInt(Date.now() / 1000);
};

/**
 * @param {Object} obj
 * @param {*} key
 * @returns {Array} obj[key]
 */
module.exports.getObjectItemOrArray = function (obj, key) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = [];
    }
    return item;
};

/**
 * @param {Object} obj
 * @param {*} key
 * @returns {Object} obj[key]
 */
module.exports.getObjectItemOrObj = function (obj, key) {
    var item = obj[key];
    if (!item) {
        item = obj[key] = {};
    }
    return item;
};

/**
 * @param {Array} arr
 * @param {*} item
 */
module.exports.removeItemFromArray = function (arr, item) {
    var pos = arr.indexOf(item);
    if (pos !== -1) {
        arr.splice(pos, 1);
    }
};

module.exports.dDblUpdates = function (updates) {
    var _this = this;
    var dDblUpdates = updates.slice(0);
    var map = {};
    updates.reverse().forEach(function (update) {
        var message = update.message;
        var callbackQuery = update.callback_query;
        var key = null;
        var value = null;
        if (message) {
            key = JSON.stringify(message.from) + JSON.stringify(message.chat);
            value = message.text;
        } else
        if (callbackQuery) {
            key = JSON.stringify(callbackQuery.message.chat) + callbackQuery.message.message_id;
            value = callbackQuery.data;
        }
        if (key && value) {
            var lines = _this.getObjectItemOrArray(map, key);
            if (lines[0] === value) {
                _this.removeItemFromArray(dDblUpdates, update);
                debug('Skip dbl msg %j', update);
            } else {
                lines.unshift(value);
            }
        }
    });
    return dDblUpdates;
};

module.exports.pageBtnList = function (btnList, updCommand, page, mediumBtn) {
    page = parseInt(page || 0);
    if (mediumBtn && !Array.isArray(mediumBtn)) {
        mediumBtn = [mediumBtn];
    }
    var maxItemCount = 10;
    var offset = page * maxItemCount;
    var offsetEnd = offset + maxItemCount;
    var countItem = btnList.length;
    var pageList = btnList.slice(offset, offsetEnd);
    if (countItem > maxItemCount || page > 0) {
        var pageControls = [];
        if (page > 0) {
            pageControls.push({
                text: '<',
                callback_data: '/' + updCommand + ' ' + (page - 1)
            });
        }
        if (mediumBtn) {
            pageControls.push.apply(pageControls, mediumBtn);
        }
        if (countItem - offsetEnd > 0) {
            pageControls.push({
                text: '>',
                callback_data: '/' + updCommand + ' ' + (page + 1)
            });
        }
        pageList.push(pageControls);
    } else
    if (mediumBtn) {
        pageList.push(mediumBtn);
    }
    return pageList;
};

module.exports.ThreadLimit = function (count) {
    var activeThreadCount = 0;
    var cbQuote = [];

    var runThread = function () {
        var item = cbQuote.shift();
        if (!item) {
            return;
        }

        var cb = item[0];
        var args = item[1];
        var resolve = item[2];
        var reject = item[3];

        activeThreadCount++;
        return Promise.try(function () {
            return cb.apply(null, args);
        }).finally(function () {
            activeThreadCount--;
            runThread();
        }).then(resolve, reject).catch(function (err) {
            debug('runThread error', err);
        });
    };

    this.wrapper = function(fn) {
        return function () {
            var args = [].slice.call(arguments);

            return new Promise(function(resolve, reject) {
                cbQuote.push([fn, args, resolve, reject]);

                if (activeThreadCount < count) {
                    runThread();
                }
            });
        };
    };
};