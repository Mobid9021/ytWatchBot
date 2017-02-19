/**
 * Created by Anton on 06.12.2015.
 */
var debug = require('debug')('app:youtube');
var base = require('../base');
var Promise = require('bluebird');
var request = require('request');
var requestPromise = Promise.promisify(request);
var CustomError = require('../customError').CustomError;

var apiQuote = new base.Quote(1000);
requestPromise = apiQuote.wrapper(requestPromise.bind(requestPromise));

var Youtube = function(options) {
    var _this = this;
    this.gOptions = options;
    this.config = {};
    this.config.token = options.config.ytToken;

    this.onReady = base.storage.get(['ytChannelInfo', 'stateList']).then(function(storage) {
        _this.config.stateList = storage.stateList || {};
        _this.config.channelInfo = storage.ytChannelInfo || {};
    });
};

/**
 * @return {Promise}
 */
Youtube.prototype.saveChannelInfo = function () {
    return base.storage.set({
        ytChannelInfo: this.config.channelInfo
    });
};

/**
 * @param {String} channelId
 * @return {{}}
 */
Youtube.prototype.getChannelInfo = function (channelId) {
    var obj = this.config.channelInfo[channelId];
    if (!obj) {
        obj = this.config.channelInfo[channelId] = {};
    }
    return obj;
};

// todo: unused!
Youtube.prototype.removeChannelInfo = function (channelId) {
    delete this.config.channelInfo[channelId];
    return this.saveChannelInfo();
};

/**
 * @param {String} channelId
 * @param {String} title
 * @return {Promise}
 */
Youtube.prototype.setChannelTitle = function(channelId, title) {
    var info = this.getChannelInfo(channelId);
    if (info.title !== title) {
        info.title = title;
        return this.saveChannelInfo();
    }

    return Promise.resolve();
};

/**
 * @param {String} channelId
 * @return {String}
 */
Youtube.prototype.getChannelTitle = function (channelId) {
    var info = this.getChannelInfo(channelId);
    return info.title || channelId;
};

/**
 * @param {String} channelId
 * @param {String} localTitle
 * @return {Promise}
 */
Youtube.prototype.setChannelLocalTitle = function(channelId, localTitle) {
    var info = this.getChannelInfo(channelId);
    if (info.title !== localTitle && info.localTitle !== localTitle) {
        info.localTitle = localTitle;
        return this.saveChannelInfo();
    }

    return Promise.resolve();
};

/**
 * @param {String} channelId
 * @return {String}
 */
Youtube.prototype.getChannelLocalTitle = function (channelId) {
    var info = this.getChannelInfo(channelId);
    return info.localTitle || info.title || channelId;
};

/**
 * @param {String} channelId
 * @param {String} username
 * @return {Promise}
 */
Youtube.prototype.setChannelUsername = function(channelId, username) {
    var info = this.getChannelInfo(channelId);
    if (info.username !== username) {
        info.username = username;
        return this.saveChannelInfo();
    }

    return Promise.resolve();
};

/**
 * @param {String[]} channelIdList
 * @return {Promise}
 */
Youtube.prototype.clean = function(channelIdList) {
    var _this = this;
    var promiseList = [];

    var needSaveState = false;
    var channelInfo = _this.config.channelInfo;
    Object.keys(channelInfo).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete channelInfo[channelId];
            needSaveState = true;
            // debug('Removed from channelInfo %s %j', channelId, _this.config.channelInfo[channelId]);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveChannelInfo());
    }

    needSaveState = false;
    var stateList = _this.config.stateList;
    Object.keys(stateList).forEach(function (channelId) {
        if (channelIdList.indexOf(channelId) === -1) {
            delete stateList[channelId];
            needSaveState = true;
            // debug('Removed from stateList %s', channelId);
        }
    });

    if (needSaveState) {
        promiseList.push(_this.saveState());
    }

    return Promise.all(promiseList);
};

