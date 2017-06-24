/**
 * Created by Anton on 21.05.2016.
 */
"use strict";
const base = require('./base');
const debug = require('debug')('app:msgStack');
const debugLog = require('debug')('app:msgStack:log');
debugLog.log = console.log.bind(console);

var MsgStack = function (options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};

    options.events.on('checkStack', function () {
        _this.checkStack();
    });

    this.onReady = this.init();
};

MsgStack.prototype.init = function () {
    var _this = this;
    var db = this.gOptions.db;
    var promise = Promise.resolve();
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            CREATE TABLE IF NOT EXISTS `messages` ( \
                `id` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `channelId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `publishedAt` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                `data` LONGTEXT CHARACTER SET utf8mb4 NOT NULL, \
                `imageFileId` TEXT CHARACTER SET utf8mb4 NULL, \
            INDEX `publishedAt_idx` (`publishedAt` ASC), \
            UNIQUE INDEX `id_UNIQUE` (`id` ASC), \
            FOREIGN KEY (`channelId`) \
                REFERENCES `channels` (`id`) \
                ON DELETE CASCADE \
                ON UPDATE CASCADE); \
        ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
                CREATE TABLE IF NOT EXISTS `chatIdMessageId` ( \
                    `chatId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `messageId` VARCHAR(191) CHARACTER SET utf8mb4 NOT NULL, \
                    `timeout` INT NULL DEFAULT 0, \
                UNIQUE INDEX `chatIdMessageId_UNIQUE` (`chatId` ASC, `messageId` ASC), \
                FOREIGN KEY (`chatId`) \
                    REFERENCES `chats` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE,\
                FOREIGN KEY (`messageId`) \
                    REFERENCES `messages` (`id`) \
                    ON DELETE CASCADE \
                    ON UPDATE CASCADE); \
            ', function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
    promise = promise.then(function () {
        return _this.migrate();
    });
    return promise;
};