/**
 * @param {String} channelId
 * @param {String} videoId
 * @return {boolean}
 */
Youtube.prototype.videoIdInList = function(channelId, videoId) {
    var stateList = this.config.stateList;
    var videoIdObj = stateList[channelId] && stateList[channelId].videoIdList;
    if (!videoIdObj) {
        return false;
    }

    return !!videoIdObj[videoId];
};

/**
 * @return {Promise}
 */
Youtube.prototype.saveState = function() {
    var stateList = this.config.stateList;
    return base.storage.set({
        stateList: stateList
    });
};

/**
 * @param {{}} snippet
 * @return {String}
 */
Youtube.prototype.getVideoIdFromThumbs = function(snippet) {
    var videoId = null;

    var thumbnails = snippet.thumbnails;
    thumbnails && Object.keys(thumbnails).some(function(quality) {
        var url = thumbnails[quality].url;
        url = url && url.match(/vi\/([^\/]+)/);
        url = url && url[1];
        if (url) {
            videoId = url;
            return true;
        }
    });

    return videoId;
};

/**
 * @param {String} channelId
 * @param {{items:[]}} data
 * @param {boolean} isFullCheck
 * @param {number} lastRequestTime
 * @return {[]}
 */
Youtube.prototype.apiNormalization = function(channelId, data, isFullCheck, lastRequestTime) {
    var _this = this;

    var stateList = this.config.stateList;

    var channelObj = base.getObjectItem(stateList, channelId, {});
    var videoIdObj = base.getObjectItem(channelObj, 'videoIdList', {});

    var channelLocalTitle = this.getChannelLocalTitle(channelId);

    var lastPubTime = 0;

    var videoList = [];
    data.items.forEach(function(origItem) {
        var snippet = origItem.snippet;

        if (!snippet) {
            debug('Snippet is not found! %j', origItem);
            return;
        }

        if (snippet.type !== 'upload') {
            return;
        }

        if (!snippet.publishedAt) {
            debug('publishedAt is not found! %j', origItem);
            return;
        }

        var videoId = _this.getVideoIdFromThumbs(snippet);
        if (!videoId) {
            debug('Video ID is not found! %j', origItem);
            return;
        }

        var pubTime = parseInt(new Date(snippet.publishedAt).getTime() / 1000);
        if (lastPubTime < pubTime) {
            lastPubTime = pubTime;
        }

        var isExists = !!videoIdObj[videoId];

        videoIdObj[videoId] = parseInt(Date.now() / 1000);

        if (isExists) {
            return;
        }

        var previewList = [];

        var thumbnails = snippet.thumbnails;
        thumbnails && Object.keys(thumbnails).forEach(function(quality) {
            var item = thumbnails[quality];
            previewList.push([item.width, item.url]);
        });

        previewList.sort(function(a, b) {
            return a[0] > b[0] ? -1 : 1;
        });

        previewList = previewList.map(function(item) {
            return item[1];
        });

        if (!snippet.thumbnails) {
            debug('Thumbnails is not found! %j', origItem);
        }

        var item = {
            _service: 'youtube',
            _channelName: channelId,
            _videoId: videoId,

            url: 'https://youtu.be/' + videoId,
            publishedAt: snippet.publishedAt,
            title: snippet.title,
            preview: previewList,
            channel: {
                title: channelLocalTitle,
                id: snippet.channelId
            }
        };

        videoList.push(item);
    });

    if (lastPubTime) {
        channelObj.lastRequestTime = lastPubTime + 1;
    }

    if (isFullCheck) {
        for (var videoId in videoIdObj) {
            if (videoIdObj[videoId] < lastRequestTime) {
                delete videoIdObj[videoId];
            }
        }
    }

    if (Object.keys(videoIdObj).length === 0) {
        delete channelObj.videoIdList;
    }

    if (Object.keys(channelObj).length === 0) {
        delete stateList[channelId];
    }

    return videoList;
};

/**
 * @param {String} channelId
 * @return {Promise}
 */
Youtube.prototype.requestChannelLocalTitle = function(channelId) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            channelId: channelId,
            type: 'channel',
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;
        var promise = null;

        var localTitle = '';
        try {
            if (responseBody.items.length > 0) {
                localTitle = responseBody.items[0].snippet.title;
            }
        } catch(e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (localTitle) {
            promise = _this.setChannelLocalTitle(channelId, localTitle);
        }

        return promise;
    }).catch(function(err) {
        debug('requestChannelLocalTitle channelId %s error! %s', channelId);
    });
};

/**
 * @param {String} query
 * @return {Promise}
 */
Youtube.prototype.requestChannelIdByQuery = function(query) {
    var _this = this;
    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/search',
        qs: {
            part: 'snippet',
            q: '"' + query + '"',
            type: 'channel',
            maxResults: 1,
            fields: 'items(id)',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;

        var channelId = '';
        try {
            if (responseBody.items.length > 0) {
                channelId = responseBody.items[0].id.channelId;
            }
        } catch(e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (!channelId) {
            throw new CustomError('Channel ID is not found by query!');
        }

        return channelId;
    });
};

var channelRe = /^UC/;

/**
 * @param {String} userId
 * @return {Promise}
 */
Youtube.prototype.requestChannelIdByUsername = function(userId) {
    var _this = this;
    if (channelRe.test(userId)) {
        return Promise.resolve(userId);
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/channels',
        qs: {
            part: 'snippet',
            forUsername: userId,
            maxResults: 1,
            fields: 'items/id',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;

        var id = '';
        try {
            if (responseBody.items.length > 0) {
                id = responseBody.items[0].id;
            }
        } catch(e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (!id) {
            throw new CustomError('Channel ID is not found by userId!');
        }

        return _this.setChannelUsername(id, userId).then(function() {
            return id;
        });
    });
};

/**
 * @param {[]} _channelIdList
 * @param {boolean} isFullCheck
 * @return {Promise}
 */
Youtube.prototype.getVideoList = function(_channelIdList, isFullCheck) {
    var _this = this;

    var streamList = [];

    var requestPages = function (channelId) {
        var stateItem = _this.config.stateList[channelId];

        var lastRequestTime = stateItem && stateItem.lastRequestTime;
        if (isFullCheck || !lastRequestTime) {
            lastRequestTime = parseInt((Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000);
        }
        var publishedAfter = new Date(lastRequestTime * 1000).toISOString();

        var pageLimit = 100;
        var getPage = function (pageToken) {
            var retryLimit = 5;
            var requestPage = function () {
                return requestPromise({
                    method: 'GET',
                    url: 'https://www.googleapis.com/youtube/v3/activities',
                    qs: {
                        part: 'snippet',
                        channelId: channelId,
                        maxResults: 50,
                        pageToken: pageToken,
                        fields: 'items/snippet,nextPageToken',
                        publishedAfter: publishedAfter,
                        key: _this.config.token
                    },
                    json: true,
                    gzip: true,
                    forever: true
                }).then(function(response) {
                    if (response.statusCode === 503) {
                        throw new CustomError(response.statusCode);
                    }

                    if (response.statusCode !== 200) {
                        debug('Unexpected response %j', response);
                        throw new CustomError('Unexpected response');
                    }

                    return response;
                }).catch(function (err) {
                    retryLimit--;
                    if (retryLimit > 0) {
                        return new Promise(function (resolve) {
                            setTimeout(resolve, 250);
                        }).then(function () {
                            // debug('Retry %s requestPage %s', retryLimit, channelId, err);
                            return requestPage();
                        });
                    }

                    throw err;
                });
            };

            return requestPage().then(function (response) {
                var responseBody = response.body;
                var promise = null;

                try {
                    var streams = _this.apiNormalization(channelId, responseBody, isFullCheck, lastRequestTime);
                    streamList.push.apply(streamList, streams);
                } catch (e) {
                    debug('Unexpected response %j', response, e);
                    throw new CustomError('Unexpected response');
                }

                if (responseBody.nextPageToken) {
                    pageLimit--;
                    if (pageLimit > 0) {
                        promise = getPage(responseBody.nextPageToken);
                    } else {
                        throw new CustomError('Page limit reached');
                    }
                }

                return promise;
            });
        };

        return getPage().catch(function(err) {
            debug('getPage error! %s', channelId, err);
        });
    };

    var threadCount = 50;
    var partSize = Math.ceil(_channelIdList.length / threadCount);

    var requestList = base.arrToParts(_channelIdList, partSize).map(function (arr) {
        return base.arrayToChainPromise(arr, function (channelId) {
            return requestPages(channelId);
        });
    });

    return Promise.all(requestList).then(function() {
        return streamList;
    });
};

/**
 * @param {String} url
 * @return {Promise}
 */
Youtube.prototype.requestChannelIdByVideoUrl = function (url) {
    var _this = this;

    var videoId = '';
    [
        /\/\/(?:[^\/]+\.)?youtu\.be\/([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/.+[?&]v=([\w\-]+)/,
        /\/\/(?:[^\/]+\.)?youtube\.com\/(?:.+\/)?(?:v|embed)\/([\w\-]+)/
    ].some(function (re) {
        var m = re.exec(url);
        if (m) {
            videoId = m[1];
            return true;
        }
    });

    if (!videoId) {
        return Promise.reject(new CustomError('It not video url!'));
    }

    return requestPromise({
        method: 'GET',
        url: 'https://www.googleapis.com/youtube/v3/videos',
        qs: {
            part: 'snippet',
            id: videoId,
            maxResults: 1,
            fields: 'items/snippet',
            key: _this.config.token
        },
        json: true,
        gzip: true,
        forever: true
    }).then(function(response) {
        var responseBody = response.body;

        var channelId = '';
        try {
            if (responseBody.items.length > 0) {
                channelId = responseBody.items[0].snippet.channelId;
            }
        } catch(e) {
            debug('Unexpected response %j', response, e);
            throw new CustomError('Unexpected response');
        }

        if (!channelId) {
            throw new CustomError('Channel ID is empty');
        }

        return channelId;
    });
};

/**
 * Response userId in lowerCase or channelId (case sensitive)
 * @param {String} channelName
 * @returns {Promise}
 */
Youtube.prototype.getChannelId = function(channelName) {
    var _this = this;

    return _this.requestChannelIdByVideoUrl(channelName).catch(function (err) {
        if (!err instanceof CustomError) {
            throw err;
        }

        return _this.requestChannelIdByUsername(channelName).catch(function(err) {
            if (!err instanceof CustomError) {
                throw err;
            }

            return _this.requestChannelIdByQuery(channelName).then(function(channelId) {
                channelName = channelId;
                return _this.requestChannelIdByUsername(channelId);
            });
        });
    }).then(function(channelId) {
        return requestPromise({
            method: 'GET',
            url: 'https://www.googleapis.com/youtube/v3/search',
            qs: {
                part: 'snippet',
                channelId: channelId,
                maxResults: 1,
                fields: 'items/snippet',
                key: _this.config.token
            },
            json: true,
            gzip: true,
            forever: true
        }).then(function(response) {
            var responseBody = response.body;

            var snippet = null;
            try {
                if (responseBody.items.length > 0) {
                    snippet = responseBody.items[0].snippet;
                }
            } catch(e) {
                debug('Unexpected response %j', response, e);
                throw new CustomError('Unexpected response');
            }

            if (!snippet) {
                throw new CustomError('Channel is not found');
            }

            var channelTitle = snippet.channelTitle;

            return _this.setChannelTitle(channelId, channelTitle).then(function () {
                return _this.requestChannelLocalTitle(channelId);
            }).then(function() {
                return channelId;
            });
        });
    });
};

module.exports = Youtube;