MsgStack.prototype.migrate = function () {
    var _this = this;
    var gOptions = _this.gOptions;
    var db = _this.gOptions.db;

    /**
     * @param tableName
     * @return {Promise.<{id, title, publishedAfter}>}
     */
    var getServiceChannels = function (tableName) {
        return new Promise(function (resolve, reject) {
            db.connection.query('\
            SELECT * FROM ' + tableName + '; \
        ', function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    };

    var insertChannel = function (connection, channel) {
        return new Promise(function (resolve, reject) {
            connection.query('\
            INSERT INTO channels SET ? \
        ', [channel], function (err, results) {
                if (err) {
                    debug('insertChannel error', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    var getChatIdChannelId = function (connection, channelId, service) {
        return new Promise(function (resolve, reject) {
            connection.query('\
                SELECT * FROM oldChatIdChannelId WHERE channelId = ? AND service = ?; \
            ', [channelId, service], function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    };

    var addChatIdChannelId = function (connection, item) {
        var db = _this.gOptions.db;
        return new Promise(function (resolve, reject) {
            connection.query('\
                INSERT INTO chatIdChannelId SET ? ON DUPLICATE KEY UPDATE ?; \
            ', [item, item], function (err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    };

    var getMessages = function (connection, channelId) {
        return new Promise(function (resolve, reject) {
            connection.query('\
                SELECT * FROM oldMessages WHERE channelId = ?; \
            ', [channelId], function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    };

    var insertMessage = function (connection, item) {
        return new Promise(function (resolve, reject) {
            connection.query('INSERT INTO messages SET ?', item, function (err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    };

    const insertPool = new base.Pool(30);

    var promise = Promise.resolve();

    [{
        name: 'youtube',
        table: 'ytChannels'
    }].forEach(function (item) {
        var serviceName = item.name;
        var tableName = item.table;
        var service = gOptions.services[serviceName];

        promise = promise.then(function () {
            return getServiceChannels(tableName);
        }).then(function (channels) {
            return insertPool.do(function () {
                var oldChannel = channels.shift();
                if (!oldChannel) return;

                return db.transaction(function (connection) {
                    const ytChannelId = oldChannel.id;
                    const channelId = _this.gOptions.channels.wrapId(ytChannelId, serviceName);
                    const title = oldChannel.title;
                    const publishedAfter = oldChannel.publishedAfter;

                    const channel = {
                        id: channelId,
                        service: serviceName,
                        title: title,
                        url: service.getChannelUrl(ytChannelId),
                        publishedAfter: publishedAfter,
                        subscribed: 1
                    };

                    return insertChannel(connection, channel).then(function () {
                        var promise = Promise.resolve();
                        promise = promise.then(function () {
                            return getChatIdChannelId(connection, oldChannel.id, serviceName).then(function (rows) {
                                var promise = Promise.resolve();
                                rows.forEach(function (row) {
                                    promise = promise.then(function () {
                                        delete row.service;
                                        row.channelId = channel.id;
                                        return addChatIdChannelId(connection, row).catch(function (err) {
                                            debug('addChannel error %o %o %o', oldChannel, channel, err);
                                        });
                                    });
                                });
                                return promise;
                            });
                        });
                        promise = promise.then(function () {
                            return getMessages(connection, oldChannel.id).then(function (messages) {
                                var promise = Promise.resolve();
                                messages.forEach(function (oldMessage) {
                                    promise = promise.then(function () {
                                        var data = JSON.parse(oldMessage.data);
                                        delete data._service;
                                        delete data._channelName;
                                        delete data._videoId;
                                        delete data.publishedAt;
                                        data.channel.id = channel.id;

                                        var id = oldMessage.id.substr(2);

                                        var item = {
                                            id: gOptions.channels.wrapId(id, serviceName),
                                            channelId: channel.id,
                                            publishedAt: oldMessage.publishedAt,
                                            data: JSON.stringify(data)
                                        };

                                        return insertMessage(connection, item).catch(function (err) {
                                            debug('setStream error %o %o', item, err);
                                        });
                                    });
                                });
                                return promise;
                            });
                        });
                        return promise;
                    }).catch(function (err) {
                        debug('getChannelId error %o %o', oldChannel, err);
                    });
                });
            });
        });
    });
    return promise;
};

MsgStack.prototype.addChatIdsMessageId = function (connection, chatIds, messageId) {
    return new Promise(function (resolve, reject) {
        if (!chatIds.length) {
            return resolve();
        }
        var values = chatIds.map(function (id) {
            return [id, messageId];
        });
        connection.query('\
            INSERT INTO chatIdMessageId (chatId, messageId) VALUES ? ON DUPLICATE KEY UPDATE chatId = chatId; \
        ', [values], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

/**
 * @typedef {{}} StackItemData
 * @property {string} url
 * @property {string} title
 * @property {string[]} preview
 * @property {string} duration
 * @property {{}} channel
 * @property {string} channel.title
 * @property {id} channel.id
 */

/**
 * @typedef {{}} StackItem
 *
 * @property {String} chatId
 * @property {String} messageId
 * @property {Number} timeout
 *
 * @property {String} id
 * @property {String} channelId
 * @property {String} publishedAt
 * @property {String} data
 * @property {String} [imageFileId]
 */
/**
 * @return {Promise.<StackItem[]>}
 */
MsgStack.prototype.getStackItems = function () {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            SELECT * FROM chatIdMessageId \
            LEFT JOIN messages ON chatIdMessageId.messageId = messages.id \
            WHERE chatIdMessageId.timeout < ? \
            ORDER BY messages.publishedAt ASC \
            LIMIT 30; \
        ', [base.getNow()], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        });
    });
};

MsgStack.prototype.sendLog = function (chatId, messageId, data) {
    var debugItem = JSON.parse(JSON.stringify(data));
    delete debugItem.preview;
    debugLog('[send] %s %s %j', messageId, chatId, debugItem);
};

MsgStack.prototype.setTimeout = function (chatId, messageId, timeout) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE chatIdMessageId SET timeout = ? WHERE chatId = ? AND messageId = ?; \
        ', [timeout, chatId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.messageIdsExists = function (ids) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        if (!ids.length) {
            return resolve([]);
        }
        db.connection.query('\
            SELECT id FROM messages WHERE id IN ?; \
            ', [[ids]], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results.map(function (item) {
                    return item.id;
                }));
            }
        });
    });
};

MsgStack.prototype.setImageFileId = function (messageId, imageFileId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            UPDATE messages SET imageFileId = ? WHERE id = ?; \
        ', [imageFileId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    }).catch(function (err) {
        debug('setImageFileId error', err);
    });
};

MsgStack.prototype.removeItem = function (chatId, messageId) {
    var db = this.gOptions.db;
    return new Promise(function (resolve, reject) {
        db.connection.query('\
            DELETE FROM chatIdMessageId WHERE chatId = ? AND messageId = ?; \
        ', [chatId, messageId], function (err, results) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

MsgStack.prototype.onSendMessageError = function (err) {
    var _this = this;
    /**
     * @type {Object}
     * @property {string} type
     * @property {string} id
     * @property {string} chatId
     */
    var itemObj = err.itemObj;
    var result = null;
    if (err.code === 'ETELEGRAM') {
        var body = err.response.body;

        var isBlocked = body.error_code === 403;
        if (!isBlocked) {
            isBlocked = [
                /group chat is deactivated/,
                /chat not found/,
                /channel not found/,
                /USER_DEACTIVATED/
            ].some(function (re) {
                return re.test(body.description);
            });
        }

        if (isBlocked) {
            if (itemObj.type === 'chat') {
                result = _this.gOptions.users.removeChat(itemObj.chatId, body.description);
            } else {
                result = _this.gOptions.users.removeChatChannel(itemObj.chatId, itemObj.id, body.description);
            }
        } else
        if (itemObj.type === 'chat' && body.parameters && body.parameters.migrate_to_chat_id) {
            result = _this.gOptions.users.changeChatId(itemObj.chatId, body.parameters.migrate_to_chat_id);
        }
    }

    if (!result) {
        throw err;
    }

    return result;
};

MsgStack.prototype.sendVideoMessage = function (chat_id, messageId, message, data, useCache, chatId) {
    var _this = this;
    return _this.gOptions.msgSender.sendMessage(chat_id, messageId, message, data, useCache).then(function (msg) {
        var isPhoto = !!msg.photo;

        _this.gOptions.tracker.track(chat_id, 'bot', isPhoto ? 'sendPhoto' : 'sendMsg', data.channel.id);
    });
};

MsgStack.prototype.sendItem = function (/*StackItem*/item) {
    var _this = this;
    var chatId = item.chatId;
    var messageId = item.messageId;
    var imageFileId = item.imageFileId;

    var timeout = 5 * 60;
    return _this.setTimeout(chatId, messageId, base.getNow() + timeout).then(function () {
        /**
         * @type {StackItemData}
         */
        var data = JSON.parse(item.data);

        return _this.gOptions.users.getChat(chatId).then(function (chat) {
            if (!chat) {
                debug('Can\'t send message %s, user %s is not found!', messageId, chatId);
                return;
            }

            var options = chat.options;

            var text = base.getNowStreamText(_this.gOptions, data);
            var caption = '';

            if (!options.hidePreview) {
                caption = base.getNowStreamPhotoText(_this.gOptions, data);
            }

            var message = {
                imageFileId: imageFileId,
                caption: caption,
                text: text
            };

            var chatList = [{
                type: 'chat',
                id: chat.id,
                chatId: chat.id
            }];
            if (chat.channelId) {
                chatList.push({
                    type: 'channel',
                    id: chat.channelId,
                    chatId: chat.id
                });
                if (options.mute) {
                    chatList.shift();
                }
            }

            var promise = Promise.resolve();
            chatList.forEach(function (itemObj) {
                var chat_id = itemObj.id;
                promise = promise.then(function () {
                    return _this.sendVideoMessage(chat_id, messageId, message, data, true, chat.id).then(function () {
                        _this.sendLog(chat_id, messageId, data);
                    });
                }).catch(function (err) {
                    err.itemObj = itemObj;
                    throw err;
                });
            });

            return promise.catch(function (err) {
                return _this.onSendMessageError(err);
            });
        });
    }).then(function () {
        return _this.removeItem(chatId, messageId);
    }).catch(function (err) {
        debug('sendItem', chatId, messageId, err);

        if (/PEER_ID_INVALID/.test(err)) {
            timeout = 6 * 60 * 60;
        }
        return _this.setTimeout(chatId, messageId, base.getNow() + timeout);
    });
};

var activeChatIds = [];
var activePromises = [];

MsgStack.prototype.checkStack = function () {
    var _this = this;
    var limit = 10;
    if (activePromises.length >= limit) return;

    _this.getStackItems().then(function (/*StackItem[]*/items) {
        items.some(function (item) {
            var chatId = item.chatId;

            if (activePromises.length >= limit) return true;
            if (activeChatIds.indexOf(chatId) !== -1) return;

            var promise = _this.sendItem(item);
            activeChatIds.push(chatId);
            activePromises.push(promise);

            var any = function () {
                base.removeItemFromArray(activeChatIds, chatId);
                base.removeItemFromArray(activePromises, promise);
                _this.checkStack();
            };

            promise.then(function (result) {
                any();
                return result;
            }, function (err) {
                any();
                throw err;
            });
        });
    });
};

module.exports = MsgStack;